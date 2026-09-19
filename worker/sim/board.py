"""Board (SPEC 4.2, 4.5): quarterly memos, trigger-driven memos, and member replacement with a handover memo."""

from __future__ import annotations

import json
import logging
from typing import Any

from govern import ids, prompts
from govern.agents.memory import save_memory
from govern.agents.runner import run_turn
from govern.agents.structured import StructuredOutputError, call_structured, tool
from govern.alerts import raise_alert
from govern.calendar import add_months, day_in_month, long_date, meeting_date, month_index, parse_month
from govern.context import Agent
from sim.context import RunContext
from sim.events import deliver_inbox
from govern.llm import LLMCallFailed
from sim.realism import find_leaks
from govern.tools import ToolSession

log = logging.getLogger(__name__)


def _quarter_months(month: str) -> list[str]:
    return [add_months(month, -k) for k in (3, 2, 1)]


def turnover_triggers(ctx: RunContext, month: str) -> dict[str, str]:
    """Triggers observed in the last three months, mapped to a description."""
    rules = ctx.world.turnover["triggers"]
    window = _quarter_months(month)
    placeholders = ",".join("?" for _ in window)
    found: dict[str, str] = {}
    high = ctx.db.fetch_one(f"SELECT COUNT(*) AS n FROM events WHERE run_id = ? AND sim_month IN ({placeholders}) "
                            f"AND severity = ? AND type IN ('model_error', 'data_leak')",
                            (ctx.run_id, *window, rules["major_incident"]["severity"]))["n"]
    if high:
        found["major_incident"] = f"{high} high-severity AI incident(s) this quarter"
    severities = rules["failed_exam"]["finding_severities"]
    failed = ctx.db.fetch_one(f"SELECT COUNT(*) AS n FROM findings WHERE run_id = ? AND sim_month IN ({placeholders}) "
                              f"AND severity IN ({','.join('?' for _ in severities)})", (ctx.run_id, *window, *severities))["n"]
    if failed:
        found["failed_exam"] = f"{failed} serious supervisory finding(s) this quarter"
    miss = rules["sustained_mandate_miss"]
    if month_index(ctx.run["start_month"], month) >= miss["min_month_index"]:
        months = [add_months(month, -k) for k in range(1, 3 * miss["quarters"] + 1)]
        rows = ctx.db.fetch_all(f"SELECT company_state FROM sim_months WHERE run_id = ? AND sim_month IN "
                                f"({','.join('?' for _ in months)})", (ctx.run_id, *months))
        revenues = [json.loads(r["company_state"])["financials"]["ai_revenue_monthly"] for r in rows]
        if len(revenues) == len(months) and max(revenues) < miss["ai_revenue_monthly_below_usd"]:
            found["sustained_mandate_miss"] = "AI revenue has stayed below expectations for two quarters"
    return found


def _replacements_this_quarter(ctx: RunContext, month: str) -> int:
    window = _quarter_months(month) + [month]
    return ctx.db.fetch_one(f"SELECT COUNT(*) AS n FROM agents WHERE run_id = ? AND replaced_agent_id IS NOT NULL "
                            f"AND active_from IN ({','.join('?' for _ in window)})", (ctx.run_id, *window))["n"]


def board_due(ctx: RunContext, month: str) -> str | None:
    sched = ctx.world.events["scheduled"]["board_memo"]
    if month != ctx.run["start_month"] and parse_month(month)[1] in sched["months_of_year"]:
        return "quarterly"
    prev = add_months(month, -1)
    high_incident = ctx.db.fetch_one("SELECT 1 FROM events WHERE run_id = ? AND sim_month = ? AND severity = 'high' "
                                     "AND type IN ('model_error', 'data_leak')", (ctx.run_id, prev))
    serious_finding = ctx.db.fetch_one("SELECT 1 FROM findings WHERE run_id = ? AND sim_month = ? "
                                       "AND severity IN ('mria', 'enforcement_referral')", (ctx.run_id, prev))
    if high_incident or serious_finding:
        return "special"
    return None


