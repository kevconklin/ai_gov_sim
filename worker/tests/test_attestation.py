"""The human attestation gate: no committee recommendation takes effect without a person on record."""

from __future__ import annotations

from datetime import date

import pytest

from conftest import REPO_ROOT
from sim.agenda import deferral_count
from sim.attestation import (Attestation, AttestationInvalid, AttestationRequired, apply_attested, attestation_for,
                             dissents, record_attestation)
from sim.config import load_attestation
from sim.context import RunContext
from sim.decisions import Decision, Tally
from sim.packet import AgendaItem
from sim.world import load_world

MONTH = "2027-01"
RATIONALE = "Approved on the condition that the vendor SOC 2 report lands before build starts."


@pytest.fixture
def attest_config():
    return load_attestation(REPO_ROOT / "config")


@pytest.fixture
def ctx(db, run_id, tmp_path, config):
    world = load_world(REPO_ROOT / "config")
    run = dict(db.fetch_one("SELECT * FROM runs WHERE run_id = ?", (run_id,)))
    for seat in ("coo_chair", "ciso", "cfo"):
        p = world.persona("calder_ridge", seat)
        db.insert("agents", {"agent_id": f"{run_id}/agent/{seat}", "run_id": run_id, "bank_id": "calder_ridge",
                             "seat": seat, "name": p.name, "title": p.title, "persona_file": p.path,
                             "active_from": MONTH, "active_to": None, "stance_baseline": p.stance_baseline})
    db.insert("meetings", {"meeting_id": f"{run_id}/meeting/{MONTH}", "run_id": run_id, "bank_id": "calder_ridge",
                           "sim_month": MONTH, "meeting_date": "2027-01-12", "agenda": [], "status": "open"})
    context = RunContext(db=db, llm=None, world=world, config=config, run=run, data_dir=tmp_path)
    context.policy_repo.init("Calder Ridge Bank", "c@example.com", date(2026, 12, 28))
    return context


def make_decision(ctx, *, risk_tier="high", approved=True, votes=(("ciso", "no"), ("cfo", "yes"))) -> Decision:
    run_id, meeting_id = ctx.run_id, f"{ctx.run_id}/meeting/{MONTH}"
    use_case_id = f"{run_id}/uc/1"
    ctx.db.insert("use_cases", {"use_case_id": use_case_id, "run_id": run_id, "bank_id": "calder_ridge",
                                "title": "Deposit chatbot", "description": "d", "details": {}, "risk_tier": risk_tier,
                                "status": "proposed", "proposed_month": MONTH})
    for seat, vote in votes:
        ctx.db.insert("votes", {"run_id": run_id, "meeting_id": meeting_id, "agent_id": f"{run_id}/agent/{seat}",
                                "item_id": "UC-001", "vote": vote, "rationale": f"{seat} said {vote}"})
    item = AgendaItem("UC-001", "use_case", "New AI initiative: Deposit chatbot", use_case_id)
    tally = Tally(yes=1, no=1, abstain=0, approved=approved, tie_broken=False)
    decision = Decision(f"{run_id}/decision/UC-001", item, tally)
    ctx.db.insert("decisions", {
        "decision_id": decision.decision_id, "run_id": run_id, "bank_id": "calder_ridge", "meeting_id": meeting_id,
        "sim_month": MONTH, "item_id": "UC-001", "kind": "use_case", "ref_id": use_case_id,
        "outcome": decision.outcome, "yes_votes": 1, "no_votes": 1, "abstentions": 0, "tie_broken": False,
    })
    return decision


def attest(ctx, decision, config, **kw):
    args = dict(decision_id=decision.decision_id, actor="user@bank.example", outcome="approved",
                rationale=RATIONALE, responded_to=(f"{ctx.run_id}/agent/ciso",))
    return record_attestation(ctx.db, ctx.run_id, config=config, **{**args, **kw})


# ---- dissent --------------------------------------------------------------


def test_dissent_on_a_carried_item_is_the_no_votes(ctx):
    decision = make_decision(ctx)
    assert [d.agent_id for d in dissents(ctx.db, decision)] == [f"{ctx.run_id}/agent/ciso"]


def test_dissent_on_a_failed_item_is_the_yes_votes(ctx):
    decision = make_decision(ctx, approved=False)
    assert [d.agent_id for d in dissents(ctx.db, decision)] == [f"{ctx.run_id}/agent/cfo"]


