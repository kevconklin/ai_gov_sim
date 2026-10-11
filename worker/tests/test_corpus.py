"""The corpus: the committee drafts a change, the person sees it, and the signature is the pen."""

from __future__ import annotations

from datetime import date

import pytest

from conftest import REPO_ROOT
from govern import corpus, settings
from govern.attestation import apply_meeting, record_attestation
from govern.config import load_attestation, load_config
from govern.db import Database
from govern.intake import submit_item
from govern.llm import LLMClient
from govern.packet import AgendaItem, build_packet
from govern.panels import load_panels
from govern.policy import PolicyRepo, stats
from govern.service import ReviewService
from govern.workspace import create_workspace
from sim.demo_llm import DemoAnthropic

CONFIG = REPO_ROOT / "config"
TODAY = date(2026, 10, 11)
SIGNER = "Kevin <kevin@dealers.example>"


@pytest.fixture
def org(tmp_path):
    db = Database.connect_sqlite(tmp_path / "g.sqlite")
    db.migrate(REPO_ROOT / "db" / "migrations")
    config = load_config(CONFIG)
    run_id = create_workspace(db, config, config_dir=CONFIG, data_dir=tmp_path, name="Local Auto Dealers", starter="general_business",
                              risk_appetite="Use AI to sell more cars without a customer ever being misled by it.", today=TODAY,
                              actor=SIGNER, source="test")
    service = ReviewService(db=db, config=config, llm=LLMClient(db=db, config=config, client=DemoAnthropic(), sleep=lambda s: None),
                            data_dir=tmp_path, panel_rules=load_panels(CONFIG))
    return db, service, run_id, tmp_path


def sign(db, service, run_id, result, outcome):
    for d in result.decisions:
        record_attestation(db, run_id, decision_id=d.decision_id, actor=SIGNER, outcome=outcome, rationale="Signed in the corpus test, with enough words.",
                           config=load_attestation(CONFIG), source="dashboard_session",
                           responded_to=[r["agent_id"] for r in db.fetch_all("SELECT agent_id FROM votes WHERE meeting_id = ? AND item_id = ?", (result.meeting_id, d.item.item_id))])
    apply_meeting(service.context(run_id), result.meeting_id, month="2026-10", meeting_date=TODAY)


def test_a_revision_to_a_document_applies_as_a_new_version_when_signed_approved(org):
    db, service, run_id, _ = org
    aup = next(d for d in settings.documents(db, run_id) if d["kind"] == "acceptable_use")
    item = submit_item(db, run_id, kind="tool", title="ChatGPT", description="Sales staff draft emails with it.", submitted_by="sales@dealers.example", today=TODAY)
    result = service.convene(run_id, [AgendaItem("IT-002", "item", "AI tool: ChatGPT", item)], on=TODAY)
    chair = db.fetch_one("SELECT agent_id FROM agents WHERE run_id = ? AND seat = 'chair'", (run_id,))["agent_id"]
    rev = corpus.propose(db, run_id, meeting_id=result.meeting_id, item_id="IT-002", agent_id=chair, target="document",
                         title=aup["title"], body=aup["body"] + "\n\n## Customer messages\n\nNo AI-drafted message goes to a customer unread by the salesperson who sends it.",
                         rationale="The gap the review found: customer-facing drafts.")
    assert rev in [r["rev_id"] for r in corpus.proposed_for(db, result.meeting_id, "IT-002")]     # the scripted seats propose too
    sign(db, service, run_id, result, "approved")
    now = settings.documents(db, run_id)
    new = next(d for d in now if d["kind"] == "acceptable_use")
    assert new["version"] == 2 and new["supersedes"] == aup["document_id"] and "Customer messages" in new["body"] and new["added_by"] == SIGNER
    assert db.fetch_one("SELECT retired_at FROM documents WHERE document_id = ?", (aup["document_id"],))["retired_at"]
    assert db.fetch_one("SELECT status, applied_as FROM document_revisions WHERE rev_id = ?", (rev,))["status"] == "applied"
    change = db.fetch_one("SELECT actor, after_value, reason FROM config_changes WHERE run_id = ? AND area = 'document' ORDER BY changed_at DESC, change_id DESC LIMIT 1", (run_id,))
    assert change["actor"] == SIGNER and "version 2" in change["after_value"] and "IT-002" in change["reason"]