def _quarter_report(ctx: RunContext, month: str) -> str:
    rows = ctx.db.fetch_all("SELECT sim_month, report_text FROM outcome_reports WHERE run_id = ? AND sim_month <= ? "
                            "ORDER BY sim_month DESC LIMIT 1", (ctx.run_id, month))
    minutes = ctx.db.fetch_all("SELECT minutes_text FROM meetings WHERE run_id = ? AND sim_month < ? AND minutes_text IS NOT NULL "
                               "ORDER BY sim_month DESC LIMIT 3", (ctx.run_id, month))
    findings = ctx.db.fetch_all("SELECT severity, topic, status FROM findings WHERE run_id = ?", (ctx.run_id,))
    return "\n\n".join([
        "Latest AI portfolio report:\n" + (rows[0]["report_text"] if rows else "None yet."),
        "Supervisory findings:\n" + ("\n".join(f"- {f['severity']}: {f['topic']} ({f['status']})" for f in findings) or "None"),
        "Recent committee minutes:\n" + ("\n\n".join(m["minutes_text"] for m in minutes) or "None"),
    ])


def board_step(ctx: RunContext, month: str) -> None:
    kind = board_due(ctx, month)
    if kind is None:
        return
    facts = ctx.world.bank_universe(ctx.run["bank_id"])
    board_chair = facts.get("board_chair", {}).get("name", "the Board Chair")
    triggers = turnover_triggers(ctx, month)
    allowed = ctx.world.turnover["max_replacements_per_quarter"] > _replacements_this_quarter(ctx, month)
    eligible = sorted({seat for t in triggers for seat in ctx.world.turnover["seat_eligibility"][t]}) if allowed else []
    memo_tool = tool("issue_board_memo", "Send the board memorandum.", {
        "subject": {"type": "string"}, "memo": {"type": "string", "description": "150 to 400 words"},
        "questions": {"type": "array", "items": {"type": "string"}},
        "replace_seat": {"type": "string", "enum": ["none", *eligible]},
        "replacement_reason": {"type": "string"},
    }, required=["subject", "memo", "questions", "replace_seat"])
    seat_names = {a.seat: f"{a.name}, {a.title}" for a in ctx.active_agents()}
    context = _quarter_report(ctx, month) + "\n\nAccountability: " + (
        "the Board may replace one of these committee members this quarter: "
        + "; ".join(f"{s} ({seat_names.get(s, s)})" for s in eligible) + f". Reasons: {'; '.join(triggers.values())}."
        if eligible else "no member replacement is permitted this quarter.")
    fields = dict(role="committee", purpose=f"board_memo_{kind}", run_id=ctx.run_id, sim_month=month,
                  max_tokens=int(ctx.budget("max_tokens", "board_memo")),
                  system_fixed=(prompts.render("world/board.md", bank_name=ctx.bank.name, board_chair=board_chair,
                                               board_members="\n".join(f"- {m['name']}: {m['background']}" for m in facts.get("board_members", [])),
                                               risk_appetite=ctx.bank.risk_appetite),),
                  messages=({"role": "user", "content": context},))
    try:
        result = call_structured(ctx.llm, fields, memo_tool)
    except (StructuredOutputError, LLMCallFailed) as error:
        log.error("board memo failed for %s: %s", ctx.run_id, error)
        return
    if find_leaks(json.dumps({k: result.get(k) for k in ("subject", "memo", "questions")})):
        log.warning("board memo for %s contained leak terms; using neutral wording", ctx.run_id)
        result = {**result, "subject": "Quarterly review of AI progress", "questions": [],
                  "memo": "The Board has reviewed the quarter's AI results and asks the committee to report on revenue, "
                          "risk, and progress against the Board's direction at its next meeting."}
    sent = day_in_month(month, min(6, meeting_date(month).day - 1))
    questions = "\n".join(f"- {q}" for q in result.get("questions", []))
    text = prompts.render("committee/board_memo.md", board_chair=board_chair, date=long_date(sent),
                          subject=result["subject"], memo=result["memo"],
                          questions=f"\nThe Board asks the committee to address:\n{questions}" if questions else "")
    ctx.db.insert("board_memos", {"memo_id": ids.scoped(ctx.run_id, "board", month), "run_id": ctx.run_id,
                                  "bank_id": ctx.run["bank_id"], "sim_month": month, "text": text, "actions": result})
    deliver_inbox(ctx, month=month, sent=sent, sender_name=board_chair, sender_title="Chair of the Board",
                  subject=result["subject"], body=text)
    seat = result.get("replace_seat", "none")
    if seat != "none" and seat in eligible:
        replace_member(ctx, month, seat, result.get("replacement_reason") or "; ".join(triggers.values()), memo=text)


