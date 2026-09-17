"""Resolve an approved use case into a sampled plan (SPEC 6.1 steps 1-4).

The engine sees only the formal proposal, the policy text, and company facts: never debate transcripts.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any, Mapping

from sim import prompts
from sim.agents.structured import StructuredOutputError, call_structured, extract, forced, number_range, tool
from sim.engine.rng import RNG
from sim.engine.state import Plan
from sim.llm import LLMClient

log = logging.getLogger(__name__)

ESTIMATORS = ("performance", "effort", "adoption", "risk", "financial")
USE_CASE_TYPES = [
    "customer_service_assistant", "marketing_personalization", "credit_underwriting", "fraud_detection",
    "document_processing", "internal_productivity_genai", "collections", "pricing", "compliance_monitoring",
    "software_engineering", "other",
]

CLASSIFY_TOOL = tool("record_classification", "Record the inventory classification.", {
    "use_case_type": {"type": "string", "enum": USE_CASE_TYPES},
    "risk_tier": {"type": "string", "enum": ["low", "medium", "high"],
                  "description": "high = credit decisions or customer-facing generated content; medium = customer "
                                 "data or material process impact; low = internal and contained"},
    "delivery": {"type": "string", "enum": ["vendor_saas", "custom_build"]},
    "customer_facing": {"type": "boolean"},
    "credit_decision": {"type": "boolean"},
    "staff_genai_tool": {"type": "boolean", "description": "a general assistant or writing tool for employees"},
    "model_validation_required_by_policy": {"type": "boolean"},
    "human_review_in_design": {"type": "boolean"},
    "vendor_due_diligence_required_by_policy": {"type": "boolean"},
    "rationale": {"type": "string"},
})

_TRIANGLE = {"type": "object", "properties": {k: {"type": "number"} for k in ("low", "mode", "high")},
             "required": ["low", "mode", "high"]}

ESTIMATE_TOOLS = {
    "performance": tool("record_estimate", "Record the estimate.", {
        "metric": {"type": "string"}, "lift": number_range("fractional accuracy or business lift"),
        "notes": {"type": "string"}}),
    "effort": tool("record_estimate", "Record the estimate.", {
        "person_weeks": number_range("internal delivery effort"),
        "calendar_months": number_range("months to go live"),
        "dependencies": {"type": "array", "items": {"type": "string"}}}),
    "adoption": tool("record_estimate", "Record the estimate.", {
        "peak_uptake": number_range("share of intended users at steady state, 0 to 1"),
        "months_to_peak": number_range("months after launch"),
        "training_hours_per_user": {"type": "number"},
        "resistance": {"type": "string", "enum": ["low", "medium", "high"]}}),
    "risk": tool("record_estimate", "Record the estimate.", {
        "incident_prob_per_month": number_range("probability of a reportable incident per live month"),
        "severity_mix": {"type": "object", "properties": {k: {"type": "number"} for k in ("low", "medium", "high")},
                         "required": ["low", "medium", "high"]},
        "fair_lending_exposure_change": number_range("points on a 0-100 scale"),
        "privacy_exposure": {"type": "string", "enum": ["low", "medium", "high"]},
        "complaint_rate_change_per_10k": number_range("complaints per 10,000 customers per month")}),
    "financial": tool("record_estimate", "Record the estimate.", {
        "revenue_per_month_full_usd": number_range("incremental revenue per month at full adoption"),
        "run_cost_per_month_usd": number_range("ongoing cost per month"),
        "one_time_cost_usd": number_range("implementation cost")}),
}


@dataclass(frozen=True)
class Resolution:
    classification: Mapping[str, Any]
    estimates: Mapping[str, Any]
    priors: Mapping[str, Any]
    blended: Mapping[str, Any]
    plan: Plan


def _proposal_text(use_case: Mapping[str, Any]) -> str:
    details = json.loads(use_case["details"]) if isinstance(use_case["details"], str) else use_case["details"]
    return json.dumps({"title": use_case["title"], "description": use_case["description"], **details}, indent=2)


RISK_TIERS = ("low", "medium", "high")
DELIVERY = ("vendor_saas", "custom_build")


def normalize_classification(raw: Mapping[str, Any], use_case: Mapping[str, Any]) -> dict[str, Any]:
    """Keep the engine safe from out-of-enum classifier output (e.g. delivery "undecided" copied from the proposal).

    A proposal may legitimately leave delivery undecided; the engine still needs one of its two cost models, so a
    named vendor means vendor_saas and anything else is treated as a build.
    """
    result = dict(raw)
    raw_details = use_case["details"]                     # sqlite3.Row supports indexing, not .get
    details = json.loads(raw_details) if isinstance(raw_details, str) else dict(raw_details or {})
    if result.get("delivery") not in DELIVERY:
        vendor_named = bool(details.get("vendor_name")) or details.get("delivery") == "vendor"
        log.warning("classifier returned delivery %r; using %s", result.get("delivery"),
                    "vendor_saas" if vendor_named else "custom_build")
        result["delivery"] = "vendor_saas" if vendor_named else "custom_build"
    if result.get("risk_tier") not in RISK_TIERS:
        log.warning("classifier returned risk_tier %r; using medium", result.get("risk_tier"))
        result["risk_tier"] = "medium"
    for flag in ("customer_facing", "credit_decision", "staff_genai_tool", "model_validation_required_by_policy",
                 "human_review_in_design", "vendor_due_diligence_required_by_policy"):
        result[flag] = bool(result.get(flag))
    return result


def classify(llm: LLMClient, *, run_id: str, month: str, use_case: Mapping[str, Any], policy_text: str,
             max_tokens: int) -> dict[str, Any]:
    fields = dict(
        role="utility", purpose="engine_classify", run_id=run_id, sim_month=month, max_tokens=max_tokens,
        system_fixed=(prompts.render("world/classifier.md"),),
        messages=({"role": "user", "content": f"Proposal:\n{_proposal_text(use_case)}\n\n"
                                               f"Current AI policy:\n{policy_text or '(no policy adopted yet)'}"},),
    )
    return normalize_classification(call_structured(llm, fields, CLASSIFY_TOOL), use_case)


def estimate_many(llm: LLMClient, *, run_id: str, month: str, max_tokens: int,
                  items: Mapping[str, tuple[Mapping[str, Any], Mapping[str, Any]]]) -> dict[str, dict[str, Any]]:
    """Five estimator calls per use case, all in one Batch API job.

    items maps a short key ([A-Za-z0-9_-]) to (use_case row, classification). A failed estimator yields None,
    and blending then falls back to the prior for that estimator's variables.
    """
    if not items:
        return {}
    focus = prompts.load_yaml("world/estimator_focus.yaml")
    system = prompts.render("world/estimator.md")
    requests = {}
    for key, (use_case, classification) in items.items():
        body = f"Initiative:\n{_proposal_text(use_case)}\n\nInventory classification:\n{json.dumps(classification, indent=2)}"
        for name in ESTIMATORS:
            requests[f"{key}-{name}"] = forced(dict(
                role="estimator", purpose=f"estimator_{name}", run_id=run_id, sim_month=month,
                max_tokens=max_tokens, system_fixed=(system,),
                messages=({"role": "user", "content": f"{focus[name]}\n\n{body}"},),
            ), ESTIMATE_TOOLS[name])
    results = llm.wait_for_batch(llm.submit_batch(requests, run_id=run_id))
    estimates: dict[str, dict[str, Any]] = {}
    for key in items:
        estimates[key] = {}
        for name in ESTIMATORS:
            try:
                estimates[key][name] = extract(results[f"{key}-{name}"], "record_estimate")
            except StructuredOutputError as error:
                log.warning("estimator %s for %s unusable, using priors: %s", name, key, error)
                estimates[key][name] = None
    return estimates


def _triangle(value: Any) -> dict[str, float] | None:
    try:
        low, mode, high = sorted(float(value[k]) for k in ("low", "mode", "high"))
    except (TypeError, KeyError, ValueError):
        return None
    return {"low": low, "mode": mode, "high": high}


def _mix(prior: Mapping[str, float], llm_range: Mapping[str, float] | None, weight: float) -> dict[str, float]:
    if llm_range is None:
        return dict(prior)
    return {k: weight * float(prior[k]) + (1 - weight) * llm_range[k] for k in ("low", "mode", "high")}


def _get(estimates: Mapping[str, Any], name: str, field: str) -> dict[str, float] | None:
    block = estimates.get(name)
    return _triangle(block.get(field)) if isinstance(block, Mapping) else None


def blend(classification: Mapping[str, Any], estimates: Mapping[str, Any], params: Mapping[str, Any]) -> tuple[dict, dict]:
    tier, delivery = classification["risk_tier"], classification["delivery"]
    w = float(params["estimator_prior_weight"])
    mods = params["incident_prob_modifiers"]
    p = params["incident_prob_per_month"][f"tier_{tier}"]
    if not classification.get("model_validation_required_by_policy"):
        p *= mods["no_model_validation"]
    if not classification.get("human_review_in_design"):
        p *= mods["no_human_review"]
    if delivery == "vendor_saas" and classification.get("vendor_due_diligence_required_by_policy"):
        p *= mods["vendor_risk_assessment_done"]
    spread = params["fallbacks"]["incident_prob_spread"]
    fb = params["fallbacks"]
    priors = {
        "revenue_per_month_full_usd": params["revenue_per_month_full_adoption_usd"][f"tier_{tier}"],
        "run_cost_per_month_usd": params["run_cost_per_month_usd"][delivery],
        "one_time_cost_usd": params["one_time_cost_usd"][delivery],
        "adoption_peak": params["adoption_peak"],
        "months_to_peak": params["months_to_peak"],
        "person_weeks": fb["person_weeks"],
        "effort_overrun_multiplier": params["effort_overrun_multiplier"][delivery],
        "incident_prob_per_month": {"low": p * spread[0], "mode": p * spread[1], "high": p * spread[2]},
        "severity_mix": params["incident_severity_mix"][f"tier_{tier}"],
        "fair_lending_exposure_change": fb["fair_lending_exposure_change"],
        "complaint_rate_change_per_10k": fb["complaint_rate_change_per_10k"],
    }
    llm_mix = (estimates.get("risk") or {}).get("severity_mix") if isinstance(estimates.get("risk"), Mapping) else None
    try:
        total = sum(float(llm_mix[k]) for k in ("low", "medium", "high")) if llm_mix else 0.0
    except (TypeError, KeyError, ValueError):
        total = 0.0
    severity = {
        k: w * priors["severity_mix"][k] + (1 - w) * (float(llm_mix[k]) / total if total > 0 else priors["severity_mix"][k])
        for k in ("low", "medium", "high")
    }
    blended = {
        "revenue_per_month_full_usd": _mix(priors["revenue_per_month_full_usd"], _get(estimates, "financial", "revenue_per_month_full_usd"), w),
        "run_cost_per_month_usd": _mix(priors["run_cost_per_month_usd"], _get(estimates, "financial", "run_cost_per_month_usd"), w),
        "one_time_cost_usd": _mix(priors["one_time_cost_usd"], _get(estimates, "financial", "one_time_cost_usd"), w),
        "adoption_peak": _mix(priors["adoption_peak"], _get(estimates, "adoption", "peak_uptake"), w),
        "months_to_peak": _mix(priors["months_to_peak"], _get(estimates, "adoption", "months_to_peak"), w),
        "person_weeks": _get(estimates, "effort", "person_weeks") or dict(priors["person_weeks"]),
        "incident_prob_per_month": _mix(priors["incident_prob_per_month"], _get(estimates, "risk", "incident_prob_per_month"), w),
        "severity_mix": severity,
        "fair_lending_exposure_change": _mix(priors["fair_lending_exposure_change"], _get(estimates, "risk", "fair_lending_exposure_change"), w),
        "complaint_rate_change_per_10k": _mix(priors["complaint_rate_change_per_10k"], _get(estimates, "risk", "complaint_rate_change_per_10k"), w),
    }
    return priors, blended


def sample_plan(rng: RNG, *, month: str, decision_id: str, classification: Mapping[str, Any],
                priors: Mapping[str, Any], blended: Mapping[str, Any], params: Mapping[str, Any]) -> Plan:
    def tri(name: str) -> float:
        return rng.draw(name, "triangular", blended[name], sim_month=month, key=(decision_id,), decision_id=decision_id)

    overrun = priors["effort_overrun_multiplier"]
    estimated = blended["person_weeks"]["mode"]
    actual = tri("person_weeks") * rng.draw("effort_overrun", overrun["dist"], overrun, sim_month=month,
                                            key=(decision_id,), decision_id=decision_id)
    return Plan(
        delivery=classification["delivery"],
        risk_tier=classification["risk_tier"],
        estimated_person_weeks=max(1.0, estimated),
        actual_person_weeks=max(1.0, actual),
        one_time_cost_usd=max(0.0, tri("one_time_cost_usd")),
        run_cost_per_month_usd=max(0.0, tri("run_cost_per_month_usd")),
        revenue_per_month_full_usd=max(0.0, tri("revenue_per_month_full_usd")),
        adoption_peak=min(1.0, max(0.0, tri("adoption_peak"))),
        months_to_peak=max(1.0, tri("months_to_peak")),
        incident_prob_per_month=min(float(params["max_incident_prob_per_month"]), max(0.0, tri("incident_prob_per_month"))),
        severity_mix=dict(blended["severity_mix"]),
        fair_lending_exposure_change=tri("fair_lending_exposure_change"),
        complaint_rate_change_per_10k=max(0.0, tri("complaint_rate_change_per_10k")),
    )
