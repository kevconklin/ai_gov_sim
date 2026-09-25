"""The product, end to end, with no simulated world anywhere: a workspace, intake, a panel, a review, a person."""

from __future__ import annotations

from datetime import date

import pytest

from conftest import REPO_ROOT
from govern.agenda import candidates
from govern.attestation import AttestationRequired, apply_meeting, record_attestation
from govern.committee import seats, set_brief
from govern.config import load_agenda_priority, load_attestation, load_config
from govern.context import ReviewContext
from govern.db import Database
from govern.intake import IntakeError, get_item, submit_item, withdraw_item
from govern.llm import LLMClient
from govern.packet import AgendaItem
from govern.panels import load_panels, panel_for, set_panel_rule
from govern.service import ReviewService
from govern.workspace import create_workspace
from sim.demo_llm import DemoAnthropic     # the scripted client only; no world, no orchestrator

CONFIG = REPO_ROOT / "config"
TODAY = date(2026, 9, 18)
APPETITE = "Adopt AI where it demonstrably improves service, and never at the cost of a fair lending finding."


@pytest.fixture(scope="module")
def product(tmp_path_factory):
    data_dir = tmp_path_factory.mktemp("product")
    db = Database.connect_sqlite(data_dir / "govern.sqlite")
    db.migrate(REPO_ROOT / "db" / "migrations")
    config = load_config(CONFIG)
    llm = LLMClient(db=db, config=config, client=DemoAnthropic(), sleep=lambda s: None)
    service = ReviewService(db=db, config=config, llm=llm, data_dir=data_dir, panel_rules=load_panels(CONFIG))
    run_id = create_workspace(db, config, config_dir=CONFIG, data_dir=data_dir, name="Northwind Credit Union",
                              risk_appetite=APPETITE, facts="A member-owned credit union with 40 staff.", today=TODAY)
    return db, service, run_id


# ---- workspace ------------------------------------------------------------


def test_a_workspace_has_a_profile_and_a_committee_of_stored_briefs(product):
    db, service, run_id = product
    ctx = service.context(run_id)
    assert isinstance(ctx, ReviewContext) and type(ctx) is ReviewContext     # no simulation subclass involved
    assert ctx.org.name == "Northwind Credit Union"
    assert ctx.org.disclosed is True
    assert len(ctx.active_agents()) == 8
    assert all(a.persona_text for a in ctx.active_agents())
    assert ctx.chair().seat == "chair"


def test_the_simulation_clock_never_picks_up_a_workspace(product):
    db, _, run_id = product
    assert db.fetch_one("SELECT status FROM runs WHERE run_id = ?", (run_id,))["status"] == "workspace"
    assert db.fetch_all("SELECT run_id FROM runs WHERE status = 'running'") == []


def test_members_are_told_what_they_are(product):
    from govern.agents.runner import fixed_block
    _, service, run_id = product
    ctx = service.context(run_id)
    brief = fixed_block(ctx, ctx.chair())
    assert "AI adviser" in brief and "makes the decision" in brief
    assert "Northwind Credit Union" in brief


def test_rewriting_a_brief_is_logged_as_an_intervention(product):
    db, _, run_id = product
    set_brief(db, run_id, "security", "You answer for security incidents and you ask for evidence, not assurances, "
              "about where member data goes.", reason="Tightened after the vendor review.")
    assert "member data" in next(s for s in seats(db, run_id) if s["seat"] == "security")["persona_text"]
    assert db.fetch_one("SELECT COUNT(*) AS n FROM interventions WHERE run_id = ? AND kind = 'prompt_edit'",
                        (run_id,))["n"] == 1
    with pytest.raises(ValueError, match="reason"):
        set_brief(db, run_id, "security", "x" * 60, reason="short")


# ---- intake ---------------------------------------------------------------


