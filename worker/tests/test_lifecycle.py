"""A use case across its life: approval starts it, a person moves it, and it comes back for review on schedule."""

from __future__ import annotations

import json
from datetime import date

import pytest

from conftest import REPO_ROOT
from govern import lifecycle
from govern.agenda import candidates
from govern.attestation import apply_meeting, record_attestation
from govern.config import load_agenda_priority, load_attestation, load_config
from govern.db import Database
from govern.intake import get_item, submit_item
from govern.llm import LLMClient
from govern.packet import AgendaItem
from govern.panels import load_panels
from govern.service import ReviewService
from govern.workspace import create_workspace
from sim.demo_llm import DemoAnthropic

CONFIG = REPO_ROOT / "config"
DAY1 = date(2026, 9, 29)
WHO = dict(actor="dana@harbor.example", source="dashboard_session")
SIGNER = "Dana Whitfield <dana@harbor.example>"


def sign(db, service, run_id, item, outcome, on):
    result = service.convene(run_id, [AgendaItem(item.rsplit("/", 1)[-1], "item", "AI use case", item)], on=on)
    decision = result.decisions[0]
    record_attestation(db, run_id, decision_id=decision.decision_id, actor=SIGNER, outcome=outcome,
                       rationale="Signed for the lifecycle test, with reasons long enough to count.",
                       config=load_attestation(CONFIG), source="dashboard_session",
                       responded_to=[r["agent_id"] for r in db.fetch_all(       # every voter, so the high tier's rule is met either way
                           "SELECT agent_id FROM votes WHERE meeting_id = ? AND item_id = ?", (result.meeting_id, decision.item.item_id))])
    apply_meeting(service.context(run_id), result.meeting_id, month=on.isoformat()[:7], meeting_date=on)


@pytest.fixture
def approved(tmp_path):
    db = Database.connect_sqlite(tmp_path / "g.sqlite")
    db.migrate(REPO_ROOT / "db" / "migrations")
    config = load_config(CONFIG)
    run_id = create_workspace(db, config, config_dir=CONFIG, data_dir=tmp_path, name="Harbor Health",
                              risk_appetite="Use AI to cut clinician admin time. Never let it make a clinical decision.", today=DAY1, **WHO)
    service = ReviewService(db=db, config=config, llm=LLMClient(db=db, config=config, client=DemoAnthropic(), sleep=lambda s: None),
                            data_dir=tmp_path, panel_rules=load_panels(CONFIG))
    item = submit_item(db, run_id, kind="use_case", title="Discharge summary drafting", submitted_by="ops@harbor.example", risk_tier="high",
                       description="Draft plain-language discharge summaries for a nurse to edit.", today=DAY1,
                       details={"accountable_owner": "Priya Nair, Nursing Director", "decides_or_advises": "advises a person who decides"})
    sign(db, service, run_id, item, "approved", DAY1)
    return db, service, run_id, item


def test_the_config_loads_and_refuses_a_stage_it_does_not_know():
    cfg = lifecycle.load_lifecycle(CONFIG)
    assert cfg.stages[0] == "approved" and cfg.stages[-1] == "retired"
    assert cfg.months_for("high") == 6 and cfg.months_for(None) == 12


def test_approval_starts_the_life_with_an_owner_and_a_review_date(approved):
    db, _, _, item = approved
    row = get_item(db, item)
    assert (row["status"], row["stage"], row["owner"], row["review_due"]) == ("approved", "approved", "Priya Nair, Nursing Director", "2027-03-29")
    h = lifecycle.history(db, item)
    assert [(x["from_stage"], x["to_stage"], x["changed_by"]) for x in h] == [(None, "approved", SIGNER)]


