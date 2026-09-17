"""Committee member tool handlers (SPEC 4.4). Every result string is agent-facing."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any, Callable, Mapping

from pydantic import BaseModel, Field, ValidationError

from sim import prompts
from sim.calendar import long_date
from sim.context import Agent, RunContext, display_id, next_display_id
from sim.policy import read_section

TOOLS: tuple[Mapping[str, Any], ...] = tuple(prompts.load_yaml("committee/tools.yaml"))
READ_TOOLS = frozenset({"read_policy", "search_decision_log", "read_use_case", "read_news", "read_inbox"})
PROPOSE_TOOLS = frozenset({"propose_use_case", "propose_policy_edit", "propose_status_change"})
PHASE_TOOLS: Mapping[str, frozenset[str]] = {
    "circulate": READ_TOOLS | PROPOSE_TOOLS,
    "position": READ_TOOLS | {"submit_position"},
    "debate": READ_TOOLS | PROPOSE_TOOLS | {"pass_turn"},
    "vote": frozenset({"read_policy", "read_use_case", "cast_vote"}),
    "minutes": frozenset({"read_policy", "record_minutes"}),
    "memory": READ_TOOLS,
    "handover": READ_TOOLS,
}
NOT_AVAILABLE = "That action is not available at this point in the meeting."


@dataclass
class ToolSession:
    """Mutable record of what one member did during one call sequence."""
    ctx: RunContext
    agent: Agent
    phase: str
    month: str
    meeting_id: str
    meeting_date: date
    decision_items: Mapping[str, str] = field(default_factory=dict)   # item_id -> title
    created_items: list[str] = field(default_factory=list)
    positions: dict[str, int] = field(default_factory=dict)
    votes: dict[str, str] = field(default_factory=dict)
    minutes: dict[str, Any] | None = None
    passed: bool = False


class UseCaseProposal(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    description: str = Field(min_length=10)
    line_of_business: str
    delivery: str
    vendor_name: str | None = None
    customer_facing: bool
    affects_credit_decisions: bool
    data_used: list[str] = []
    human_review: str | None = None
    expected_benefit: str
    estimated_cost_usd: float | None = Field(default=None, ge=0)


def _read_policy(s: ToolSession, args: Mapping[str, Any]) -> str:
    text = s.ctx.policy_repo.read()
    if args.get("section"):
        body = read_section(text, str(args["section"]))
        return body if body is not None else f"The policy has no section titled \"{args['section']}\"."
    return text


def _search_decision_log(s: ToolSession, args: Mapping[str, Any]) -> str:
    words = [w for w in re.findall(r"[a-z0-9-]+", str(args.get("query", "")).lower()) if len(w) > 2]
    rows = s.ctx.db.fetch_all(
        """SELECT d.sim_month, d.item_id, d.kind, d.outcome, d.yes_votes, d.no_votes, d.abstentions,
                  COALESCE(u.title, p.section, uc2.title, '') AS title,
                  COALESCE(u.description, p.text, c.rationale, '') AS body
           FROM decisions d
           LEFT JOIN use_cases u ON d.kind = 'use_case' AND u.use_case_id = d.ref_id
           LEFT JOIN policy_edits p ON d.kind = 'policy_edit' AND p.edit_id = d.ref_id
           LEFT JOIN status_changes c ON d.kind = 'status_change' AND c.change_id = d.ref_id
           LEFT JOIN use_cases uc2 ON c.use_case_id = uc2.use_case_id
           WHERE d.run_id = ? ORDER BY d.sim_month DESC""", (s.ctx.run_id,))
    scored = []
    for row in rows:
        haystack = f"{row['item_id']} {row['title']} {row['body']}".lower()
        score = sum(w in haystack for w in words) if words else 1
        if score:
            scored.append((score, row))
    minutes = s.ctx.db.fetch_all("SELECT meeting_date, minutes_text FROM meetings WHERE run_id = ? AND minutes_text IS NOT NULL "
                                 "ORDER BY sim_month DESC", (s.ctx.run_id,))
    minute_hits = [m for m in minutes if words and any(w in m["minutes_text"].lower() for w in words)][:3]
    if not scored and not minute_hits:
        return "No matching decisions or minutes."
    lines = [f"{r['sim_month']} {r['item_id']} ({r['kind'].replace('_', ' ')}): {r['title']} - {r['outcome']} "
             f"({r['yes_votes']} yes, {r['no_votes']} no, {r['abstentions']} abstain)"
             for _, r in sorted(scored, key=lambda x: -x[0])[:10]]
    for m in minute_hits:
        excerpt = m["minutes_text"][:700]
        lines.append(f"Minutes of {m['meeting_date']}: {excerpt}")
    return "\n".join(lines)


def _read_use_case(s: ToolSession, args: Mapping[str, Any]) -> str:
    wanted = str(args.get("use_case_id", "")).strip().upper()
    row = s.ctx.db.fetch_one("SELECT * FROM use_cases WHERE use_case_id = ?", (f"{s.ctx.run_id}/uc/{wanted}",))
    if row is None:
        return f"No AI initiative with id {wanted}."
    details = json.loads(row["details"])
    record = {"id": wanted, "title": row["title"], "status": row["status"], "description": row["description"],
              "proposed": row["proposed_month"], "decided": row["decided_month"], "in_production_since": row["live_month"],
              "inventory_risk_tier": row["risk_tier"] or "not yet classified", **details}
    return json.dumps({k: v for k, v in record.items() if v not in (None, [], "")}, indent=2)


def _read_news(s: ToolSession, args: Mapping[str, Any]) -> str:
    days = int(args.get("days") or 31)
    since = (s.meeting_date - timedelta(days=max(1, min(days, 120)))).isoformat()
    rows = s.ctx.db.fetch_all("SELECT * FROM news_items WHERE run_id = ? AND published_date >= ? AND published_date <= ? "
                              "ORDER BY published_date DESC LIMIT 15",
                              (s.ctx.run_id, since, s.meeting_date.isoformat()))
    if not rows:
        return "No news items in that period."
    return "\n\n".join(f"{r['outlet']}, {long_date(date.fromisoformat(r['published_date']))}\n{r['headline']}\n{r['body']}"
                       for r in rows)


def _read_inbox(s: ToolSession, args: Mapping[str, Any]) -> str:
    from sim.calendar import add_months
    rows = s.ctx.db.fetch_all(
        "SELECT * FROM inbox_items WHERE run_id = ? AND sim_month IN (?, ?) AND sent_date <= ? "
        "AND (recipient_seat IS NULL OR recipient_seat = ?) ORDER BY sent_date DESC",
        (s.ctx.run_id, s.month, add_months(s.month, -1), s.meeting_date.isoformat(), s.agent.seat))
    if not rows:
        return "Your inbox has no new items."
    return "\n\n---\n\n".join(
        f"From: {r['sender_name']}, {r['sender_title']}\nDate: {long_date(date.fromisoformat(r['sent_date']))}\n"
        f"To: {'AI Governance Committee' if r['recipient_seat'] is None else s.agent.name}\nSubject: {r['subject']}\n\n{r['body']}"
        for r in rows)


def _submit_position(s: ToolSession, args: Mapping[str, Any]) -> str:
    item = str(args.get("item_id", "")).strip().upper()
    if item not in s.decision_items:
        return f"{item} is not an agenda item for decision. Items for decision: {', '.join(s.decision_items) or 'none'}."
    support = int(args["support"])
    if not 1 <= support <= 5:
        return "Support must be between 1 and 5."
    s.ctx.db.execute("DELETE FROM positions WHERE meeting_id = ? AND agent_id = ? AND item_id = ?",
                     (s.meeting_id, s.agent.agent_id, item))
    s.ctx.db.insert("positions", {"run_id": s.ctx.run_id, "meeting_id": s.meeting_id, "agent_id": s.agent.agent_id,
                                  "item_id": item, "support": support,
                                  "position": {k: args.get(k) for k in ("summary", "concerns", "conditions")}})
    s.positions[item] = support
    return f"Position on {item} recorded."


def _propose_use_case(s: ToolSession, args: Mapping[str, Any]) -> str:
    proposal = UseCaseProposal.model_validate(args)
    item = next_display_id(s.ctx.db, s.ctx.run_id, "use_cases", "use_case_id", "UC")
    details = proposal.model_dump(exclude={"title", "description"}, exclude_none=True)
    s.ctx.db.insert("use_cases", {
        "use_case_id": f"{s.ctx.run_id}/uc/{item}", "run_id": s.ctx.run_id, "bank_id": s.ctx.run["bank_id"],
        "title": proposal.title, "description": proposal.description, "lob": proposal.line_of_business,
        "details": details, "status": "proposed", "proposed_month": s.month,
        "proposer_agent_id": s.agent.agent_id, "meeting_id": s.meeting_id,
    })
    s.created_items.append(item)
    return f"Recorded as {item}. It will be placed on the agenda for decision."


def _propose_policy_edit(s: ToolSession, args: Mapping[str, Any]) -> str:
    section, text = str(args.get("section", "")).strip(), str(args.get("text", "")).strip()
    if not section or not text:
        return "A policy proposal needs a section heading and text."
    item = next_display_id(s.ctx.db, s.ctx.run_id, "policy_edits", "edit_id", "PE")
    s.ctx.db.insert("policy_edits", {
        "edit_id": f"{s.ctx.run_id}/pe/{item}", "run_id": s.ctx.run_id, "bank_id": s.ctx.run["bank_id"],
        "meeting_id": s.meeting_id, "sim_month": s.month, "agent_id": s.agent.agent_id, "section": section,
        "text": text, "rationale": args.get("rationale"), "status": "proposed",
    })
    s.created_items.append(item)
    return f"Recorded as {item}. It will be placed on the agenda for decision."


def _propose_status_change(s: ToolSession, args: Mapping[str, Any]) -> str:
    target = str(args.get("use_case_id", "")).strip().upper()
    row = s.ctx.db.fetch_one("SELECT status FROM use_cases WHERE use_case_id = ?", (f"{s.ctx.run_id}/uc/{target}",))
    new_status = args.get("new_status")
    allowed = {"paused": {"approved", "building", "live"}, "retired": {"approved", "building", "live", "paused"},
               "resume": {"paused"}}
    if row is None:
        return f"No AI initiative with id {target}."
    if new_status not in allowed or row["status"] not in allowed[new_status]:
        return f"{target} is currently {row['status']} and cannot be changed to {new_status}."
    item = next_display_id(s.ctx.db, s.ctx.run_id, "status_changes", "change_id", "SC")
    s.ctx.db.insert("status_changes", {
        "change_id": f"{s.ctx.run_id}/sc/{item}", "run_id": s.ctx.run_id, "meeting_id": s.meeting_id,
        "sim_month": s.month, "agent_id": s.agent.agent_id, "use_case_id": f"{s.ctx.run_id}/uc/{target}",
        "new_status": new_status, "rationale": args.get("rationale"), "status": "proposed",
    })
    s.created_items.append(item)
    return f"Recorded as {item}. It will be placed on the agenda for decision."


def _pass_turn(s: ToolSession, args: Mapping[str, Any]) -> str:
    s.passed = True
    return "Noted."


def _cast_vote(s: ToolSession, args: Mapping[str, Any]) -> str:
    item = str(args.get("item_id", "")).strip().upper()
    vote = args.get("vote")
    if item not in s.decision_items:
        return f"{item} is not open for voting. Open items: {', '.join(s.decision_items)}."
    if vote not in ("yes", "no", "abstain"):
        return "Vote must be yes, no, or abstain."
    s.ctx.db.execute("DELETE FROM votes WHERE meeting_id = ? AND agent_id = ? AND item_id = ?",
                     (s.meeting_id, s.agent.agent_id, item))
    s.ctx.db.insert("votes", {"run_id": s.ctx.run_id, "meeting_id": s.meeting_id, "agent_id": s.agent.agent_id,
                              "item_id": item, "vote": vote, "rationale": args.get("rationale")})
    s.votes[item] = vote
    return f"Ballot on {item} recorded."


def _record_minutes(s: ToolSession, args: Mapping[str, Any]) -> str:
    if s.agent.seat != s.ctx.world.chair_seat:
        return NOT_AVAILABLE
    s.minutes = {k: args.get(k) for k in ("summary", "key_points", "action_items")}
    return "Minutes recorded."


HANDLERS: Mapping[str, Callable[[ToolSession, Mapping[str, Any]], str]] = {
    "read_policy": _read_policy, "search_decision_log": _search_decision_log, "read_use_case": _read_use_case,
    "read_news": _read_news, "read_inbox": _read_inbox, "submit_position": _submit_position,
    "propose_use_case": _propose_use_case, "propose_policy_edit": _propose_policy_edit,
    "propose_status_change": _propose_status_change, "pass_turn": _pass_turn, "cast_vote": _cast_vote,
    "record_minutes": _record_minutes,
}


def execute(session: ToolSession, name: str, args: Mapping[str, Any]) -> tuple[str, bool]:
    """Run one tool call. Returns (agent-facing result, is_error)."""
    if name not in HANDLERS or name not in PHASE_TOOLS.get(session.phase, frozenset()):
        return NOT_AVAILABLE, True
    try:
        return HANDLERS[name](session, args), False
    except ValidationError as error:
        problems = "; ".join(f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in error.errors())
        return f"The submission was incomplete or invalid: {problems}", True
    except (KeyError, TypeError, ValueError) as error:
        return f"The submission was incomplete or invalid: {error}", True
