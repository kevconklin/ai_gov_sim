"""Sending a matter back with context: what the person wrote reaches the committee next time, with what happened before."""

from __future__ import annotations

import json
from datetime import date

import pytest

from conftest import REPO_ROOT
from govern.agenda import candidates
from govern.attestation import apply_meeting, record_attestation
from govern.config import load_agenda_priority, load_attestation, load_config
from govern.db import Database
from govern.intake import get_item, submit_item
from govern.llm import LLMClient
from govern.packet import AgendaItem, build_packet
from govern.panels import load_panels
from govern.service import ReviewService
from govern.workspace import create_workspace
from sim.demo_llm import DemoAnthropic

CONFIG = REPO_ROOT / "config"
DAY1, DAY2 = date(2026, 9, 29), date(2026, 10, 6)
WHO = dict(actor="dana@harbor.example", source="dashboard_session")
NOTE = "Not yet. Look at whether recordings can be kept off when a patient is discussed, and what the vendor retains. Come back with conditions."


@pytest.fixture
def sent_back(tmp_path):
    db = Database.connect_sqlite(tmp_path / "g.sqlite")
    db.migrate(REPO_ROOT / "db" / "migrations")
    config = load_config(CONFIG)
    run_id = create_workspace(db, config, config_dir=CONFIG, data_dir=tmp_path, name="Harbor Health",
                              risk_appetite="Use AI to cut clinician admin time. Never let it make a clinical decision.", today=DAY1, **WHO)
    service = ReviewService(db=db, config=config, llm=LLMClient(db=db, config=config, client=DemoAnthropic(), sleep=lambda s: None),
                            data_dir=tmp_path, panel_rules=load_panels(CONFIG))
    item = submit_item(db, run_id, kind="vendor", title="Otter.ai for clinic meetings", submitted_by="ops@harbor.example",
                       description="Transcribes and summarizes internal meetings.", today=DAY1)
    result = service.convene(run_id, [AgendaItem("IT-001", "item", "AI vendor: Otter.ai for clinic meetings", item)], on=DAY1)
    decision = result.decisions[0]
    record_attestation(db, run_id, decision_id=decision.decision_id, actor="Dana Whitfield <dana@harbor.example>", outcome="deferred",
                       rationale=NOTE, config=load_attestation(CONFIG), source="dashboard_session")
    apply_meeting(service.context(run_id), result.meeting_id, month="2026-09", meeting_date=DAY1)
    return db, service, run_id, item, decision


def test_the_note_is_kept_on_the_matter_and_it_is_waiting_again(sent_back):
    db, _, run_id, item, _ = sent_back
    row = get_item(db, item)
    assert row["status"] == "submitted"
    details = row["details"]
    details = json.loads(details) if isinstance(details, str) else details
    assert details["decider_notes"] == [{"by": "Dana Whitfield <dana@harbor.example>", "on": "2026-09-29", "note": NOTE}]
    assert [c.ref_id for c in candidates(db, run_id, load_agenda_priority(CONFIG), today=DAY2)] == [item]


def test_the_next_review_reads_the_note_and_what_happened_before(sent_back):
    db, service, run_id, item, decision = sent_back
    packet = build_packet(service.context(run_id), month="2026-10", meeting_date=DAY2,
                          agenda=[AgendaItem("IT-001", "item", "AI vendor: Otter.ai for clinic meetings", item)])
    assert "Earlier reviews of this matter" in packet
    assert f"the committee recommended {decision.outcome}" in packet
    assert "sent it back" in packet and "Dana Whitfield" in packet
    assert "From the person deciding" in packet and NOTE in packet
    # the person's direction is the committee's agenda, not submitted text: it sits outside the fence
    assert packet.index("[END SUBMITTED TEXT]") < packet.index(NOTE)


def test_a_second_deferral_keeps_both_notes_in_order(sent_back):
    db, service, run_id, item, _ = sent_back
    result = service.convene(run_id, [AgendaItem("IT-001", "item", "AI vendor: Otter.ai for clinic meetings", item)], on=DAY2)
    record_attestation(db, run_id, decision_id=result.decisions[0].decision_id, actor="Dana Whitfield <dana@harbor.example>",
                       outcome="deferred", rationale="Still missing the retention term. One more look once legal has the contract.",
                       config=load_attestation(CONFIG), source="dashboard_session")
    apply_meeting(service.context(run_id), result.meeting_id, month="2026-10", meeting_date=DAY2)
    details = get_item(db, item)["details"]
    details = json.loads(details) if isinstance(details, str) else details
    assert [n["on"] for n in details["decider_notes"]] == ["2026-09-29", "2026-10-06"]
    back = next(c for c in candidates(db, run_id, load_agenda_priority(CONFIG), today=date(2026, 10, 7)) if c.ref_id == item)
    assert back.deferral_count == 2 and back.escalated