def test_abstention_is_never_dissent(ctx):
    decision = make_decision(ctx, votes=(("ciso", "abstain"), ("cfo", "yes")))
    assert dissents(ctx.db, decision) == ()


def test_dissent_carries_the_rationale(ctx):
    decision = make_decision(ctx)
    assert dissents(ctx.db, decision)[0].rationale == "ciso said no"


# ---- recording ------------------------------------------------------------


def test_rejects_an_unknown_outcome(ctx, attest_config):
    decision = make_decision(ctx)
    with pytest.raises(AttestationInvalid, match="outcome"):
        attest(ctx, decision, attest_config, outcome="maybe")


def test_rejects_a_rationale_too_thin_to_be_oversight(ctx, attest_config):
    decision = make_decision(ctx)
    with pytest.raises(AttestationInvalid, match="rationale"):
        attest(ctx, decision, attest_config, rationale="ok")


def test_high_tier_requires_a_response_to_every_dissent(ctx, attest_config):
    decision = make_decision(ctx, risk_tier="high")
    with pytest.raises(AttestationInvalid, match="ciso"):
        attest(ctx, decision, attest_config, responded_to=())


def test_high_tier_passes_once_every_dissent_is_answered(ctx, attest_config):
    decision = make_decision(ctx, risk_tier="high")
    assert attest(ctx, decision, attest_config).outcome == "approved"


def test_low_tier_needs_no_dissent_response(ctx, attest_config):
    decision = make_decision(ctx, risk_tier="low")
    assert attest(ctx, decision, attest_config, responded_to=()).outcome == "approved"


def test_attestation_round_trips(ctx, attest_config):
    decision = make_decision(ctx)
    attest(ctx, decision, attest_config)
    stored = attestation_for(ctx.db, decision.decision_id)
    assert isinstance(stored, Attestation)
    assert stored.actor == "user@bank.example"
    assert stored.rationale == RATIONALE


def test_attestation_ids_are_run_scoped(ctx, attest_config):
    decision = make_decision(ctx)
    assert attest(ctx, decision, attest_config).attestation_id.startswith(f"{ctx.run_id}/")


def test_override_is_flagged(ctx, attest_config):
    decision = make_decision(ctx, approved=True)
    assert attest(ctx, decision, attest_config, outcome="approved").overrides(decision) is False
    ctx.db.execute("DELETE FROM attestations")
    assert attest(ctx, decision, attest_config, outcome="rejected").overrides(decision) is True


def test_attestations_travel_with_a_fork():
    from sim.checkpoint import RUN_TABLES
    assert "attestations" in RUN_TABLES


# ---- the gate -------------------------------------------------------------


def test_unattested_decisions_are_refused(ctx):
    decision = make_decision(ctx)
    with pytest.raises(AttestationRequired, match="UC-001"):
        apply_attested(ctx, [decision], month=MONTH, meeting_date=date(2027, 1, 12))
    assert ctx.db.fetch_one("SELECT status FROM use_cases WHERE use_case_id = ?", (decision.item.ref_id,))["status"] \
        == "proposed"


def test_the_human_outcome_wins_over_the_committee(ctx, attest_config):
    decision = make_decision(ctx, approved=True)
    attest(ctx, decision, attest_config, outcome="rejected")
    apply_attested(ctx, [decision], month=MONTH, meeting_date=date(2027, 1, 12))
    assert ctx.db.fetch_one("SELECT status FROM use_cases WHERE use_case_id = ?",
                            (decision.item.ref_id,))["status"] == "rejected"


def test_affirmed_decisions_apply(ctx, attest_config):
    decision = make_decision(ctx, approved=True)
    attest(ctx, decision, attest_config, outcome="approved")
    apply_attested(ctx, [decision], month=MONTH, meeting_date=date(2027, 1, 12))
    assert ctx.db.fetch_one("SELECT status FROM use_cases WHERE use_case_id = ?",
                            (decision.item.ref_id,))["status"] == "approved"


