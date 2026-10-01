"""Regulator (SPEC 6.3): full-scope exams every 12 months, targeted reviews on triggers, findings, escalation."""

from __future__ import annotations

import json
import logging
from typing import Any, Sequence

from govern import ids, prompts
from govern.agents.structured import StructuredOutputError, extract, forced, tool
from govern.calendar import add_months, day_in_month, long_date, meeting_date, month_index, months_between
from govern.context import display_id
from sim.context import RunContext
from sim.engine.state import CompanyState
from sim.events import WorldEvent, deliver_inbox
from sim.realism import find_leaks

log = logging.getLogger(__name__)

SEVERITIES = ["observation", "mra", "mria", "enforcement_referral"]
SEVERITY_LABELS = {"observation": "Observation", "mra": "Matter Requiring Attention",
                   "mria": "Matter Requiring Immediate Attention", "enforcement_referral": "Referral for enforcement review"}

EXAM_TOOL = tool("issue_exam_results", "Record the examination results.", {
    "summary": {"type": "string", "description": "Two to four paragraphs for the letter to the bank."},
    "findings": {"type": "array", "items": {"type": "object", "properties": {
        "severity": {"type": "string", "enum": SEVERITIES},
        "topic": {"type": "string", "description": "short label, e.g. model validation, fair lending, vendor oversight"},
        "description": {"type": "string"},
        "required_action": {"type": "string"},
        "due_in_months": {"type": "integer", "minimum": 1, "maximum": 12}},
        "required": ["severity", "topic", "description", "required_action", "due_in_months"]}},
    "closed_finding_ids": {"type": "array", "items": {"type": "string"}},
    "escalated_finding_ids": {"type": "array", "items": {"type": "string"}},
})


def exam_due(ctx: RunContext, month: str, state: CompanyState, world_events: Sequence[WorldEvent]) -> tuple[str, str] | None:
    """Return (kind, trigger reason) if an exam happens this month."""
    every = int(ctx.world.events["scheduled"]["full_scope_exam"]["every_months"])
    if month_index(ctx.run["start_month"], month) % every == 0:
        return "full_scope", "annual full-scope examination"
    triggers = ctx.world.events["targeted_review_triggers"]
    last = ctx.db.fetch_one("SELECT MAX(sim_month) AS m FROM exams WHERE run_id = ?", (ctx.run_id,))["m"]
    if last and months_between(last, month) < int(triggers["cooldown_months"]):
        return None
    prev = add_months(month, -1)
    risk = state.risk
    if triggers.get("high_severity_incident") and (
            any(i.severity == "high" for i in state.incidents_in(prev))
            or ctx.db.fetch_one("SELECT 1 FROM events WHERE run_id = ? AND sim_month = ? AND severity = 'high' "
                                "AND type IN ('data_leak', 'model_error')", (ctx.run_id, prev))):
        return "targeted", "high-severity incident"
    if risk.customer_complaint_rate >= triggers["complaint_rate_multiple_of_baseline"] * risk.customer_complaint_rate_baseline:
        return "targeted", "customer complaint increase"
    if risk.fair_lending_exposure_score > triggers["fair_lending_exposure_above"]:
        return "targeted", "fair lending risk indicators"
    return None


def _evidence(ctx: RunContext, month: str, state: CompanyState) -> str:
    db, run_id = ctx.db, ctx.run_id
    inventory = [{"id": display_id(r["use_case_id"]), "title": r["title"], "status": r["status"], "risk_tier": r["risk_tier"],
                  "description": r["description"], **json.loads(r["details"])}
                 for r in db.fetch_all("SELECT * FROM use_cases WHERE run_id = ? AND status NOT IN ('proposed', 'rejected')", (run_id,))]
    findings = [{"finding_id": display_id(r["finding_id"]), "issued": r["sim_month"], "severity": r["severity"], "topic": r["topic"],
                 "description": r["description"], "required_action": r["required_action"], "due": r["due_month"]}
                for r in db.fetch_all("SELECT * FROM findings WHERE run_id = ? AND status = 'open'", (run_id,))]
    minutes = db.fetch_all("SELECT minutes_text FROM meetings WHERE run_id = ? AND minutes_text IS NOT NULL "
                           "ORDER BY sim_month DESC LIMIT 3", (run_id,))
    incidents = [i.model_dump() for i in state.risk.incidents if months_between(i.sim_month, month) <= 12]
    leaks = [dict(r) for r in db.fetch_all("SELECT sim_month, type, severity FROM events WHERE run_id = ? "
                                           "AND type IN ('data_leak', 'complaint_wave', 'shadow_ai_discovery')", (run_id,))]
    return "\n\n".join([
        f"Examination date: {long_date(day_in_month(month, 3))}",
        f"AI policy (current):\n{ctx.policy_repo.read()}",
        f"AI inventory:\n{json.dumps(inventory, indent=2)}",
        f"AI-related incidents, last 12 months:\n{json.dumps(incidents, indent=2)}",
        f"Other risk events:\n{json.dumps(leaks, indent=2)}",
        f"Customer complaint rate: {state.risk.customer_complaint_rate:.1f} per 10,000 customers "
        f"(baseline {state.risk.customer_complaint_rate_baseline:.1f})",
        f"Fair lending risk indicator (0-100): {state.risk.fair_lending_exposure_score:.0f}",
        f"Estimated share of staff using unapproved AI tools: {state.people.shadow_ai_usage_rate:.0%}",
        f"Open prior findings:\n{json.dumps(findings, indent=2) if findings else 'None'}",
        "Recent committee minutes:\n" + ("\n\n".join(m["minutes_text"] for m in minutes) or "None"),
    ])


