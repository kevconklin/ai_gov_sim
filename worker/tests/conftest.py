from __future__ import annotations

from pathlib import Path

import pytest

from govern.config import load_config
from govern.db import Database

REPO_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def config():
    return load_config(REPO_ROOT / "config")


@pytest.fixture
def db(tmp_path):
    database = Database.connect_sqlite(tmp_path / "sim.sqlite")
    database.migrate(REPO_ROOT / "db" / "migrations")
    yield database
    database.close()


@pytest.fixture
def run_id(db):
    db.insert("experiments", {"experiment_id": "e1", "name": "test", "created_at": "t"})
    db.insert("runs", {
        "run_id": "run1", "experiment_id": "e1", "bank_id": "calder_ridge", "condition": "conservative",
        "replicate": 1, "seed": 777, "model_versions": {}, "config_hash": "x", "start_month": "2027-01",
        "status": "running", "started_at": "t",
    })
    return "run1"


@pytest.fixture
def world():
    from sim.world import load_world
    return load_world(REPO_ROOT / "config")


@pytest.fixture
def agenda_yaml():
    return (REPO_ROOT / "config" / "agenda_priority.yaml").read_text()


@pytest.fixture
def agenda_config():
    from govern.config import load_agenda_priority
    return load_agenda_priority(REPO_ROOT / "config")
