from __future__ import annotations

import pytest

from conftest import REPO_ROOT
from govern.db import Database

RUN_ROW = {
    "run_id": "r1", "experiment_id": "e1", "bank_id": "calder_ridge", "condition": "conservative", "replicate": 1,
    "seed": 42, "model_versions": {"committee": "claude-sonnet-5"}, "config_hash": "abc", "start_month": "2027-01",
    "status": "running", "started_at": "2026-09-17T00:00:00Z",
}

SPEC_TABLES = {
    "runs", "interventions", "sim_months", "agents", "llm_calls", "messages", "meetings",
    "positions", "votes", "use_cases", "policy_versions", "engine_draws", "events",
    "findings", "metrics",
}


def test_migrate_creates_every_spec_table(db):
    rows = db.fetch_all("SELECT name FROM sqlite_master WHERE type = 'table'")
    assert SPEC_TABLES <= {r["name"] for r in rows}


def test_migrate_is_idempotent(db):
    applied = db.migrate(REPO_ROOT / "db" / "migrations")
    assert applied == []


def _experiment(db):
    db.insert("experiments", {"experiment_id": "e1", "name": "pilot", "created_at": "t"})


def test_insert_serializes_json_and_round_trips(db):
    _experiment(db)
    db.insert("runs", RUN_ROW)
    row = db.fetch_one("SELECT * FROM runs WHERE run_id = ?", ("r1",))
    assert row["seed"] == 42
    assert db.loads(row["model_versions"]) == {"committee": "claude-sonnet-5"}


def test_fetch_one_returns_none_when_missing(db):
    assert db.fetch_one("SELECT * FROM runs WHERE run_id = ?", ("nope",)) is None


def test_insert_rejects_unsafe_identifiers(db):
    with pytest.raises(ValueError):
        db.insert("runs; DROP TABLE runs", {"run_id": "x"})
    with pytest.raises(ValueError):
        db.insert("runs", {"run_id) VALUES ('x'); --": "x"})


def test_insert_rejects_empty_row(db):
    with pytest.raises(ValueError):
        db.insert("runs", {})


def test_update_changes_matching_rows_only(db):
    _experiment(db)
    for run_id in ("a", "b"):
        db.insert("runs", {**RUN_ROW, "run_id": run_id})
    db.update("runs", {"status": "stopped"}, where={"run_id": "a"})
    statuses = {r["run_id"]: r["status"] for r in db.fetch_all("SELECT run_id, status FROM runs")}
    assert statuses == {"a": "stopped", "b": "running"}


def test_update_requires_where_clause(db):
    with pytest.raises(ValueError):
        db.update("runs", {"status": "stopped"}, where={})


def test_migrate_rejects_missing_directory(tmp_path):
    database = Database.connect_sqlite(tmp_path / "x.sqlite")
    with pytest.raises(FileNotFoundError):
        database.migrate(tmp_path / "missing")
    database.close()
