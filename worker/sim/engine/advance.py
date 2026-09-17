"""Advance company state one month (SPEC 6.1 step 5). All randomness comes from the seeded RNG."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Mapping

from sim.engine.rng import RNG
from sim.engine.state import CompanyState, Incident, Project

BASE_MORALE = 64.0
BASE_SENTIMENT = 18.0

_ACCEPTABLE_USE = re.compile(r"acceptable use|unapproved (?:ai )?tools?|approved (?:ai )?tools?", re.IGNORECASE)


@dataclass(frozen=True)
class EngineEvent:
    type: str
    severity: str | None
    payload: Mapping[str, Any]


@dataclass(frozen=True)
class MonthResult:
    state: CompanyState
    events: tuple[EngineEvent, ...] = ()
    status_changes: tuple[tuple[str, str, str], ...] = field(default=())   # (use_case_id, from, to)


def policy_signals(policy_text: str) -> dict[str, bool]:
    return {"acceptable_use_control": bool(_ACCEPTABLE_USE.search(policy_text))}


def _allocate_capacity(projects: list[Project], capacity: float) -> dict[str, float]:
    """Split capacity evenly across building projects, redistributing what small projects do not need."""
    remaining = {p.use_case_id: max(0.0, p.plan.actual_person_weeks - p.person_weeks_done) for p in projects}
    allocation = {pid: 0.0 for pid in remaining}
    pool = capacity
    while pool > 1e-9:
        open_ids = [pid for pid in remaining if remaining[pid] - allocation[pid] > 1e-9]
        if not open_ids:
            break
        share = pool / len(open_ids)
        pool = 0.0
        for pid in open_ids:
            give = min(share, remaining[pid] - allocation[pid])
            allocation[pid] += give
            pool += share - give
    return allocation


def _build_step(state: CompanyState, month: str) -> tuple[CompanyState, list[EngineEvent], list[tuple[str, str, str]]]:
    building = sorted((p for p in state.projects if p.status == "building"), key=lambda p: p.approved_month)
    allocation = _allocate_capacity(building, state.technology.engineering_capacity_person_weeks_per_month)
    events, changes = [], []
    new_state = state
    for project in building:
        work = allocation[project.use_case_id]
        done = project.person_weeks_done + work
        cost = project.plan.one_time_cost_usd * work / project.plan.actual_person_weeks
        goes_live = done >= project.plan.actual_person_weeks - 1e-6
        updated = project.model_copy(update={
            "person_weeks_done": min(done, project.plan.actual_person_weeks),
            "build_months": project.build_months + 1,
            "one_time_cost_spent": project.one_time_cost_spent + cost,
            "cost_last_month": cost,
            "revenue_last_month": 0.0,
            "status": "live" if goes_live else "building",
            "live_month": month if goes_live else None,
        })
        new_state = new_state.with_project(updated)
        if goes_live:
            changes.append((project.use_case_id, "building", "live"))
            events.append(EngineEvent("go_live", None, {"use_case_id": project.use_case_id, "title": project.title}))
    used = sum(allocation.values())
    new_state = new_state.model_copy(update={
        "technology": new_state.technology.model_copy(update={"capacity_used_last_month": used})
    })
    return new_state, events, changes


def _operate_step(state: CompanyState, month: str, params: Mapping[str, Any]) -> CompanyState:
    new_state = state
    for project in state.projects:
        if project.status == "live" and project.live_month != month:
            live_months = project.live_months + 1
            adoption = project.plan.adoption_peak * min(1.0, live_months / max(project.plan.months_to_peak, 1.0))
            new_state = new_state.with_project(project.model_copy(update={
                "live_months": live_months,
                "revenue_last_month": project.plan.revenue_per_month_full_usd * adoption,
                "cost_last_month": project.plan.run_cost_per_month_usd,
            }))
        elif project.status == "paused":
            new_state = new_state.with_project(project.model_copy(update={
                "revenue_last_month": 0.0,
                "cost_last_month": project.plan.run_cost_per_month_usd * params["paused_run_cost_share"],
            }))
        elif project.status == "retired":
            new_state = new_state.with_project(project.model_copy(update={"revenue_last_month": 0.0,
                                                                           "cost_last_month": 0.0}))
    return new_state


def _incident_kind(project: Project) -> str:
    if project.credit_decision:
        return "fair_lending_issue"
    if project.customer_facing:
        return "customer_facing_error"
    if project.staff_genai_tool:
        return "data_handling_error"
    return "model_error"


def _incident_step(state: CompanyState, month: str, rng: RNG, params: Mapping[str, Any]) -> tuple[CompanyState, list[EngineEvent]]:
    events: list[EngineEvent] = []
    risk = state.risk
    sentiment, morale = state.public_sentiment, state.people.morale_index
    fair_lending = risk.fair_lending_exposure_score
    complaint_excess = risk.complaint_excess
    incidents = list(risk.incidents)
    for project in sorted(state.projects, key=lambda p: p.use_case_id):
        if project.status != "live":
            continue
        hit = rng.draw("incident", "bernoulli", {"p": project.plan.incident_prob_per_month},
                       sim_month=month, key=(project.use_case_id,))
        if not hit:
            continue
        mix = project.plan.severity_mix
        levels = ["low", "medium", "high"]
        severity = levels[int(rng.draw("incident_severity", "choice", {"weights": [mix[l] for l in levels]},
                                       sim_month=month, key=(project.use_case_id,)))]
        effect = params["incident_effects"][severity]
        complaint_excess += effect["complaint_rate_per_10k"]
        sentiment += effect["public_sentiment"]
        morale += effect["morale_index"]
        if project.credit_decision:
            fair_lending += effect["fair_lending_exposure"]
        incident = Incident(incident_id=f"{project.use_case_id}/incident/{month}", use_case_id=project.use_case_id,
                            sim_month=month, severity=severity, kind=_incident_kind(project))
        incidents.append(incident)
        events.append(EngineEvent("model_error", severity, {
            "incident_id": incident.incident_id, "use_case_id": project.use_case_id,
            "title": project.title, "kind": incident.kind,
        }))
    new_risk = risk.model_copy(update={
        "incidents": tuple(incidents),
        "complaint_excess": complaint_excess,
        "fair_lending_exposure_score": fair_lending,
    })
    return state.model_copy(update={
        "risk": new_risk,
        "public_sentiment": sentiment,
        "people": state.people.model_copy(update={"morale_index": morale}),
    }), events


def _drift_step(state: CompanyState, month: str, rng: RNG, params: Mapping[str, Any], signals: Mapping[str, bool]) -> CompanyState:
    risk = state.risk
    live = [p for p in state.projects if p.status == "live"]
    go_live_now = [p for p in live if p.live_month == month]
    structural_complaints = sum(
        p.plan.complaint_rate_change_per_10k * min(1.0, p.live_months / max(p.plan.months_to_peak, 1.0))
        for p in live if p.customer_facing
    )
    excess = risk.complaint_excess * (1 - params["complaint_decay_per_month"])
    fl_base = 22.0
    fair_lending = fl_base + (risk.fair_lending_exposure_score - fl_base) * (1 - params["fair_lending_decay_per_month"])
    fair_lending += sum(p.plan.fair_lending_exposure_change for p in go_live_now if p.credit_decision)

    shadow = params["shadow_ai"]
    drift = shadow["base_drift"]
    if any(p.staff_genai_tool for p in live):
        drift += shadow["approved_internal_tool_effect"]
    if signals.get("acceptable_use_control"):
        drift += shadow["acceptable_use_control_effect"]
    drift += rng.draw("shadow_ai_noise", "normal", {"mean": 0.0, "sd": shadow["noise_sd"]}, sim_month=month)
    shadow_rate = min(0.9, max(0.01, state.people.shadow_ai_usage_rate + drift))

    morale = state.people.morale_index
    morale += (BASE_MORALE - morale) * 0.1 + (0.3 if any(p.staff_genai_tool for p in live) else 0.0)
    sentiment = state.public_sentiment + (BASE_SENTIMENT - state.public_sentiment) * 0.05

    return state.model_copy(update={
        "risk": risk.model_copy(update={
            "complaint_excess": excess,
            "customer_complaint_rate": max(0.0, risk.customer_complaint_rate_baseline + excess + structural_complaints),
            "fair_lending_exposure_score": min(100.0, max(0.0, fair_lending)),
        }),
        "people": state.people.model_copy(update={"shadow_ai_usage_rate": shadow_rate,
                                                  "morale_index": min(100.0, max(0.0, morale))}),
        "public_sentiment": min(100.0, max(-100.0, sentiment)),
    })


def _financial_step(state: CompanyState) -> tuple[CompanyState, list[EngineEvent]]:
    fin = state.financials
    revenue = sum(p.revenue_last_month for p in state.projects)
    spend = sum(p.cost_last_month for p in state.projects)
    remaining = fin.ai_budget_remaining - spend
    events = []
    if fin.ai_budget_remaining >= 0 > remaining:
        events.append(EngineEvent("budget_overrun", "medium", {"overrun_usd": round(-remaining, 2)}))
    return state.model_copy(update={"financials": fin.model_copy(update={
        "ai_revenue_monthly": revenue,
        "ai_revenue_to_date": fin.ai_revenue_to_date + revenue,
        "ai_spend_monthly": spend,
        "ai_spend_to_date": fin.ai_spend_to_date + spend,
        "ai_budget_remaining": remaining,
        "revenue_monthly": fin.revenue_monthly_base + revenue,
    })}), events


def advance_month(state: CompanyState, month: str, rng: RNG, params: Mapping[str, Any],
                  signals: Mapping[str, bool]) -> MonthResult:
    current = state.model_copy(update={"sim_month": month})
    current, build_events, changes = _build_step(current, month)
    current = _operate_step(current, month, params)
    current, incident_events = _incident_step(current, month, rng, params)
    current = _drift_step(current, month, rng, params, signals)
    current, money_events = _financial_step(current)
    return MonthResult(current, tuple(build_events + incident_events + money_events), tuple(changes))


def apply_world_incidents(state: CompanyState, incidents: tuple[tuple[str, str, str | None], ...], month: str,
                          params: Mapping[str, Any]) -> CompanyState:
    """Incidents that come from the event injector (event_id, severity, use_case_id), e.g. data leaks."""
    if not incidents:
        return state
    risk = state.risk
    excess, sentiment, morale = risk.complaint_excess, state.public_sentiment, state.people.morale_index
    records = list(risk.incidents)
    for event_id, severity, use_case_id in incidents:
        effect = params["incident_effects"][severity]
        excess += effect["complaint_rate_per_10k"]
        sentiment += effect["public_sentiment"]
        morale += effect["morale_index"]
        records.append(Incident(incident_id=event_id, use_case_id=use_case_id, sim_month=month, severity=severity,
                                kind="data_exposure"))
    return state.model_copy(update={
        "risk": risk.model_copy(update={"incidents": tuple(records), "complaint_excess": excess}),
        "public_sentiment": sentiment,
        "people": state.people.model_copy(update={"morale_index": morale}),
    })
