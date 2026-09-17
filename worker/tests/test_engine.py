from __future__ import annotations

import pytest

from sim.engine.advance import advance_month, policy_signals
from sim.engine.pipeline import blend, sample_plan
from sim.engine.report import build_report
from sim.engine.rng import RNG, derive_seed, stable_int
from sim.engine.state import Plan, Project, initial_state

CLASSIFICATION = {
    "use_case_type": "credit_underwriting", "risk_tier": "high", "delivery": "vendor_saas", "customer_facing": True,
    "credit_decision": True, "staff_genai_tool": False, "model_validation_required_by_policy": False,
    "human_review_in_design": True, "vendor_due_diligence_required_by_policy": True, "rationale": "x",
}


def _plan(**overrides):
    base = dict(delivery="vendor_saas", risk_tier="medium", estimated_person_weeks=40, actual_person_weeks=60,
                one_time_cost_usd=120000, run_cost_per_month_usd=10000, revenue_per_month_full_usd=100000,
                adoption_peak=0.5, months_to_peak=4, incident_prob_per_month=0.0,
                severity_mix={"low": 1, "medium": 0, "high": 0}, fair_lending_exposure_change=5,
                complaint_rate_change_per_10k=0.5)
    base.update(overrides)
    return Plan(**base)


def _project(**overrides):
    base = dict(use_case_id="run1/uc/1", title="Loan assistant", status="building", customer_facing=True,
                credit_decision=True, staff_genai_tool=False, plan=_plan(), approved_month="2027-01")
    base.update(overrides)
    return Project(**base)


def test_same_seed_gives_same_draws_and_logs_them(db, run_id):
    rng = RNG(db, run_id, 777)
    first = rng.draw("x", "triangular", {"low": 0, "mode": 1, "high": 5}, sim_month="2027-02", key=("a",))
    second = rng.draw("x", "triangular", {"low": 0, "mode": 1, "high": 5}, sim_month="2027-02", key=("a",))
    other = rng.draw("x", "triangular", {"low": 0, "mode": 1, "high": 5}, sim_month="2027-03", key=("a",))
    assert first == second != other
    rows = db.fetch_all("SELECT variable, seed, value FROM engine_draws")
    assert len(rows) == 3 and rows[0]["variable"] == "x:a" and rows[0]["value"] == first


@pytest.mark.parametrize("dist,params", [
    ("lognormal", {"median": 1.2, "sigma": 0.3}), ("bernoulli", {"p": 0.5}), ("uniform", {"low": 1, "high": 2}),
    ("normal", {"mean": 0, "sd": 1}), ("choice", {"weights": [1, 2]}), ("triangular", {"low": 2, "mode": 2, "high": 2}),
])
def test_supported_distributions(db, run_id, dist, params):
    RNG(db, run_id, 1).draw("v", dist, params, sim_month="2027-01")


def test_bad_distribution_inputs_fail(db, run_id):
    rng = RNG(db, run_id, 1)
    with pytest.raises(ValueError):
        rng.draw("v", "pareto", {}, sim_month="2027-01")
    with pytest.raises(ValueError):
        rng.draw("v", "choice", {"weights": [0, 0]}, sim_month="2027-01")


def test_derived_seeds_and_cosmetic_ints_are_stable():
    assert derive_seed(1, "a") == derive_seed(1, "a") != derive_seed(2, "a")
    assert stable_int(1, 28, "x") == stable_int(1, 28, "x")


def test_project_builds_then_goes_live_and_earns(db, run_id, world):
    rng = RNG(db, run_id, 777)
    state = initial_state(world.bank_profile, "2027-01").with_project(_project())
    params = world.engine_params
    month1 = advance_month(state, "2027-02", rng, params, {})
    assert month1.state.project("run1/uc/1").status == "building"      # 60 person-weeks, 46 of capacity
    month2 = advance_month(month1.state, "2027-03", rng, params, {})
    assert month2.status_changes == (("run1/uc/1", "building", "live"),)
    assert month2.state.project("run1/uc/1").live_month == "2027-03"
    month3 = advance_month(month2.state, "2027-04", rng, params, {})
    assert month3.state.financials.ai_revenue_monthly > 0
    assert month3.state.risk.customer_complaint_rate > state.risk.customer_complaint_rate


def test_capacity_limits_delivery(db, run_id, world):
    rng = RNG(db, run_id, 777)
    big = _project(plan=_plan(actual_person_weeks=100))
    state = initial_state(world.bank_profile, "2027-01").with_project(big)
    result = advance_month(state, "2027-02", rng, world.engine_params, {})
    project = result.state.project(big.use_case_id)
    assert project.status == "building"
    assert project.person_weeks_done == pytest.approx(46)
    assert result.state.financials.ai_spend_monthly == pytest.approx(120000 * 46 / 100)
    second = advance_month(result.state, "2027-03", rng, world.engine_params, {})
    third = advance_month(second.state, "2027-04", rng, world.engine_params, {})
    assert third.state.project(big.use_case_id).status == "live"
    fourth = advance_month(third.state, "2027-05", rng, world.engine_params, {})
    assert fourth.state.financials.ai_revenue_monthly == pytest.approx(100000 * 0.5 * 0.25)


