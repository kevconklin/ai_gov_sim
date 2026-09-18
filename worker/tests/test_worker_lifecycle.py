"""What a scheduler does to a worker: it migrates elsewhere, probes it, and sends it SIGTERM."""

from __future__ import annotations

import json
import urllib.error
import urllib.request

import pytest

from conftest import REPO_ROOT
from sim import cli


# ---- migrations ----------------------------------------------------------


def test_the_worker_migrates_by_default(tmp_path, monkeypatch):
    monkeypatch.setenv("SIM_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("SIM_SKIP_MIGRATIONS", raising=False)
    db = cli._open_db()
    assert db.fetch_one("SELECT COUNT(*) AS n FROM schema_migrations")["n"] > 0
    db.close()


def test_migrations_can_be_left_to_a_separate_step(tmp_path, monkeypatch):
    """Several replicas racing the same CREATE TABLE collide, so a cluster runs them once, first."""
    monkeypatch.setenv("SIM_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("SIM_SKIP_MIGRATIONS", "1")
    db = cli._open_db()
    with pytest.raises(Exception):
        db.fetch_one("SELECT COUNT(*) AS n FROM runs")
    db.close()


def test_the_migrate_command_applies_them(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("SIM_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("SIM_SKIP_MIGRATIONS", "1")
    cli.main(["migrate"])
    applied = json.loads(capsys.readouterr().out)["applied"]
    assert "0001_init.sql" in applied
    cli.main(["migrate"])
    assert json.loads(capsys.readouterr().out)["applied"] == []


# ---- shutdown ------------------------------------------------------------


def test_sigterm_asks_the_worker_to_stop(monkeypatch):
    """A pod being drained must finish or roll back, not be killed part-way through a month."""
    cli._TERMINATING.clear()
    assert cli.terminating() is False
    cli._install_shutdown_handlers()
    import os
    import signal
    os.kill(os.getpid(), signal.SIGTERM)
    assert cli.terminating() is True
    cli._TERMINATING.clear()


# ---- health --------------------------------------------------------------


@pytest.fixture
def health():
    server = cli.start_health_server(0, host="127.0.0.1")
    yield f"http://127.0.0.1:{server.server_address[1]}/healthz"
    cli.stop_health_server(server)


def test_health_reports_ready(health):
    with urllib.request.urlopen(health, timeout=5) as response:
        assert response.status == 200
        assert json.loads(response.read())["status"] == "ok"


def test_health_reports_not_ok_once_the_worker_is_draining(health):
    """A probe should stop routing work to a pod that is on its way out."""
    cli._TERMINATING.set()
    try:
        with pytest.raises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(health, timeout=5)
        assert caught.value.code == 503
        assert json.loads(caught.value.read())["status"] == "draining"
    finally:
        cli._TERMINATING.clear()
