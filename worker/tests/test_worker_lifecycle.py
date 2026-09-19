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


# ---- draining the queue --------------------------------------------------


def test_serve_once_drains_the_queue_and_returns_when_nothing_is_running(tmp_path, monkeypatch):
    """A workspace never has a running clock, so --once must not wait for one."""
    from govern.config import load_config
    from govern.workspace import create_workspace
    from sim import commands

    monkeypatch.setenv("SIM_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("SIM_SKIP_MIGRATIONS", raising=False)
    cli._TERMINATING.clear()
    db = cli._open_db()
    run_id = create_workspace(db, load_config(REPO_ROOT / "config"), config_dir=REPO_ROOT / "config", data_dir=tmp_path,
                              name="Northwind", risk_appetite="Adopt AI where it improves service, carefully.")
    command_id = commands.enqueue(db, kind="submit", run_id=run_id, reason="Submitting a tool for review.", payload={
        "kind": "tool", "title": "Code assistant", "description": "IDE assistant for four developers.",
        "submitted_by": "it@northwind.example"})
    db.close()

    cli.main(["serve", "--demo", "--once"])        # returns, rather than polling forever

    db = cli._open_db()
    assert db.fetch_one("SELECT status FROM commands WHERE command_id = ?", (command_id,))["status"] == "done"
    assert db.fetch_one("SELECT COUNT(*) AS n FROM items WHERE run_id = ?", (run_id,))["n"] == 1
    db.close()