def test_certain_incident_fires_with_effects(db, run_id, world):
    rng = RNG(db, run_id, 777)
    live = _project(status="live", live_month="2027-01",
                    plan=_plan(incident_prob_per_month=1.0, severity_mix={"low": 0, "medium": 0, "high": 1}))
    state = initial_state(world.bank_profile, "2027-01").with_project(live)
    result = advance_month(state, "2027-02", rng, world.engine_params, {})
    assert [(e.type, e.severity) for e in result.events] == [("model_error", "high")]
    assert result.state.risk.customer_complaint_rate > state.risk.customer_complaint_rate
    assert result.state.risk.incidents[0].kind == "fair_lending_issue"


def test_budget_overrun_event(db, run_id, world):
    rng = RNG(db, run_id, 777)
    state = initial_state(world.bank_profile, "2027-01")
    state = state.model_copy(update={"financials": state.financials.model_copy(update={"ai_budget_remaining": 100})})
    state = state.with_project(_project(status="live", live_month="2027-01"))
    result = advance_month(state, "2027-02", rng, world.engine_params, {})
    assert any(e.type == "budget_overrun" for e in result.events)


def test_paused_and_retired_projects(db, run_id, world):
    rng = RNG(db, run_id, 777)
    state = initial_state(world.bank_profile, "2027-01")
    state = state.with_project(_project(use_case_id="p", status="paused"))
    state = state.with_project(_project(use_case_id="r", status="retired"))
    result = advance_month(state, "2027-02", rng, world.engine_params, {"acceptable_use_control": True})
    assert result.state.project("p").cost_last_month == pytest.approx(5000)
    assert result.state.project("r").cost_last_month == 0


def test_policy_signals():
    assert policy_signals("AI-GOV-003: Staff may use only approved AI tools.")["acceptable_use_control"]
    assert not policy_signals("")["acceptable_use_control"]


def test_blend_uses_priors_when_estimates_missing(world):
    params = world.engine_params
    priors, blended = blend(CLASSIFICATION, {name: None for name in ("performance", "effort", "adoption", "risk", "financial")}, params)
    assert blended["revenue_per_month_full_usd"] == priors["revenue_per_month_full_usd"]
    # high tier 0.05 x no validation 1.8 x vendor diligence 0.7
    assert priors["incident_prob_per_month"]["mode"] == pytest.approx(0.05 * 1.8 * 0.7)


def test_blend_weights_llm_and_prior(world):
    estimates = {"financial": {"revenue_per_month_full_usd": {"low": 0, "mode": 0, "high": 0},
                               "run_cost_per_month_usd": "garbage"},
                 "risk": {"severity_mix": {"low": 2, "medium": 2, "high": 0}}}
    priors, blended = blend(CLASSIFICATION, estimates, world.engine_params)
    assert blended["revenue_per_month_full_usd"]["mode"] == pytest.approx(0.5 * priors["revenue_per_month_full_usd"]["mode"])
    assert blended["run_cost_per_month_usd"] == priors["run_cost_per_month_usd"]
    assert sum(blended["severity_mix"].values()) == pytest.approx(1.0)


def test_sample_plan_is_reproducible(db, run_id, world):
    priors, blended = blend(CLASSIFICATION, {}, world.engine_params)
    plans = [sample_plan(RNG(db, run_id, 777), month="2027-02", decision_id="run1/decision/1",
                         classification=CLASSIFICATION, priors=priors, blended=blended, params=world.engine_params)
             for _ in range(2)]
    assert plans[0] == plans[1]
    assert plans[0].actual_person_weeks > 0 and 0 <= plans[0].adoption_peak <= 1


def test_report_shows_delayed_noisy_figures(db, run_id, world):
    rng = RNG(db, run_id, 777)
    state = initial_state(world.bank_profile, "2027-01").with_project(
        _project(status="live", live_month="2026-12", live_months=3, revenue_last_month=40000))
    history = {m: state.model_copy(update={"sim_month": m}) for m in ("2027-01", "2027-02", "2027-03")}
    report = build_report(history, report_month="2027-04", rng=rng, params=world.engine_params, bank_name="Calder Ridge Bank")
    assert "Calder Ridge Bank" in report.text and "Loan assistant" in report.text
    assert "staff_survey_unapproved_ai_tool_use" in report.reported      # April starts a new quarter
    row = report.reported["use_cases"][0]
    assert row["status"] == "live"


def test_classification_is_normalized_before_the_engine_uses_it(world):
    from sim.engine.pipeline import normalize_classification
    vendor_case = {"details": '{"vendor_name": "Brevanta", "delivery": "vendor"}'}
    build_case = {"details": '{"delivery": "undecided"}'}
    raw = {"delivery": "undecided", "risk_tier": "unknown", "customer_facing": "yes"}
    assert normalize_classification(raw, vendor_case)["delivery"] == "vendor_saas"
    assert normalize_classification(raw, build_case)["delivery"] == "custom_build"
    assert normalize_classification(raw, build_case)["risk_tier"] == "medium"
    assert normalize_classification(raw, build_case)["customer_facing"] is True
    # normalized output must satisfy the engine's priors and produce a usable plan
    priors, blended = blend(normalize_classification(raw, build_case), {}, world.engine_params)
    assert blended["run_cost_per_month_usd"] == priors["run_cost_per_month_usd"]