def test_deferral_records_a_tabling_and_applies_nothing(ctx, attest_config):
    decision = make_decision(ctx, approved=True)
    attest(ctx, decision, attest_config, outcome="deferred")
    apply_attested(ctx, [decision], month=MONTH, meeting_date=date(2027, 1, 12))
    assert deferral_count(ctx.db, ctx.run_id, decision.item.ref_id) == 1
    assert ctx.db.fetch_one("SELECT status FROM use_cases WHERE use_case_id = ?",
                            (decision.item.ref_id,))["status"] == "proposed"


def test_attesting_to_an_unknown_decision_is_refused(ctx, attest_config):
    with pytest.raises(AttestationInvalid, match="no decision"):
        record_attestation(ctx.db, ctx.run_id, decision_id="nope", actor="a@b.c", outcome="approved",
                           rationale=RATIONALE, config=attest_config)


def test_status_change_inherits_the_use_case_risk_tier(ctx, attest_config):
    """A pause or resume on a high-tier use case is high-tier too, so dissent must be answered."""
    decision = make_decision(ctx, risk_tier="high")
    change_id = f"{ctx.run_id}/change/1"
    ctx.db.insert("status_changes", {"change_id": change_id, "run_id": ctx.run_id,
                                     "meeting_id": f"{ctx.run_id}/meeting/{MONTH}", "sim_month": MONTH,
                                     "use_case_id": decision.item.ref_id, "new_status": "paused", "status": "proposed"})
    ctx.db.update("decisions", {"kind": "status_change", "ref_id": change_id},
                  where={"decision_id": decision.decision_id})
    with pytest.raises(AttestationInvalid, match="ciso"):
        attest(ctx, decision, attest_config, responded_to=())


def test_policy_edits_carry_no_risk_tier(ctx, attest_config):
    decision = make_decision(ctx, risk_tier="high")
    ctx.db.update("decisions", {"kind": "policy_edit", "ref_id": f"{ctx.run_id}/edit/1"},
                  where={"decision_id": decision.decision_id})
    assert attest(ctx, decision, attest_config, responded_to=()).outcome == "approved"


# ---- rebuilding a meeting's decisions -------------------------------------


def test_decisions_are_rebuilt_from_the_meeting_record(ctx):
    from sim.decisions import decisions_for_meeting
    decision = make_decision(ctx)
    ctx.db.update("meetings", {"agenda": [decision.item.to_json()]},
                  where={"meeting_id": f"{ctx.run_id}/meeting/{MONTH}"})
    rebuilt = decisions_for_meeting(ctx, f"{ctx.run_id}/meeting/{MONTH}")
    assert [d.decision_id for d in rebuilt] == [decision.decision_id]
    assert rebuilt[0].item.title == decision.item.title
    assert rebuilt[0].tally.approved is True


def test_a_decision_with_no_agenda_entry_still_rebuilds(ctx):
    from sim.decisions import decisions_for_meeting
    make_decision(ctx)
    rebuilt = decisions_for_meeting(ctx, f"{ctx.run_id}/meeting/{MONTH}")
    assert rebuilt[0].item.title == "UC-001"


def test_apply_meeting_refuses_until_every_item_is_attested(ctx):
    from sim.attestation import apply_meeting
    make_decision(ctx)
    with pytest.raises(AttestationRequired):
        apply_meeting(ctx, f"{ctx.run_id}/meeting/{MONTH}", month=MONTH, meeting_date=date(2027, 1, 12))


def test_apply_meeting_applies_what_was_attested(ctx, attest_config):
    from sim.attestation import apply_meeting
    decision = make_decision(ctx)
    attest(ctx, decision, attest_config, outcome="approved")
    apply_meeting(ctx, f"{ctx.run_id}/meeting/{MONTH}", month=MONTH, meeting_date=date(2027, 1, 12))
    assert ctx.db.fetch_one("SELECT status FROM use_cases WHERE use_case_id = ?",
                            (decision.item.ref_id,))["status"] == "approved"


def test_how_the_identity_was_established_is_recorded(ctx, attest_config):
    """The record says a person is accountable, so it should also say how that name was arrived at."""
    decision = make_decision(ctx)
    attest(ctx, decision, attest_config, source="dashboard_session")
    assert attestation_for(ctx.db, decision.decision_id).source == "dashboard_session"


def test_an_unstated_source_is_recorded_as_unknown_not_assumed_verified(ctx, attest_config):
    decision = make_decision(ctx)
    attest(ctx, decision, attest_config)
    assert attestation_for(ctx.db, decision.decision_id).source == "unknown"
