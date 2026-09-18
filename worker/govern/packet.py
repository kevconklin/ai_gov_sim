"""Monthly pre-read packet (SPEC 5 step 2). Everything here is agent-facing."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date
from typing import Any, Mapping, Sequence

from govern import prompts
from govern.calendar import add_months, long_date
from govern.context import ReviewContext, display_id
from govern.policy import sections, stats

STATUS_WORDS = {"proposed": "Proposed", "approved": "Approved, not started", "building": "In delivery",
                "live": "In production", "paused": "Paused", "retired": "Retired", "rejected": "Not approved"}


@dataclass(frozen=True)
class AgendaItem:
    item_id: str
    kind: str          # discussion | use_case | policy_edit | status_change
    title: str
    ref_id: str | None = None

    def to_json(self) -> dict[str, Any]:
        return {"item_id": self.item_id, "kind": self.kind, "title": self.title, "ref_id": self.ref_id}


def agenda_text(items: Sequence[AgendaItem]) -> str:
    return "\n".join(f"{i + 1}. {item.item_id + ': ' if item.kind != 'discussion' else ''}{item.title}"
                     for i, item in enumerate(items))


def decision_details(ctx: ReviewContext, items: Sequence[AgendaItem]) -> str:
    blocks = []
    for item in items:
        if item.kind == "use_case":
            row = ctx.db.fetch_one("SELECT u.*, a.name AS proposer FROM use_cases u LEFT JOIN agents a "
                                   "ON a.agent_id = u.proposer_agent_id WHERE use_case_id = ?", (item.ref_id,))
            details = json.loads(row["details"])
            blocks.append(f"{item.item_id} New AI initiative: {row['title']} (proposed by {row['proposer']})\n"
                          f"{row['description']}\n" + "\n".join(f"- {k.replace('_', ' ')}: {v}" for k, v in details.items()))
        elif item.kind == "policy_edit":
            row = ctx.db.fetch_one("SELECT p.*, a.name AS proposer FROM policy_edits p LEFT JOIN agents a "
                                   "ON a.agent_id = p.agent_id WHERE edit_id = ?", (item.ref_id,))
            blocks.append(f"{item.item_id} Policy language for section \"{row['section']}\" (proposed by {row['proposer']})\n"
                          f"Rationale: {row['rationale']}\nProposed text:\n{row['text']}")
        elif item.kind == "status_change":
            row = ctx.db.fetch_one("SELECT c.*, a.name AS proposer, u.title FROM status_changes c LEFT JOIN agents a "
                                   "ON a.agent_id = c.agent_id JOIN use_cases u ON u.use_case_id = c.use_case_id "
                                   "WHERE change_id = ?", (item.ref_id,))
            blocks.append(f"{item.item_id} Change {display_id(row['use_case_id'])} {row['title']} to {row['new_status']} "
                          f"(proposed by {row['proposer']})\nRationale: {row['rationale']}")
    return "\n\n".join(blocks)


def _inventory(ctx: ReviewContext) -> str:
    rows = ctx.db.fetch_all("SELECT * FROM use_cases WHERE run_id = ? AND status != 'proposed' ORDER BY use_case_id",
                            (ctx.run_id,))
    if not rows:
        return "No AI initiatives have been approved or considered yet."
    return "\n".join(f"- {display_id(r['use_case_id'])} {r['title']}: {STATUS_WORDS.get(r['status'], r['status'])}"
                     + (f", inventory risk tier {r['risk_tier']}" if r["risk_tier"] else "") for r in rows)


def _policy_summary(ctx: ReviewContext) -> str:
    text = ctx.policy_repo.read()
    heads = list(sections(text))
    if not heads:
        return "The bank has no AI policy sections adopted yet."
    return (f"{len(heads)} sections, {len(stats(text).controls)} numbered requirements. Sections: "
            + "; ".join(heads) + ". Use read_policy for the full text.")


def _findings(ctx: ReviewContext, month: str) -> str:
    rows = ctx.db.fetch_all("SELECT * FROM findings WHERE run_id = ? AND status = 'open' AND sim_month <= ? "
                            "ORDER BY sim_month", (ctx.run_id, month))
    if not rows:
        return "None."
    labels = {"observation": "Observation", "mra": "Matter Requiring Attention",
              "mria": "Matter Requiring Immediate Attention", "enforcement_referral": "Referred for enforcement review"}
    return "\n".join(f"- {labels[r['severity']]} ({r['topic']}), issued {r['sim_month']}"
                     + (f", remediation due {r['due_month']}" if r["due_month"] else "") + f": {r['required_action'] or r['description']}"
                     for r in rows)


def build_packet(ctx: ReviewContext, *, month: str, meeting_date: date, agenda: Sequence[AgendaItem]) -> str:
    db, run_id = ctx.db, ctx.run_id
    prev = db.fetch_one("SELECT minutes_text FROM meetings WHERE run_id = ? AND sim_month = ?",
                        (run_id, add_months(month, -1)))
    report = db.fetch_one("SELECT report_text FROM outcome_reports WHERE run_id = ? AND sim_month = ?", (run_id, month))
    inbox = db.fetch_all("SELECT sender_name, subject, recipient_seat FROM inbox_items WHERE run_id = ? AND sim_month = ? "
                         "AND sent_date <= ? ORDER BY sent_date", (run_id, month, meeting_date.isoformat()))
    news = db.fetch_all("SELECT outlet, headline FROM news_items WHERE run_id = ? AND sim_month = ? AND published_date <= ? "
                        "ORDER BY published_date", (run_id, month, meeting_date.isoformat()))
    first_meeting = prev is None and month == ctx.run["start_month"]
    standing = (prompts.render("committee/first_meeting.md", bank_name=ctx.org.name) if first_meeting else "")
    decisions = [i for i in agenda if i.kind != "discussion"]
    agenda_block = agenda_text(agenda)
    if decisions:
        agenda_block += "\n\nItems for decision\n" + decision_details(ctx, decisions)
    return prompts.render(
        "committee/packet.md",
        date=long_date(meeting_date),
        standing=standing,
        agenda=agenda_block,
        previous_minutes=prev["minutes_text"] if prev and prev["minutes_text"] else "None. This is the committee's first meeting." if first_meeting else "Not available.",
        outcome_report=report["report_text"] if report else "",
        inventory=_inventory(ctx),
        policy_summary=_policy_summary(ctx),
        findings=_findings(ctx, month),
        inbox_summary="\n".join(f"- {r['sender_name']}: {r['subject']}" + ("" if r["recipient_seat"] is None else " (addressed to one member)")
                                for r in inbox) or "No new correspondence. Members may have personal items; use read_inbox.",
        news_headlines="\n".join(f"- {r['outlet']}: {r['headline']}" for r in news) or "No items this month.",
    )
