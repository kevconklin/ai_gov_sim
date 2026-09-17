"""Engine step of the monthly cycle (SPEC 5 step 8): turn formal decisions into state changes and a report."""

from __future__ import annotations

import json
import re
from typing import Mapping, Sequence

from sim import ids
from sim.calendar import add_months
from sim.context import RunContext, display_id
from sim.decisions import Decision, set_use_case_status
from sim.engine.advance import advance_month, apply_world_incidents, policy_signals
from sim.engine.pipeline import blend, classify, estimate_many, sample_plan
from sim.engine.report import build_report
from sim.engine.state import CompanyState, Project

_KEY = re.compile(r"[^A-Za-z0-9_-]")


def load_state(ctx: RunContext, month: str) -> CompanyState | None:
    row = ctx.db.fetch_one("SELECT company_state FROM sim_months WHERE run_id = ? AND sim_month = ?", (ctx.run_id, month))
    return CompanyState.model_validate_json(row["company_state"]) if row else None


def _plan_approved(ctx: RunContext, state: CompanyState, decisions: Sequence[Decision], month: str) -> CompanyState:
    approved = [d for d in decisions if d.item.kind == "use_case" and d.tally.approved]
    if not approved:
        return state
    policy_text = ctx.policy_repo.read()
    tokens = ctx.budget("max_tokens")
    prepared = {}
    for d in approved:
        use_case = ctx.db.fetch_one("SELECT * FROM use_cases WHERE use_case_id = ?", (d.item.ref_id,))
        classification = classify(ctx.llm, run_id=ctx.run_id, month=month, use_case=use_case, policy_text=policy_text,
                                  max_tokens=int(tokens["classifier"]))
        prepared[_KEY.sub("_", d.item.item_id)] = (d, use_case, classification)
    estimates = estimate_many(ctx.llm, run_id=ctx.run_id, month=month, max_tokens=int(tokens["estimator"]),
                              items={k: (uc, cl) for k, (_, uc, cl) in prepared.items()})
    params = ctx.world.engine_params
    for key, (d, use_case, classification) in prepared.items():
        priors, blended = blend(classification, estimates[key], params)
        plan = sample_plan(ctx.rng, month=month, decision_id=d.decision_id, classification=classification,
                           priors=priors, blended=blended, params=params)
        ctx.db.insert("engine_decisions", {
            "decision_id": d.decision_id, "run_id": ctx.run_id, "use_case_id": use_case["use_case_id"], "sim_month": month,
            "classification": classification, "estimates": estimates[key], "priors": priors, "blended": blended,
            "plan": plan.model_dump(),
        })
        ctx.db.update("use_cases", {"risk_tier": classification["risk_tier"]}, where={"use_case_id": use_case["use_case_id"]})
        set_use_case_status(ctx, use_case["use_case_id"], month, "building", source="engine", decision_id=d.decision_id)
        state = state.with_project(Project(
            use_case_id=use_case["use_case_id"], title=use_case["title"], status="building",
            customer_facing=bool(classification.get("customer_facing")),
            credit_decision=bool(classification.get("credit_decision")),
            staff_genai_tool=bool(classification.get("staff_genai_tool")), plan=plan, approved_month=month,
        ))
    return state


def _apply_status_changes(ctx: RunContext, state: CompanyState, decisions: Sequence[Decision]) -> CompanyState:
    for d in decisions:
        if d.item.kind != "status_change" or not d.tally.approved:
            continue
        change = ctx.db.fetch_one("SELECT use_case_id FROM status_changes WHERE change_id = ?", (d.item.ref_id,))
        project = state.project(change["use_case_id"])
        row = ctx.db.fetch_one("SELECT status FROM use_cases WHERE use_case_id = ?", (change["use_case_id"],))
        if project is not None and row["status"] in ("building", "live", "paused", "retired"):
            state = state.with_project(project.model_copy(update={"status": row["status"]}))
    return state


def run_engine_month(ctx: RunContext, decisions: Sequence[Decision], *, month: str, prior: CompanyState,
                     world_incidents: tuple[tuple[str, str, str | None], ...] = ()) -> CompanyState:
    state = _plan_approved(ctx, prior, decisions, month)
    state = _apply_status_changes(ctx, state, decisions)
    state = apply_world_incidents(state, world_incidents, month, ctx.world.engine_params)
    result = advance_month(state, month, ctx.rng, ctx.world.engine_params, policy_signals(ctx.policy_repo.read()))
    for use_case_id, _, new_status in result.status_changes:
        set_use_case_status(ctx, use_case_id, month, new_status, source="engine")
    for event in result.events:
        ctx.db.insert("events", {"event_id": ids.unique(ctx.run_id, "event"), "run_id": ctx.run_id,
                                 "bank_id": ctx.run["bank_id"], "sim_month": month, "type": event.type,
                                 "severity": event.severity, "source": "engine", "payload": dict(event.payload)})
    return result.state


def write_report(ctx: RunContext, *, month: str, new_state: CompanyState) -> None:
    """Report delivered in the next month's packet."""
    history = {m: s for m in (add_months(month, -2), add_months(month, -1)) if (s := load_state(ctx, m))}
    history[month] = new_state
    report = build_report(history, report_month=add_months(month, 1), rng=ctx.rng,
                          params=ctx.world.engine_params, bank_name=ctx.bank.name)
    reported = json.loads(json.dumps(report.reported))
    for row in reported["use_cases"]:
        row["display_id"] = display_id(row["use_case_id"])
    ctx.db.upsert("outcome_reports", {"run_id": ctx.run_id, "bank_id": ctx.run["bank_id"],
                                      "sim_month": add_months(month, 1), "report_text": report.text,
                                      "reported": reported}, key=("run_id", "sim_month"))
