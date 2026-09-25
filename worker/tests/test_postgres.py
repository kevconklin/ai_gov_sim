"""Runs the migration and one full simulated month for one bank on real Postgres (embedded via pgserver)."""

from __future__ import annotations

import pytest

pgserver = pytest.importorskip("pgserver")

from conftest import REPO_ROOT  # noqa: E402
from govern.config import load_config  # noqa: E402
from govern.db import Database, PostgresDatabase  # noqa: E402
from sim.demo_llm import DemoAnthropic  # noqa: E402
from govern.llm import LLMClient  # noqa: E402
from sim.orchestrator import Orchestrator  # noqa: E402
from sim.setup import create_experiment  # noqa: E402
from sim.world import load_world  # noqa: E402


@pytest.fixture(scope="module")
def pg(tmp_path_factory):
    server = pgserver.get_server(tmp_path_factory.mktemp("pg"), cleanup_mode="stop")
    db = Database.connect(server.get_uri())
    assert isinstance(db, PostgresDatabase)
    db.migrate(REPO_ROOT / "db" / "migrations")
    yield db
    db.close()


def test_postgres_migration_is_idempotent(pg):
    assert pg.migrate(REPO_ROOT / "db" / "migrations") == []


def test_one_month_runs_on_postgres(pg, tmp_path):
    config, world = load_config(REPO_ROOT / "config"), load_world(REPO_ROOT / "config")
    llm = LLMClient(db=pg, config=config, client=DemoAnthropic(), sleep=lambda s: None)
    orch = Orchestrator(db=pg, world=world, config=config, llm=llm, data_dir=tmp_path)
    run_id = create_experiment(pg, world, config, name="pg", replicates=1, seed=7, data_dir=tmp_path, banks=["tollgate"])[0]
    assert orch.advance(run_id) == "2027-01"
    assert pg.fetch_one("SELECT COUNT(*) AS n FROM metrics WHERE run_id = ?", (run_id,))["n"] > 20
    assert pg.fetch_one("SELECT COUNT(*) AS n FROM llm_calls WHERE run_id = ? AND batch", (run_id,))["n"] > 0
    like = pg.fetch_all("SELECT kind FROM alerts WHERE message LIKE ?", ("%zzz%",))
    assert like == []
