"""The committee says what a person should do, not only how it votes: owners, conditions, documents, wording, follow-ups."""

from __future__ import annotations

from datetime import date

import pytest

from conftest import REPO_ROOT
from govern import recommend
from govern.config import load_config
from govern.db import Database
from govern.intake import submit_item
from govern.llm import LLMClient
from govern.packet import AgendaItem
from govern.panels import load_panels
from govern.service import ReviewService
from govern.tools import ToolSession, execute, tools_for
from govern.workspace import create_workspace
from sim.demo_llm import DemoAnthropic

CONFIG = REPO_ROOT / "config"
TODAY = date(2026, 10, 11)


@pytest.fixture
def reviewed(tmp_path):
    db = Database.connect_sqlite(tmp_path / "g.sqlite")
    db.migrate(REPO_ROOT / "db" / "migrations")
    config = load_config(CONFIG)
    run_id = create_workspace(db, config, config_dir=CONFIG, data_dir=tmp_path, name="Harbor Health",
                              risk_appetite="Use AI to cut clinician admin time. Never let it make a clinical decision.", today=TODAY,
                              actor="dana@harbor.example", source="test")
    service = ReviewService(db=db, config=config, llm=LLMClient(db=db, config=config, client=DemoAnthropic(), sleep=lambda s: None),
                            data_dir=tmp_path, panel_rules=load_panels(CONFIG))
    item = submit_item(db, run_id, kind="tool", title="Otter.ai", description="Meeting notes for the clinic.", submitted_by="ops@harbor.example", today=TODAY)
    result = service.convene(run_id, [AgendaItem("IT-001", "item", "AI tool: Otter.ai", item)], on=TODAY)
    return db, service, run_id, result


def test_only_a_disclosed_committee_is_offered_recommend():
    assert "recommend" in {t["name"] for t in tools_for(disclosed=True)}
    assert "recommend" not in {t["name"] for t in tools_for(disclosed=False)}


def test_a_review_leaves_recommendations_on_the_record_by_kind_and_seat(reviewed):
    db, _, run_id, result = reviewed
    rows = recommend.for_item(db, result.meeting_id, "IT-001")
    assert rows, "the scripted seats recommend on the first item"
    assert {r["kind"] for r in rows} <= set(recommend.KINDS)
    assert all(r["seat_title"] and r["title"] and len(r["body"]) >= 10 for r in rows)
    assert "Recommendations recorded:" in recommend.summary(db, result.meeting_id, "IT-001")


def test_the_tool_refuses_an_unknown_item_and_an_empty_body(reviewed):
    db, service, run_id, result = reviewed
    ctx = service.context(run_id)
    chair = next(a for a in ctx.active_agents() if a.seat == "chair")
    session = ToolSession(ctx=ctx, agent=chair, phase="debate", month="2026-10", meeting_id=result.meeting_id, meeting_date=TODAY,
                          decision_items={"IT-001": "AI tool: Otter.ai"})
    text, _ = execute(session, "recommend", {"item_id": "IT-009", "kind": "owner", "title": "x", "body": "y"})
    assert "Unknown item" in text
    text, _ = execute(session, "recommend", {"item_id": "IT-001", "kind": "owner", "title": "Name an owner", "body": "short"})
    assert "at least a sentence" in text
    text, _ = execute(session, "recommend", {"item_id": "it-001", "kind": "document", "title": "Adopt a recording standard",
                                             "body": "Recordings announced, off when a patient is discussed, kept 30 days."})
    assert text.startswith("Recorded:")
    assert any(r["kind"] == "document" and r["title"] == "Adopt a recording standard" for r in recommend.for_item(db, result.meeting_id, "IT-001"))


def test_recommendations_travel_with_the_workspace():
    from sim.checkpoint import RUN_TABLES
    assert "recommendations" in RUN_TABLES