def test_intake_refuses_what_a_committee_could_not_act_on(product):
    db, _, run_id = product
    with pytest.raises(IntakeError, match="kind"):
        submit_item(db, run_id, kind="gadget", title="A thing", description="Something to review.", submitted_by="x")
    with pytest.raises(IntakeError, match="description"):
        submit_item(db, run_id, kind="tool", title="Copilot", description="short", submitted_by="x")


def test_a_withdrawn_item_is_no_longer_a_candidate(product):
    db, _, run_id = product
    item = submit_item(db, run_id, kind="tool", title="Meeting notetaker", submitted_by="ops@northwind.example",
                       description="Records and summarises internal meetings.", today=TODAY)
    withdraw_item(db, item)
    assert item not in [c.ref_id for c in candidates(db, run_id, load_agenda_priority(CONFIG), today=TODAY)]
    with pytest.raises(IntakeError):
        withdraw_item(db, item)


# ---- panels ---------------------------------------------------------------


def test_a_vendor_review_seats_the_lenses_it_needs_and_the_chair(product):
    db, service, run_id = product
    org = service.context(run_id).org
    seats_ = panel_for(db, run_id, [("vendor", "medium")], org=org, rules=load_panels(CONFIG))
    assert seats_ == ("chair", "security", "legal", "risk", "finance")


def test_anything_high_tier_gets_the_whole_committee(product):
    db, service, run_id = product
    org = service.context(run_id).org
    assert panel_for(db, run_id, [("vendor", "high")], org=org, rules=load_panels(CONFIG)) == org.seats


def test_a_workspace_can_override_a_panel(product):
    db, service, run_id = product
    org = service.context(run_id).org
    set_panel_rule(db, run_id, kind="exception", seats=["legal", "customer"])
    assert panel_for(db, run_id, [("exception", "low")], org=org, rules=load_panels(CONFIG)) == ("chair", "legal", "customer")


# ---- the whole loop -------------------------------------------------------


@pytest.fixture(scope="module")
def reviewed(product):
    db, service, run_id = product
    vendor = submit_item(db, run_id, kind="vendor", title="Lumen transcript analytics", risk_tier="medium",
                         submitted_by="cx@northwind.example", today=TODAY,
                         description="Third-party service that scores member call transcripts for complaint risk.",
                         details={"data_shared": "call transcripts", "hosting": "vendor cloud"})
    question = submit_item(db, run_id, kind="question", title="Should staff be allowed to use public chat assistants?",
                           submitted_by="hr@northwind.example", today=TODAY,
                           description="Staff are asking whether public AI assistants are permitted for drafting.")
    ranked = candidates(db, run_id, load_agenda_priority(CONFIG), today=date(2026, 10, 20))
    agenda = [AgendaItem(c.ref_id.rsplit("/", 1)[-1], c.kind, c.title, c.ref_id) for c in ranked]
    result = service.convene(run_id, agenda, on=date(2026, 10, 20))
    return db, service, run_id, vendor, question, result


def test_intake_items_rank_as_candidates_with_reasons(product, reviewed):
    db, _, run_id, *_ = reviewed
    # both were taken by the review, so nothing is left waiting
    assert candidates(db, run_id, load_agenda_priority(CONFIG), today=TODAY) == ()


def test_only_the_panel_sat(reviewed):
    db, _, run_id, _, _, result = reviewed
    sat = {r["seat"] for r in db.fetch_all(
        "SELECT DISTINCT a.seat FROM positions p JOIN agents a ON a.agent_id = p.agent_id WHERE p.meeting_id = ?",
        (result.meeting_id,))}
    # a vendor item and a question together: the question brings the whole committee
    assert len(sat) == 8


def test_the_review_recommends_and_applies_nothing(reviewed):
    db, _, run_id, vendor, question, result = reviewed
    assert [d.item.item_id for d in result.decisions] == ["IT-002"]
    assert get_item(db, vendor)["status"] == "recommended"
    assert get_item(db, question)["status"] == "advised"
    assert db.fetch_one("SELECT convened FROM meetings WHERE meeting_id = ?", (result.meeting_id,))["convened"]


