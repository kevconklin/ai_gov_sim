"""Simulated outcome metrics: exact within the simulated world, and dependent on config/engine_params.yaml."""

from __future__ import annotations

from govern.calendar import month_index
from sim.context import RunContext
from sim.engine.resolve import load_state


def compute(ctx: RunContext, month: str) -> list:
    state = load_state(ctx, month)
    if state is None:
        return []
    fin, risk = state.financials, state.risk
    rows = [
        ("ai_revenue_monthly", "", fin.ai_revenue_monthly),
        ("ai_spend_monthly", "", fin.ai_spend_monthly),
        ("ai_spend_cumulative", "", fin.ai_spend_to_date),
        ("ai_budget_remaining", "", fin.ai_budget_remaining),
        ("roi_cumulative", "", (fin.ai_revenue_to_date - fin.ai_spend_to_date) / fin.ai_spend_to_date if fin.ai_spend_to_date else None),
        ("complaint_rate", "", risk.customer_complaint_rate),
        ("shadow_ai_rate", "", state.people.shadow_ai_usage_rate),
        ("fair_lending_exposure", "", risk.fair_lending_exposure_score),
        ("public_sentiment", "", state.public_sentiment),
        ("morale_index", "", state.people.morale_index),
    ]
    finished = [p for p in state.projects if p.status in ("live", "paused", "retired") and p.live_month]
    rows.append(("effort_overrun_pct", "", 100 * sum(p.plan.actual_person_weeks / p.plan.estimated_person_weeks - 1 for p in finished)
                 / len(finished) if finished else None))
    incidents = state.incidents_in(month)
    for severity in ("low", "medium", "high"):
        rows.append(("incidents", severity, sum(i.severity == severity for i in incidents)))

    db, run_id = ctx.db, ctx.run_id
    issued = db.fetch_all("SELECT severity FROM findings WHERE run_id = ? AND sim_month = ?", (run_id, month))
    for severity in ("observation", "mra", "mria", "enforcement_referral"):
        rows.append(("findings", severity, sum(f["severity"] == severity for f in issued)))
    rows.append(("findings_open", "", db.fetch_one("SELECT COUNT(*) AS n FROM findings WHERE run_id = ? AND status = 'open'",
                                                  (run_id,))["n"]))
    first_mra = db.fetch_one("SELECT MIN(sim_month) AS m FROM findings WHERE run_id = ? AND severity IN ('mra', 'mria', "
                             "'enforcement_referral') AND sim_month <= ?", (run_id, month))["m"]
    if first_mra:
        rows.append(("first_mra_month_index", "", month_index(ctx.run["start_month"], first_mra)))
    enforcement = db.fetch_one("SELECT 1 FROM findings WHERE run_id = ? AND severity = 'enforcement_referral' AND sim_month <= ?",
                               (run_id, month))
    rows.append(("enforcement_flag", "", 1 if enforcement else 0))
    return rows
