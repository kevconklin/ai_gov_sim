"""Employees ask the policy, not the committee: an answer cites controls, or admits the policy does not cover it."""

from __future__ import annotations

from datetime import date

import pytest

from conftest import REPO_ROOT
from govern import ask
from govern.config import load_config
from govern.context import ReviewContext
from govern.db import Database
from govern.intake import get_item
from govern.llm import LLMClient
from govern.workspace import create_workspace
from sim.demo_llm import DemoAnthropic

CONFIG = REPO_ROOT / "config"
TODAY = date(2026, 9, 28)
WHO = dict(actor="dana@harbor.example", source="dashboard_session")
APPETITE = "Use AI to cut clinician admin time. Never let it make a clinical decision."


@pytest.fixture
def ws(tmp_path):
    db = Database.connect_sqlite(tmp_path / "g.sqlite")
    db.migrate(REPO_ROOT / "db" / "migrations")
    config = load_config(CONFIG)
    run_id = create_workspace(db, config, config_dir=CONFIG, data_dir=tmp_path, name="Harbor Health",
                              risk_appetite=APPETITE, today=TODAY, starter="general_business", **WHO)
    llm = LLMClient(db=db, config=config, client=DemoAnthropic(), sleep=lambda s: None)
    run = dict(db.fetch_one("SELECT * FROM runs WHERE run_id = ?", (run_id,)))
    ctx = ReviewContext(db=db, llm=llm, config=config, run=run, data_dir=tmp_path)
    return db, ctx, run_id


def test_an_answer_cites_controls_the_policy_actually_has(ws):
    db, ctx, run_id = ws
    result = ask.answer(ctx, question="Can I paste a customer's claim history into ChatGPT to draft a reply?",
                        asked_by="nurse@harbor.example", today=TODAY)
    assert result.covered is True
    assert result.controls and all(c.startswith("AI-GOV-") for c in result.controls)
    assert "AI-GOV-099" not in result.controls           # the scripted client cites one that does not exist; it is dropped
    assert len(result.answer) > 20 and result.item_id is None
    row = db.fetch_one("SELECT * FROM asks WHERE ask_id = ?", (result.ask_id,))
    assert row["asked_by"] == "nurse@harbor.example" and row["run_id"] == run_id and bool(row["covered"])
    assert row["asked_at"] == "2026-09-28"
    call = db.fetch_one("SELECT purpose, run_id FROM llm_calls WHERE call_id = ?", (row["call_id"],))
    assert call["purpose"] == "ask_policy" and call["run_id"] == run_id


def test_an_answer_the_policy_does_not_cover_says_so(ws):
    db, ctx, run_id = ws
    result = ask.answer(ctx, question="May we use biometric check-in at the front desk?", asked_by="ops@harbor.example", today=TODAY)
    assert result.covered is False
    assert result.controls == ()
    assert [a.ask_id for a in ask.unanswered(db, run_id)] == [result.ask_id]


def test_covered_needs_a_real_citation(ws):
    """The model saying "covered" with no control the policy has is a guess, and is recorded as not covered."""
    from govern.ask import _settle
    settled = _settle({"covered": True, "answer": "Yes, go ahead.", "controls_cited": ["AI-GOV-999"]}, policy_controls=("AI-GOV-001",))
    assert settled["covered"] is False and settled["controls"] == ()


def test_a_short_or_empty_question_is_refused(ws):
    _, ctx, _ = ws
    with pytest.raises(ask.AskError):
        ask.answer(ctx, question="AI?", asked_by="x@harbor.example", today=TODAY)
    with pytest.raises(ask.AskError):
        ask.answer(ctx, question="a" * 3000, asked_by="x@harbor.example", today=TODAY)


def test_asking_costs_against_the_workspace_cap(ws):
    db, ctx, run_id = ws
    db.update("runs", {"spend_cap_usd_per_month": 0.0}, where={"run_id": run_id})
    ctx = ReviewContext(db=db, llm=ctx.llm, config=ctx.config, run=dict(db.fetch_one("SELECT * FROM runs WHERE run_id = ?", (run_id,))),
                        data_dir=ctx.data_dir)
    from govern.budget import BudgetExceeded
    with pytest.raises(BudgetExceeded):
        ask.answer(ctx, question="Can I use an AI note-taker in patient meetings?", asked_by="x@harbor.example", today=TODAY)
    assert db.fetch_all("SELECT 1 FROM asks WHERE run_id = ?", (run_id,)) == []


def test_sending_an_ask_to_the_committee_makes_a_question_the_person_still_convenes(ws):
    db, ctx, run_id = ws
    result = ask.answer(ctx, question="May we use biometric check-in at the front desk?", asked_by="ops@harbor.example", today=TODAY)
    item_id = ask.send_to_committee(db, run_id, result.ask_id, actor="dana@harbor.example", today=TODAY)
    item = get_item(db, item_id)
    assert item["kind"] == "question" and item["status"] == "submitted"
    assert item["title"] == "May we use biometric check-in at the front desk?"
    assert "ops@harbor.example" in item["description"] and "could not answer" in item["description"]
    assert item["submitted_by"] == "dana@harbor.example"
    assert db.fetch_one("SELECT item_id FROM asks WHERE ask_id = ?", (result.ask_id,))["item_id"] == item_id
    assert ask.unanswered(db, run_id) == ()
    with pytest.raises(ask.AskError, match="already"):
        ask.send_to_committee(db, run_id, result.ask_id, actor="dana@harbor.example", today=TODAY)


def test_the_brief_never_mentions_the_simulation_and_says_what_it_is():
    from govern import prompts
    text = prompts.render("ask/fixed.md", org="Harbor Health")
    for phrase in ("machine-generated", "advisory", "not legal advice", "only from"):
        assert phrase in text
    assert "simulat" not in text.lower()


def test_asks_travel_with_checkpoints_and_forks():
    from sim.checkpoint import RUN_TABLES
    assert "asks" in RUN_TABLES
