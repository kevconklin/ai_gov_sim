"""Agenda candidates and their suggested priority (SPEC 5 step 2, human-triggered meetings)."""

from __future__ import annotations

import pytest

from govern.agenda import CandidateFacts, candidates, deferral_count, record_deferral, score
from govern.config import ConfigError, load_agenda_priority

# ---- config ---------------------------------------------------------------


def test_loads_priority_config(agenda_config):
    assert agenda_config.escalate_after == 2
    assert agenda_config.count == "cumulative"
    assert agenda_config.counts_as_deferral == ("tabled",)
    assert set(agenda_config.weights) == {"age_days", "risk_tier", "control_gap", "blocking", "deferral"}


def test_weights_must_sum_to_one_hundred(tmp_path):
    (tmp_path / "agenda_priority.yaml").write_text(
        "deferral:\n  escalate_after: 2\n  count: cumulative\n  counts_as_deferral: [tabled]\n"
        "  escalation: priority_floor_and_alert\nage_days_full_at: 90\n"
        "risk_tier_factors: {low: 0.0, medium: 0.5, high: 1.0}\n"
        "weights:\n  age_days: 20\n  risk_tier: 30\n  control_gap: 25\n  blocking: 15\n  deferral: 5\n"
    )
    with pytest.raises(ConfigError, match="weights must sum to 100"):
        load_agenda_priority(tmp_path)


def test_rejects_zero_escalate_after(tmp_path, agenda_yaml):
    (tmp_path / "agenda_priority.yaml").write_text(agenda_yaml.replace("escalate_after: 2", "escalate_after: 0"))
    with pytest.raises(ConfigError, match="escalate_after"):
        load_agenda_priority(tmp_path)


# ---- scoring --------------------------------------------------------------


def facts(**kw) -> CandidateFacts:
    base = dict(age_days=0, risk_tier="low", control_gap=False, blocking=False, deferral_count=0)
    return CandidateFacts(**{**base, **kw})


def test_quiet_candidate_scores_zero(agenda_config):
    assert score(facts(), agenda_config).priority == 0


def test_high_risk_outranks_low_risk(agenda_config):
    assert score(facts(risk_tier="high"), agenda_config).priority > score(facts(risk_tier="low"), agenda_config).priority


def test_unclassified_risk_scores_like_medium(agenda_config):
    assert score(facts(risk_tier=None), agenda_config).priority == score(facts(risk_tier="medium"), agenda_config).priority


def test_age_raises_priority_and_saturates(agenda_config):
    young, old, ancient = (score(facts(age_days=d), agenda_config).priority for d in (10, 90, 400))
    assert young < old == ancient == agenda_config.weights["age_days"]


def test_control_gap_and_blocking_contribute(agenda_config):
    assert score(facts(control_gap=True), agenda_config).priority == agenda_config.weights["control_gap"]
    assert score(facts(blocking=True), agenda_config).priority == agenda_config.weights["blocking"]


def test_priority_never_exceeds_one_hundred(agenda_config):
    loud = facts(age_days=999, risk_tier="high", control_gap=True, blocking=True, deferral_count=99)
    assert score(loud, agenda_config).priority == 100


def test_reasons_name_only_contributing_signals(agenda_config):
    reasons = score(facts(age_days=47, risk_tier="high"), agenda_config).reasons
    assert "risk tier high" in reasons
    assert "open 47 days" in reasons
    assert not any("blocking" in r for r in reasons)


# ---- escalation -----------------------------------------------------------


def test_escalation_pins_priority_to_floor(agenda_config):
    result = score(facts(deferral_count=2), agenda_config)
    assert result.priority == 100
    assert result.escalated is True
    assert "deferred 2x" in result.reasons


def test_below_threshold_does_not_escalate(agenda_config):
    result = score(facts(deferral_count=1), agenda_config)
    assert result.escalated is False
    assert result.priority < 100


# ---- deferrals ------------------------------------------------------------


def test_deferrals_start_at_zero(db, run_id):
    assert deferral_count(db, run_id, "uc-1") == 0


def test_deferrals_accumulate_across_meetings(db, run_id):
    for n, meeting in enumerate(("m1", "m2", "m3"), start=1):
        record_deferral(db, run_id, ref_id="uc-1", meeting_id=meeting, sim_month="2027-0%d" % n, reason="tabled")
        assert deferral_count(db, run_id, "uc-1") == n


def test_deferrals_are_scoped_per_item_and_run(db, run_id):
    record_deferral(db, run_id, ref_id="uc-1", meeting_id="m1", sim_month="2027-01", reason="tabled")
    assert deferral_count(db, run_id, "uc-2") == 0
    assert deferral_count(db, "other-run", "uc-1") == 0


def test_deferral_ids_are_run_scoped(db, run_id):
    record_deferral(db, run_id, ref_id="uc-1", meeting_id="m1", sim_month="2027-01", reason="tabled")
    row = db.fetch_one("SELECT deferral_id FROM agenda_deferrals WHERE run_id = ?", (run_id,))
    assert row["deferral_id"].startswith(f"{run_id}/")


# ---- candidates -----------------------------------------------------------


@pytest.fixture
def proposed(db, run_id):
    db.insert("meetings", {"meeting_id": "m1", "run_id": run_id, "bank_id": "calder_ridge", "sim_month": "2027-01",
                           "meeting_date": "2027-01-12", "agenda": [], "minutes_json": {}, "minutes_text": "",
                           "status": "closed"})
    db.insert("use_cases", {"use_case_id": f"{run_id}/uc/1", "run_id": run_id, "bank_id": "calder_ridge",
                            "title": "Deposit chatbot", "description": "d", "details": {}, "risk_tier": "high",
                            "status": "proposed", "proposed_month": "2027-01"})
    db.insert("policy_edits", {"edit_id": f"{run_id}/edit/1", "run_id": run_id, "bank_id": "calder_ridge",
                               "meeting_id": "m1", "sim_month": "2027-01", "section": "Scope", "text": "t",
                               "status": "proposed"})
    return run_id


def test_candidates_cover_every_decision_source(db, proposed, agenda_config):
    kinds = {c.kind for c in candidates(db, proposed, agenda_config, today="2027-02-01")}
    assert kinds == {"use_case", "policy_edit"}


def test_candidates_are_ranked_highest_first(db, proposed, agenda_config):
    ranked = candidates(db, proposed, agenda_config, today="2027-02-01")
    assert [c.priority for c in ranked] == sorted((c.priority for c in ranked), reverse=True)


def test_candidate_carries_reasons_and_deferral_count(db, proposed, agenda_config):
    record_deferral(db, proposed, ref_id=f"{proposed}/uc/1", meeting_id="m1", sim_month="2027-01", reason="tabled")
    use_case = next(c for c in candidates(db, proposed, agenda_config, today="2027-02-01") if c.kind == "use_case")
    assert use_case.deferral_count == 1
    assert "risk tier high" in use_case.reasons


def test_decided_items_are_not_candidates(db, proposed, agenda_config):
    db.update("use_cases", {"status": "approved"}, where={"use_case_id": f"{proposed}/uc/1"})
    assert not [c for c in candidates(db, proposed, agenda_config, today="2027-02-01") if c.kind == "use_case"]


def test_deferrals_travel_with_a_fork():
    """Run-scoped rows must be in RUN_TABLES or checkpoints and forks silently drop them."""
    from sim.checkpoint import RUN_TABLES
    assert "agenda_deferrals" in RUN_TABLES