def _escalate(severity: str) -> str:
    return SEVERITIES[min(len(SEVERITIES) - 1, SEVERITIES.index(severity) + 1)]


def conduct_exam(ctx: RunContext, month: str, state: CompanyState, kind: str, reason: str) -> str:
    regulators = ctx.world.universe.get("regulators", {})
    examiner = regulators.get("examiner_in_charge", {"name": "Examiner-in-Charge", "title": "Federal Reserve"})
    request = forced(dict(
        role="estimator", purpose=f"regulator_exam_{kind}", run_id=ctx.run_id, sim_month=month,
        max_tokens=int(ctx.budget("max_tokens", "exam")),
        system_fixed=(prompts.render("world/examiner.md", examiner_name=examiner["name"], examiner_title=examiner["title"],
                                     kind=kind.replace("_", "-") + " examination" if kind == "full_scope" else "targeted review",
                                     bank_name=ctx.bank.name, rulebook=ctx.world.rulebook),),
        messages=({"role": "user", "content": f"Reason for review: {reason}\n\n{_evidence(ctx, month, state)}"},),
    ), EXAM_TOOL)
    exam_id = ids.scoped(ctx.run_id, "exam", month)
    try:
        result = extract(ctx.llm.wait_for_batch(ctx.llm.submit_batch({"exam": request}, run_id=ctx.run_id))["exam"],
                         EXAM_TOOL["name"])
    except StructuredOutputError as error:
        log.error("exam output unusable for %s: %s", ctx.run_id, error)
        result = {"summary": "The review is complete. Written findings will follow under separate cover.", "findings": [],
                  "closed_finding_ids": [], "escalated_finding_ids": []}
    if find_leaks(json.dumps(result)):
        log.warning("exam output for %s contained leak terms; using neutral wording", ctx.run_id)
        result = {"summary": "The review is complete. Findings are listed below.",
                  "findings": [{**f, "description": f"Weaknesses identified in {f.get('topic', 'AI risk management')}.",
                                "required_action": f"Remediate weaknesses in {f.get('topic', 'AI risk management')}."}
                               for f in result.get("findings", [])],
                  "closed_finding_ids": result.get("closed_finding_ids", []),
                  "escalated_finding_ids": result.get("escalated_finding_ids", [])}
    open_rows = {display_id(r["finding_id"]): r for r in ctx.db.fetch_all(
        "SELECT * FROM findings WHERE run_id = ? AND status = 'open'", (ctx.run_id,))}
    closed = {str(f).upper() for f in result.get("closed_finding_ids", [])}
    escalated = {str(f).upper() for f in result.get("escalated_finding_ids", [])}
    new_findings: list[dict[str, Any]] = []
    for fid, row in open_rows.items():
        if fid in closed:
            ctx.db.update("findings", {"status": "closed", "closed_month": month}, where={"finding_id": row["finding_id"]})
        elif fid in escalated or (row["due_month"] and row["due_month"] < month):
            ctx.db.update("findings", {"status": "escalated", "closed_month": month}, where={"finding_id": row["finding_id"]})
            new_findings.append({"severity": _escalate(row["severity"]), "topic": row["topic"],
                                 "description": f"Repeat finding: remediation of {fid} was not completed by {row['due_month']}. {row['description']}",
                                 "required_action": row["required_action"], "due_in_months": 3})
    new_findings.extend(result.get("findings", []))
    ctx.db.insert("exams", {"exam_id": exam_id, "run_id": ctx.run_id, "bank_id": ctx.run["bank_id"], "sim_month": month,
                            "kind": kind, "trigger_reason": reason, "letter_text": "", "result": result})
    lines = []
    for n, f in enumerate(new_findings, start=1):
        if f.get("severity") not in SEVERITIES:
            continue
        finding_id = ids.scoped(ctx.run_id, "finding", f"F-{month}-{n:02d}")
        ctx.db.insert("findings", {"finding_id": finding_id, "run_id": ctx.run_id, "bank_id": ctx.run["bank_id"],
                                   "exam_id": exam_id, "sim_month": month, "severity": f["severity"], "topic": f["topic"],
                                   "description": f["description"], "required_action": f.get("required_action"),
                                   "due_month": add_months(month, int(f.get("due_in_months") or 3)), "status": "open"})
        lines.append(f"{display_id(finding_id)} {SEVERITY_LABELS[f['severity']]}: {f['topic']}\n{f['description']}\n"
                     f"Required action: {f.get('required_action')} Due: {add_months(month, int(f.get('due_in_months') or 3))}.")
    sent = day_in_month(month, min(8, meeting_date(month).day - 1))
    letter = prompts.render("committee/exam_letter.md", regulator=regulators.get("federal_reserve_bank", "Federal Reserve"),
                            date=long_date(sent), bank_name=ctx.bank.name,
                            kind_title="Full-scope examination" if kind == "full_scope" else "Targeted review",
                            summary=result.get("summary", ""), findings="\n\n".join(lines) or "No findings.",
                            examiner_name=examiner["name"], examiner_title=examiner["title"])
    ctx.db.update("exams", {"letter_text": letter}, where={"exam_id": exam_id})
    deliver_inbox(ctx, month=month, sent=sent, sender_name=examiner["name"], sender_title=examiner["title"],
                  subject=f"{'Examination' if kind == 'full_scope' else 'Targeted review'} results", body=letter)
    ctx.db.insert("events", {"event_id": ids.unique(ctx.run_id, "event"), "run_id": ctx.run_id, "bank_id": ctx.run["bank_id"],
                             "sim_month": month, "type": "exam", "severity": None, "source": "regulator",
                             "payload": {"exam_id": exam_id, "kind": kind, "findings": len(lines)}})
    return exam_id