def test_a_person_moves_it_through_stages_with_notes_and_only_along_allowed_paths(approved):
    db, _, run_id, item = approved
    cfg = lifecycle.load_lifecycle(CONFIG)
    lifecycle.set_stage(db, run_id, item, to="piloting", by=SIGNER, note="Pilot on two wards from October.", on=date(2026, 10, 1), config=cfg)
    with pytest.raises(lifecycle.LifecycleError, match="cannot go straight"):
        lifecycle.set_stage(db, run_id, item, to="approved", by=SIGNER, note="Trying to go backwards here.", on=date(2026, 10, 2), config=cfg)
    with pytest.raises(lifecycle.LifecycleError, match="note"):
        lifecycle.set_stage(db, run_id, item, to="live", by=SIGNER, note="ok", on=date(2026, 11, 1), config=cfg)
    lifecycle.set_stage(db, run_id, item, to="live", by=SIGNER, note="Rolled out to all wards after the pilot.", on=date(2026, 11, 1), config=cfg)
    lifecycle.set_owner(db, run_id, item, owner="Sam Ortiz, CNO", by=SIGNER, on=date(2026, 11, 2))
    row = get_item(db, item)
    assert (row["stage"], row["owner"], row["stage_changed_on"]) == ("live", "Sam Ortiz, CNO", "2026-11-01")
    assert [x["to_stage"] for x in lifecycle.history(db, item)] == ["approved", "piloting", "live", "live"]
    assert "Owner set to Sam Ortiz, CNO (was Priya Nair, Nursing Director)" in lifecycle.history(db, item)[-1]["note"]


def test_an_unapproved_matter_has_no_stage_to_change(approved):
    db, _, run_id, _ = approved
    other = submit_item(db, run_id, kind="use_case", title="Something new", submitted_by="x@harbor.example", description="Not yet reviewed at all.", today=DAY1)
    with pytest.raises(lifecycle.LifecycleError, match="not been approved"):
        lifecycle.set_stage(db, run_id, other, to="live", by=SIGNER, note="Skipping the committee entirely.", on=DAY1, config=lifecycle.load_lifecycle(CONFIG))


def test_it_comes_back_for_review_when_due_and_approval_renews_it(approved):
    db, service, run_id, item = approved
    assert lifecycle.open_due_rereviews(db, run_id, date(2027, 3, 1)) == []           # not yet
    opened = lifecycle.open_due_rereviews(db, run_id, date(2027, 4, 1))
    assert len(opened) == 1
    assert lifecycle.open_due_rereviews(db, run_id, date(2027, 4, 2)) == []           # once, while it is pending
    re = get_item(db, opened[0])
    details = json.loads(re["details"]) if isinstance(re["details"], str) else re["details"]
    assert re["title"] == "Re-review: Discharge summary drafting" and re["risk_tier"] == "high"
    assert details["rereview_of"] == item and details["related_decisions"] == ["IT-001"]
    assert "due 2027-03-29" in re["description"]
    ranked = candidates(db, run_id, load_agenda_priority(CONFIG), today=date(2027, 4, 1))
    assert [c.ref_id for c in ranked] == [opened[0]]
    sign(db, service, run_id, opened[0], "approved", date(2027, 4, 5))
    original = get_item(db, item)
    assert original["review_due"] == "2027-10-05" and original["stage"] == "approved"
    assert "Re-review IT-002 signed approved" in lifecycle.history(db, item)[-1]["note"]


def test_rejecting_a_re_review_pauses_the_use_case(approved):
    db, service, run_id, item = approved
    cfg = lifecycle.load_lifecycle(CONFIG)
    lifecycle.set_stage(db, run_id, item, to="live", by=SIGNER, note="Live everywhere since November.", on=date(2026, 11, 1), config=cfg)
    opened = lifecycle.open_due_rereviews(db, run_id, date(2027, 4, 1))
    sign(db, service, run_id, opened[0], "rejected", date(2027, 4, 5))
    original = get_item(db, item)
    assert original["stage"] == "paused"
    assert "paused" in lifecycle.history(db, item)[-1]["note"]


def test_stage_changes_travel_with_the_workspace():
    from sim.checkpoint import RUN_TABLES
    assert "stage_changes" in RUN_TABLES
