"""A signed decision is precedent: the committee reads it in later reviews, and a new matter can cite it."""

from __future__ import annotations

from datetime import date

import pytest

from conftest import REPO_ROOT
from govern import precedent
from govern.agenda import candidates
from govern.attestation import apply_meeting, record_attestation
from govern.config import load_agenda_priority, load_attestation, load_config
from govern.db import Database
from govern.intake import submit_item
from govern.llm import LLMClient
from govern.packet import AgendaItem, build_packet
from govern.panels import load_panels
from govern.service import ReviewService
from govern.tools import ToolSession, execute
from govern.workspace import create_workspace
from sim.demo_llm import DemoAnthropic

CONFIG = REPO_ROOT / "config"
DAY1, DAY2 = date(2026, 9, 20), date(2026, 10, 5)
WHO = dict(actor="dana@harbor.example", source="dashboard_session")


@pytest.fixture(scope="module")
def signed(tmp_path_factory):
    """One review held and signed: a vendor approved, against the committee's advice, with reasons."""
    data_dir = tmp_path_factory.mktemp("precedent")
    db = Database.connect_sqlite(data_dir / "g.sqlite")
    db.migrate(REPO_ROOT / "db" / "migrations")
    config = load_config(CONFIG)
    run_id = create_workspace(db, config, config_dir=CONFIG, data_dir=data_dir, name="Harbor Health",
                              risk_appetite="Use AI to cut clinician admin time. Never let it make a clinical decision.", today=DAY1, **WHO)
    service = ReviewService(db=db, config=config, llm=LLMClient(db=db, config=config, client=DemoAnthropic(), sleep=lambda s: None),
                            data_dir=data_dir, panel_rules=load_panels(CONFIG))
    vendor = submit_item(db, run_id, kind="vendor", title="Otter.ai for clinic meetings", submitted_by="ops@harbor.example",
                         description="Transcribes and summarizes internal meetings. No patient data is discussed in them.", today=DAY1)
    ranked = candidates(db, run_id, load_agenda_priority(CONFIG), today=DAY1)
    result = service.convene(run_id, [AgendaItem(c.ref_id.rsplit("/", 1)[-1], c.kind, c.title, c.ref_id) for c in ranked], on=DAY1)
    decision = result.decisions[0]
    against = "rejected" if decision.outcome == "approved" else "approved"      # sign the other way: an overrule, on purpose
    record_attestation(db, run_id, decision_id=decision.decision_id, actor="dana@harbor.example", outcome=against,
                       rationale="Approved only for internal meetings, with recording off when a patient is discussed; the terms were amended to forbid training on our audio."
                       if against == "approved" else "Rejected until the vendor's terms forbid training on our audio.",
                       config=load_attestation(CONFIG), source="dashboard_session",
                       responded_to=[r["agent_id"] for r in db.fetch_all(
                           "SELECT agent_id FROM votes WHERE meeting_id = ? AND item_id = ? AND vote = ?",
                           (result.meeting_id, decision.item.item_id, "no" if against == "approved" else "yes"))])
    apply_meeting(service.context(run_id), result.meeting_id, month="2026-09", meeting_date=DAY1)
    return db, service, run_id, vendor, against


def test_a_signed_decision_is_on_the_record_with_the_persons_reason(signed):
    db, _, run_id, vendor, outcome = signed
    rows = precedent.signed(db, run_id)
    assert len(rows) == 1
    p = rows[0]
    assert (p.display_id, p.kind, p.title, p.outcome) == ("IT-001", "vendor", "Otter.ai for clinic meetings", outcome)
    assert p.actor == "dana@harbor.example" and p.signed_on == "2026-09-20"
    assert p.overruled is True and p.recommended != outcome
    assert p.rationale.startswith(("Approved only", "Rejected until"))
    assert p.item_id == vendor


def test_a_new_matter_finds_precedent_by_citation_and_by_subject(signed):
    db, _, run_id, vendor, _ = signed
    cited = submit_item(db, run_id, kind="tool", title="Fireflies for sales calls", submitted_by="sales@harbor.example",
                        description="Another meeting recorder, this time on calls with prospects.", today=DAY2,
                        details={"related_decisions": ["IT-001"]})
    by_subject = submit_item(db, run_id, kind="vendor", title="Otter.ai for patient intake", submitted_by="ops@harbor.example",
                             description="Extending the Otter.ai transcription we use in clinic meetings to patient intake conversations.", today=DAY2)
    unrelated = submit_item(db, run_id, kind="tool", title="Copilot for spreadsheets", submitted_by="fin@harbor.example",
                            description="Formula help in Excel for the finance team.", today=DAY2)
    assert [(p.display_id, how) for p, how in precedent.related(db, run_id, item_id=cited)] == [("IT-001", "cited")]
    assert [(p.display_id, how) for p, how in precedent.related(db, run_id, item_id=by_subject)] == [("IT-001", "same subject")]
    assert precedent.related(db, run_id, item_id=unrelated) == ()


def test_the_committee_reads_precedent_in_its_pre_read(signed):
    db, service, run_id, _, outcome = signed
    ctx = service.context(run_id)
    cited = db.fetch_one("SELECT item_id FROM items WHERE title = 'Fireflies for sales calls'")["item_id"]
    packet = build_packet(ctx, month="2026-10", meeting_date=DAY2, agenda=[AgendaItem("IT-002", "item", "AI tool: Fireflies for sales calls", cited)])
    assert "Earlier decisions relevant to this agenda" in packet
    assert "IT-001" in packet and "dana@harbor.example" in packet
    assert ("overruling the committee" in packet) is True
    assert "cited by the submitter" in packet
    # the register also says who signed, not just what happened
    assert f"{outcome} by dana@harbor.example on 2026-09-20" in packet


def test_an_adviser_can_read_the_full_record_of_a_decision(signed):
    db, service, run_id, _, outcome = signed
    ctx = service.context(run_id)
    chair = next(a for a in ctx.active_agents() if a.seat == "chair")
    session = ToolSession(ctx=ctx, agent=chair, phase="position", month="2026-10", meeting_id="m2", meeting_date=DAY2)
    text, _ = execute(session, "read_decision", {"item_id": "IT-001"})
    for phrase in ("Otter.ai for clinic meetings", "committee recommended", outcome, "dana@harbor.example", "Reason given"):
        assert phrase in text, phrase
    assert "overrul" in text
    missing, _ = execute(session, "read_decision", {"item_id": "IT-099"})
    assert "No signed decision" in missing


def test_search_finds_intake_decisions_too(signed):
    db, service, run_id, _, _ = signed
    ctx = service.context(run_id)
    chair = next(a for a in ctx.active_agents() if a.seat == "chair")
    session = ToolSession(ctx=ctx, agent=chair, phase="position", month="2026-10", meeting_id="m2", meeting_date=DAY2)
    text, _ = execute(session, "search_decision_log", {"query": "otter meetings"})
    assert "IT-001" in text and "Otter.ai" in text and "signed" in text
