"""Decisions and portfolio metrics."""

from __future__ import annotations

import statistics

from govern.calendar import months_between
from sim.context import RunContext


def compute(ctx: RunContext, month: str) -> list:
    db, run_id = ctx.db, ctx.run_id
    rows = []
    proposals = db.fetch_one("SELECT COUNT(*) AS n FROM use_cases WHERE run_id = ? AND proposed_month = ?", (run_id, month))["n"]
    rows.append(("proposals_submitted", "", proposals))
    edits = db.fetch_one("SELECT COUNT(*) AS n FROM policy_edits WHERE run_id = ? AND sim_month = ?", (run_id, month))["n"]
    rows.append(("policy_edits_proposed", "", edits))

    decided = db.fetch_all("SELECT * FROM decisions WHERE run_id = ? AND sim_month = ?", (run_id, month))
    use_case_decisions = [d for d in decided if d["kind"] == "use_case"]
    rows.append(("approval_rate", "", sum(d["outcome"] == "approved" for d in use_case_decisions) / len(use_case_decisions)
                 if use_case_decisions else None))
    all_uc = db.fetch_all("SELECT outcome FROM decisions WHERE run_id = ? AND kind = 'use_case' AND sim_month <= ?", (run_id, month))
    rows.append(("approval_rate_cumulative", "", sum(d["outcome"] == "approved" for d in all_uc) / len(all_uc) if all_uc else None))
    # Proposals are decided at the meeting where they are submitted, so decision lag is measured in meetings (0 days).
    lags = [0.0 for _ in use_case_decisions]
    rows.append(("time_to_decision_days", "", statistics.median(lags) if lags else None))

    went_live = db.fetch_all("SELECT decided_month, live_month FROM use_cases WHERE run_id = ? AND live_month = ?", (run_id, month))
    lags = [months_between(r["decided_month"], r["live_month"]) for r in went_live if r["decided_month"]]
    rows.append(("time_to_production_months", "", statistics.median(lags) if lags else None))

    live = db.fetch_all("SELECT risk_tier FROM use_cases WHERE run_id = ? AND status = 'live'", (run_id,))
    for tier in ("low", "medium", "high"):
        rows.append(("use_cases_live", tier, sum(r["risk_tier"] == tier for r in live)))
    rows.append(("use_cases_live", "total", len(live)))
    rows.append(("high_risk_share", "", sum(r["risk_tier"] == "high" for r in live) / len(live) if live else None))

    rows.append(("unanimity_rate", "", sum(min(d["yes_votes"], d["no_votes"]) == 0 for d in decided) / len(decided)
                 if decided else None))
    votes = db.fetch_all("SELECT a.seat, v.vote, d.outcome FROM votes v JOIN decisions d ON d.meeting_id = v.meeting_id "
                         "AND d.item_id = v.item_id JOIN agents a ON a.agent_id = v.agent_id "
                         "WHERE v.run_id = ? AND d.sim_month = ? AND v.vote != 'abstain'", (run_id, month))
    for seat in ctx.world.seats:
        cast = [v for v in votes if v["seat"] == seat]
        against = sum((v["vote"] == "yes") != (v["outcome"] == "approved") for v in cast)
        rows.append(("dissent_by_seat", seat, against / len(cast) if cast else None))

    reversals = db.fetch_one("SELECT COUNT(*) AS n FROM use_case_history WHERE run_id = ? AND sim_month = ? "
                             "AND source = 'committee' AND to_status IN ('paused', 'retired')", (run_id, month))["n"]
    rows.append(("reversal_count", "", reversals))
    return rows
