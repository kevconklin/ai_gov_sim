"""Money stops a review mid-way, not only before it starts, and every stop is an alert a person can read."""

from __future__ import annotations

from datetime import date

import pytest

from conftest import REPO_ROOT
from govern.alerts import open_alerts
from govern.budget import ReviewOverBudget, require_review_ceiling, spend_since
from govern.config import load_config
from govern.db import Database, utc_now_iso
from govern.intake import get_item, submit_item
from govern.llm import LLMClient
from govern.packet import AgendaItem
from govern.panels import load_panels
from govern.service import ReviewService
from govern.workspace import create_workspace
from sim.demo_llm import DemoAnthropic

CONFIG = REPO_ROOT / "config"
TODAY = date(2026, 10, 11)


@pytest.fixture
def org(tmp_path):
    db = Database.connect_sqlite(tmp_path / "g.sqlite")
    db.migrate(REPO_ROOT / "db" / "migrations")
    config = load_config(CONFIG)
    run_id = create_workspace(db, config, config_dir=CONFIG, data_dir=tmp_path, name="Harbor Health",
                              risk_appetite="Use AI to cut clinician admin time. Never let it make a clinical decision.", today=TODAY,
                              actor="dana@harbor.example", source="test")
    return db, config, run_id, tmp_path


def test_the_ceiling_reads_spend_since_the_review_began(org):
    db, config, run_id, _ = org
    since = utc_now_iso()
    run = dict(db.fetch_one("SELECT * FROM runs WHERE run_id = ?", (run_id,)))
    assert require_review_ceiling(db, run, config, since_iso=since, phase="test") == 0.0
    db.insert("llm_calls", {"call_id": "c1", "run_id": run_id, "agent_id": None, "sim_month": None, "model": "m", "purpose": "committee_turn",
                            "status": "ok", "attempt": 1, "input_tokens": 1, "cached_tokens": 0, "cache_write_tokens": 0, "output_tokens": 1,
                            "cost_usd": 9.0, "batch": False, "batch_id": None, "custom_id": None, "stop_reason": None, "error": None,
                            "request": "x", "response": None, "created_at": utc_now_iso()})
    assert spend_since(db, run_id, since) == 9.0
    with pytest.raises(ReviewOverBudget, match="stops here"):
        require_review_ceiling(db, run, config, since_iso=since, phase="debate, round 1")


def test_a_review_over_the_ceiling_stops_alerts_and_its_matters_go_back(org):
    db, config, run_id, data_dir = org
    # the scripted client is priced at zero; price it so the positions alone pass a tiny ceiling
    llm = LLMClient(db=db, config=config, client=DemoAnthropic(), sleep=lambda s: None, price_scale=1.0)
    service = ReviewService(db=db, config=config, llm=llm, data_dir=data_dir, panel_rules=load_panels(CONFIG))
    item = submit_item(db, run_id, kind="tool", title="Otter.ai", description="Meeting notes for the clinic.", submitted_by="ops@harbor.example", today=TODAY)
    config.budget.raw["spend_caps_usd"]["per_review"] = 0.0000001
    from sim import commands
    command_id = commands.enqueue(db, kind="convene", run_id=run_id, reason="Testing the ceiling.", source="test",
                                  payload={"agenda": [{"item_id": "IT-001", "kind": "item", "title": "AI tool: Otter.ai", "ref_id": item}]})

    class Orch:
        def convene(self, rid, agenda, month=None):
            return service.convene(rid, agenda, month=month)
        config = service.config
        def context(self, rid):
            return service.context(rid)
    commands.process_pending(db, Orch(), data_dir)
    row = db.fetch_one("SELECT status, result FROM commands WHERE command_id = ?", (command_id,))
    assert row["status"] == "failed" and "ReviewOverBudget" in row["result"]
    assert get_item(db, item)["status"] == "submitted"                                   # back in Waiting
    assert db.fetch_one("SELECT status FROM meetings WHERE run_id = ?", (run_id,))["status"] == "failed"
    kinds = {a["kind"] for a in open_alerts(db, run_id)}
    assert {"review_over_budget", "review_failed"} <= kinds