def test_a_policy_revision_lands_in_the_policy_on_signature_and_a_rejected_one_is_dropped(org):
    db, service, run_id, data_dir = org
    before = PolicyRepo(data_dir / "policies" / run_id / "local_auto_dealers").read()
    item = submit_item(db, run_id, kind="tool", title="Otter.ai", description="Meeting notes.", submitted_by="ops@dealers.example", today=TODAY)
    result = service.convene(run_id, [AgendaItem("IT-002", "item", "AI tool: Otter.ai", item)], on=TODAY)
    chair = db.fetch_one("SELECT agent_id FROM agents WHERE run_id = ? AND seat = 'chair'", (run_id,))["agent_id"]
    corpus.propose(db, run_id, meeting_id=result.meeting_id, item_id="IT-002", agent_id=chair, target="policy", title="Data and confidentiality",
                   body="AI-GOV-NEW Recordings of meetings are kept no longer than 30 days and never used to train a model.",
                   rationale="Retention was unaddressed.")
    sign(db, service, run_id, result, "approved")
    after = PolicyRepo(data_dir / "policies" / run_id / "local_auto_dealers").read()
    assert "Recordings of meetings" in after and len(stats(after).controls) >= len(stats(before).controls) + 1
    assert all(c in after for c in ("AI-GOV-010", "AI-GOV-011", "AI-GOV-012"))        # "add" kept what the section already said
    # a second review, rejected: its draft is dropped and the policy does not move
    item2 = submit_item(db, run_id, kind="tool", title="Fireflies", description="Another recorder.", submitted_by="ops@dealers.example", today=TODAY)
    result2 = service.convene(run_id, [AgendaItem("IT-003", "item", "AI tool: Fireflies", item2)], on=date(2026, 10, 12))
    corpus.propose(db, run_id, meeting_id=result2.meeting_id, item_id="IT-003", agent_id=chair, target="policy", title="Data and confidentiality",
                   body="AI-GOV-NEW This must not apply.", rationale="Testing the drop.")
    sign(db, service, run_id, result2, "rejected")
    assert "must not apply" not in PolicyRepo(data_dir / "policies" / run_id / "local_auto_dealers").read()
    assert db.fetch_one("SELECT status FROM document_revisions WHERE meeting_id = ?", (result2.meeting_id,))["status"] == "dropped"


def test_every_review_carries_the_documents_with_versions_and_the_register(org):
    db, service, run_id, _ = org
    item = submit_item(db, run_id, kind="vendor", title="DealerChat", description="Answers customer questions on the website.",
                       submitted_by="web@dealers.example", today=TODAY, details={"accountable_owner": "Head of Web Sales"})
    result = service.convene(run_id, [AgendaItem("IT-002", "item", "AI vendor: DealerChat", item)], on=TODAY)
    sign(db, service, run_id, result, "approved")
    packet = build_packet(service.context(run_id), month="2026-10", meeting_date=date(2026, 10, 12), agenda=[AgendaItem("IT-003", "item", "AI tool: x", item)])
    assert "version 1)" in packet and "propose_revision" in packet
    assert "Register of AI decided on" in packet and "DealerChat - approved by Kevin" in packet and "Owner: Head of Web Sales" in packet


def test_a_proposal_needs_a_real_text_and_a_known_target(org):
    db, service, run_id, _ = org
    with pytest.raises(corpus.CorpusError, match="full text"):
        corpus.propose(db, run_id, meeting_id="m", item_id="IT-001", agent_id="a", target="document", title="Something", body="short", rationale="Because reasons.")
    with pytest.raises(corpus.CorpusError, match="kind"):
        corpus.propose(db, run_id, meeting_id="m", item_id="IT-001", agent_id="a", target="document", title="Brand new", body="x" * 40, rationale="Because reasons.")
    with pytest.raises(corpus.CorpusError, match="target"):
        corpus.propose(db, run_id, meeting_id="m", item_id="IT-001", agent_id="a", target="wiki", title="t", body="x" * 40, rationale="Because reasons.")


def test_revisions_travel_with_the_workspace():
    from sim.checkpoint import RUN_TABLES
    assert "document_revisions" in RUN_TABLES