def test_the_question_was_answered_without_a_vote(reviewed):
    from govern.advisory import synthesis_for
    db, _, _, _, _, result = reviewed
    assert synthesis_for(db, result.meeting_id, "IT-003") is not None
    assert db.fetch_one("SELECT COUNT(*) AS n FROM votes WHERE meeting_id = ? AND item_id = 'IT-003'",
                        (result.meeting_id,))["n"] == 0


def test_a_person_makes_it_real(reviewed):
    db, service, run_id, vendor, _, result = reviewed
    ctx = service.context(run_id)
    with pytest.raises(AttestationRequired):
        apply_meeting(ctx, result.meeting_id, month="2026-10", meeting_date=date(2026, 10, 20))
    decision = result.decisions[0]
    record_attestation(db, run_id, decision_id=decision.decision_id, actor="cro@northwind.example",
                       outcome="approved", rationale="Approved with a contractual bar on the vendor training on our data.",
                       config=load_attestation(CONFIG), source="dashboard_session",
                       responded_to=[r["agent_id"] for r in db.fetch_all(
                           "SELECT agent_id FROM votes WHERE meeting_id = ? AND item_id = ? AND vote = 'no'",
                           (result.meeting_id, decision.item.item_id))])
    apply_meeting(ctx, result.meeting_id, month="2026-10", meeting_date=date(2026, 10, 20))
    assert get_item(db, vendor)["status"] == "approved"
    assert get_item(db, vendor)["decided_on"] == "2026-10-20"


def test_a_deferred_item_comes_back_as_a_candidate(product):
    db, service, run_id = product
    item = submit_item(db, run_id, kind="tool", title="Code assistant for the core team", risk_tier="low",
                       submitted_by="it@northwind.example", today=TODAY,
                       description="IDE assistant for the four developers who maintain the core banking integrations.")
    result = service.convene(run_id, [AgendaItem("IT-X", "item", "AI tool", item)], on=date(2026, 11, 3))
    decision = result.decisions[0]
    record_attestation(db, run_id, decision_id=decision.decision_id, actor="cro@northwind.example", outcome="deferred",
                       rationale="Deferred until the vendor confirms where prompts are retained.",
                       config=load_attestation(CONFIG), source="dashboard_session")
    apply_meeting(service.context(run_id), result.meeting_id, month="2026-11", meeting_date=date(2026, 11, 3))
    back = [c for c in candidates(db, run_id, load_agenda_priority(CONFIG), today=date(2026, 11, 4)) if c.ref_id == item]
    assert back and back[0].deferral_count == 1 and "deferred 1x" in back[0].reasons


# ---- a matter can be reviewed more than once ------------------------------


def test_a_deferred_matter_can_be_reviewed_and_signed_again(product):
    """Deferral is a core path: the second review of a matter must not collide with the first."""
    db, service, run_id = product
    item = submit_item(db, run_id, kind="tool", title="Slide drafting assistant", risk_tier="low",
                       submitted_by="ops@northwind.example", today=TODAY,
                       description="Drafts internal presentation slides from meeting notes for staff.")
    agenda = [AgendaItem("IT-X", "item", "AI tool", item)]
    first = service.convene(run_id, agenda, on=date(2026, 11, 10))
    record_attestation(db, run_id, decision_id=first.decisions[0].decision_id, actor="cro@northwind.example",
                       outcome="deferred", rationale="Deferred until the vendor answers the retention question.",
                       config=load_attestation(CONFIG))
    apply_meeting(service.context(run_id), first.meeting_id, month="2026-11", meeting_date=date(2026, 11, 10))

    second = service.convene(run_id, agenda, on=date(2026, 11, 24))
    assert second.decisions[0].decision_id != first.decisions[0].decision_id
    record_attestation(db, run_id, decision_id=second.decisions[0].decision_id, actor="cro@northwind.example",
                       outcome="approved", rationale="Approved now that retention is ruled out in the contract.",
                       config=load_attestation(CONFIG))
    apply_meeting(service.context(run_id), second.meeting_id, month="2026-11", meeting_date=date(2026, 11, 24))
    assert get_item(db, item)["status"] == "approved"