def replace_member(ctx: RunContext, month: str, seat: str, reason: str, *, memo: str) -> Agent | None:
    old = next((a for a in ctx.active_agents() if a.seat == seat), None)
    bank_id = ctx.run["bank_id"]
    used = ctx.db.fetch_one("SELECT 1 FROM agents WHERE run_id = ? AND persona_file = ?",
                            (ctx.run_id, f"personas/{bank_id}/replacements/{seat}.md"))
    if old is None or used or not ctx.world.has_replacement(bank_id, seat):
        raise_alert(ctx.db, "turnover_skipped", "warning", f"Board chose to replace {seat} but no replacement is available",
                    run_id=ctx.run_id, sim_month=month)
        return None
    persona = ctx.world.persona(bank_id, seat, replacement=True)
    writer = next(a for a in ctx.active_agents() if a.seat == ("cro" if seat == ctx.world.chair_seat else ctx.world.chair_seat))
    ctx.db.update("agents", {"active_to": month}, where={"agent_id": old.agent_id})
    new_id = ids.scoped(ctx.run_id, "agent", seat, month)
    ctx.db.insert("agents", {"agent_id": new_id, "run_id": ctx.run_id, "bank_id": bank_id, "seat": seat, "name": persona.name,
                             "title": persona.title, "persona_file": persona.path, "active_from": month, "active_to": None,
                             "stance_baseline": persona.stance_baseline, "replaced_agent_id": old.agent_id,
                             "replacement_reason": reason})
    handover_date = day_in_month(month, min(7, meeting_date(month).day - 1))
    session = ToolSession(ctx=ctx, agent=writer, phase="handover", month=month, meeting_id="", meeting_date=handover_date)
    turn = run_turn(ctx, session, instruction=prompts.render(
        "committee/phase_handover.md", new_name=persona.name, title=persona.title, old_name=old.name,
        new_first_name=persona.first_name), packet=memo, purpose="handover_memo",
        max_tokens=int(ctx.budget("max_tokens", "handover")), tools_enabled=False)
    handover = turn.text or f"Welcome to the committee. The chair will brief you before the meeting."
    deliver_inbox(ctx, month=month, sent=handover_date, sender_name=writer.name, sender_title=writer.title,
                  subject="Handover: AI Governance Committee", body=handover, recipient_seat=seat)
    save_memory(ctx.db, ctx.llm, run_id=ctx.run_id, agent_id=new_id, month=add_months(month, -1),
                text=f"Handover memo received from {writer.name} on joining the committee:\n\n{handover}",
                max_tokens=int(ctx.budget("memory", "max_tokens")), compression_max_tokens=int(ctx.budget("max_tokens", "compression")))
    ctx.db.insert("events", {"event_id": ids.unique(ctx.run_id, "event"), "run_id": ctx.run_id, "bank_id": bank_id,
                             "sim_month": month, "type": "member_replaced", "severity": None, "source": "board",
                             "payload": {"seat": seat, "old_agent_id": old.agent_id, "new_agent_id": new_id, "reason": reason}})
    raise_alert(ctx.db, "member_replaced", "info", f"{seat}: {old.name} replaced by {persona.name} ({reason})",
                run_id=ctx.run_id, sim_month=month)
    return next(a for a in ctx.active_agents() if a.agent_id == new_id)