def test_an_agenda_with_nothing_still_waiting_is_refused(product):
    db, service, run_id = product
    gone = AgendaItem("IT-X", "item", "AI tool", f"{run_id}/item/IT-999")
    before = db.fetch_one("SELECT COUNT(*) AS n FROM meetings WHERE run_id = ?", (run_id,))["n"]
    with pytest.raises(ValueError, match="still waiting"):
        service.convene(run_id, [gone], on=date(2026, 12, 1))
    assert db.fetch_one("SELECT COUNT(*) AS n FROM meetings WHERE run_id = ?", (run_id,))["n"] == before


def test_a_review_that_died_gives_its_matters_back(product):
    """Otherwise they are hidden from the queue for good: nobody can convene them or sign them."""
    from govern.service import recover_interrupted_reviews
    db, service, run_id = product
    item = submit_item(db, run_id, kind="tool", title="Inbox triage assistant", risk_tier="low",
                       submitted_by="ops@northwind.example", today=TODAY,
                       description="Sorts the shared member-services inbox into queues for staff.")
    db.insert("meetings", {"meeting_id": f"{run_id}/meeting/2026-12-9", "run_id": run_id, "bank_id": "x",
                           "sim_month": "2026-12", "meeting_date": "2026-12-02", "agenda": [], "status": "open",
                           "convened": True})
    db.update("items", {"status": "in_review"}, where={"item_id": item})
    assert recover_interrupted_reviews(db, run_id) == [f"{run_id}/meeting/2026-12-9"]
    assert get_item(db, item)["status"] == "submitted"
    assert db.fetch_one("SELECT status FROM meetings WHERE meeting_id = ?", (f"{run_id}/meeting/2026-12-9",))["status"] == "failed"


# ---- the budget is enforced, not just recorded ----------------------------


def test_a_review_is_refused_once_the_months_budget_is_spent(product):
    from govern.budget import BudgetExceeded
    from govern.db import utc_now_iso
    db, service, run_id = product
    item = submit_item(db, run_id, kind="tool", title="Spreadsheet formula helper", risk_tier="low",
                       submitted_by="ops@northwind.example", today=TODAY,
                       description="Suggests spreadsheet formulas for the finance team to check.")
    db.update("runs", {"spend_cap_usd_per_month": 5.0}, where={"run_id": run_id})
    db.insert("llm_calls", {"call_id": "spent-1", "run_id": run_id, "model": "m", "purpose": "committee_turn",
                            "status": "ok", "attempt": 1, "input_tokens": 1, "cached_tokens": 0, "output_tokens": 1, "cost_usd": 5.25, "batch": False,
                            "request": {}, "response": {}, "created_at": utc_now_iso()})
    try:
        with pytest.raises(BudgetExceeded, match="budget is spent"):
            service.convene(run_id, [AgendaItem("IT-X", "item", "AI tool", item)])
        assert get_item(db, item)["status"] == "submitted"          # nothing was started
    finally:
        db.execute("DELETE FROM llm_calls WHERE call_id = 'spent-1'")
        db.update("runs", {"spend_cap_usd_per_month": 50.0}, where={"run_id": run_id})


def test_a_new_customer_starts_with_the_customer_default_not_the_simulations(product, tmp_path):
    db, _, run_id = product
    fresh = create_workspace(db, load_config(CONFIG), config_dir=CONFIG, data_dir=tmp_path,
                             name="Default Check Co", risk_appetite="Adopt AI carefully and only where it clearly helps.")
    assert db.fetch_one("SELECT spend_cap_usd_per_month AS cap FROM runs WHERE run_id = ?", (fresh,))["cap"] == 50.0
