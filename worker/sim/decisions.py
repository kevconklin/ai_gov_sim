"""Vote tallies and applying committee decisions to records and the policy repo (SPEC 5 steps 6-7)."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date
from typing import Mapping, Sequence

from sim import ids
from sim.calendar import long_date
from sim.context import RunContext
from sim.packet import AgendaItem
from sim.policy import PolicyError, apply_edit, stats

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Tally:
    yes: int
    no: int
    abstain: int
    approved: bool
    tie_broken: bool


@dataclass(frozen=True)
class Decision:
    decision_id: str
    item: AgendaItem
    tally: Tally
    attested_outcome: str | None = None   # set by sim.attestation once a human is on record

    @property
    def outcome(self) -> str:
        """The human's outcome where one exists, otherwise the committee's recommendation."""
        if self.attested_outcome:
            return self.attested_outcome
        return "approved" if self.tally.approved else "rejected"


def tally(votes: Mapping[str, str], chair_agent_id: str) -> Tally:
    """Majority of votes cast carries; on a tie the chair's ballot decides (abstaining chair = not carried)."""
    yes = sum(v == "yes" for v in votes.values())
    no = sum(v == "no" for v in votes.values())
    abstain = sum(v == "abstain" for v in votes.values())
    if yes != no:
        return Tally(yes, no, abstain, approved=yes > no, tie_broken=False)
    return Tally(yes, no, abstain, approved=yes > 0 and votes.get(chair_agent_id) == "yes", tie_broken=yes > 0)


def record_decisions(ctx: RunContext, *, meeting_id: str, month: str, items: Sequence[AgendaItem],
                     chair_agent_id: str) -> list[Decision]:
    decisions = []
    for item in items:
        rows = ctx.db.fetch_all("SELECT agent_id, vote FROM votes WHERE meeting_id = ? AND item_id = ?",
                                (meeting_id, item.item_id))
        result = tally({r["agent_id"]: r["vote"] for r in rows}, chair_agent_id)
        decision = Decision(ids.scoped(ctx.run_id, "decision", item.item_id), item, result)
        ctx.db.insert("decisions", {
            "decision_id": decision.decision_id, "run_id": ctx.run_id, "bank_id": ctx.run["bank_id"],
            "meeting_id": meeting_id, "sim_month": month, "item_id": item.item_id, "kind": item.kind,
            "ref_id": item.ref_id, "outcome": decision.outcome, "yes_votes": result.yes, "no_votes": result.no,
            "abstentions": result.abstain, "tie_broken": result.tie_broken,
        })
        decisions.append(decision)
    return decisions


def set_use_case_status(ctx: RunContext, use_case_id: str, month: str, new_status: str, *, source: str,
                        decision_id: str | None = None) -> None:
    row = ctx.db.fetch_one("SELECT status FROM use_cases WHERE use_case_id = ?", (use_case_id,))
    if row is None or row["status"] == new_status:
        return
    values = {"status": new_status}
    if new_status in ("approved", "rejected"):
        values["decided_month"] = month
    if new_status == "live":
        values["live_month"] = month
    if new_status == "retired":
        values["retired_month"] = month
    ctx.db.update("use_cases", values, where={"use_case_id": use_case_id})
    ctx.db.insert("use_case_history", {
        "history_id": ids.unique(ctx.run_id, "uch"), "run_id": ctx.run_id, "use_case_id": use_case_id,
        "sim_month": month, "from_status": row["status"], "to_status": new_status, "source": source,
        "decision_id": decision_id,
    })


def apply_decisions(ctx: RunContext, decisions: Sequence[Decision], *, month: str, meeting_date: date) -> list[str]:
    """Update records and commit approved policy language. Returns notes about edits that could not apply."""
    problems = []
    policy_text = ctx.policy_repo.read()
    adopted = []
    for d in decisions:
        if d.item.kind == "use_case":
            set_use_case_status(ctx, d.item.ref_id, month, d.outcome, source="committee", decision_id=d.decision_id)
        elif d.item.kind == "policy_edit":
            edit = ctx.db.fetch_one("SELECT section, text FROM policy_edits WHERE edit_id = ?", (d.item.ref_id,))
            status = d.outcome
            if d.outcome == "approved":
                try:
                    policy_text = apply_edit(policy_text, edit["section"], edit["text"])
                    adopted.append(d.item.item_id)
                except PolicyError as error:
                    problems.append(f"{d.item.item_id}: {error}")
                    status = "rejected"
            ctx.db.update("policy_edits", {"status": status}, where={"edit_id": d.item.ref_id})
        elif d.item.kind == "status_change":
            change = ctx.db.fetch_one("SELECT use_case_id, new_status FROM status_changes WHERE change_id = ?",
                                      (d.item.ref_id,))
            ctx.db.update("status_changes", {"status": d.outcome}, where={"change_id": d.item.ref_id})
            if d.outcome == "approved":
                target = change["new_status"]
                if target == "resume":
                    uc = ctx.db.fetch_one("SELECT live_month FROM use_cases WHERE use_case_id = ?", (change["use_case_id"],))
                    target = "live" if uc["live_month"] else "building"
                set_use_case_status(ctx, change["use_case_id"], month, target, source="committee",
                                    decision_id=d.decision_id)
    message = (f"{meeting_date.isoformat()}: adopted {', '.join(adopted)}" if adopted
               else f"{meeting_date.isoformat()}: no policy changes")
    sha = ctx.policy_repo.commit(policy_text, message, meeting_date)
    policy_stats = stats(policy_text)
    ctx.db.upsert("policy_versions", {
        "run_id": ctx.run_id, "bank_id": ctx.run["bank_id"], "sim_month": month, "git_sha": sha,
        "policy_text": policy_text, "word_count": policy_stats.word_count,
        "control_count": len(policy_stats.controls), "controls": list(policy_stats.controls),
        "readability": policy_stats.readability_grade,
    }, key=("run_id", "sim_month"))
    return problems


def results_text(decisions: Sequence[Decision]) -> str:
    if not decisions:
        return "No items were put to a vote."
    return "\n".join(f"- {d.item.item_id} {d.item.title}: {'Carried' if d.tally.approved else 'Not carried'} "
                     f"({d.tally.yes} yes, {d.tally.no} no, {d.tally.abstain} abstaining"
                     + ("; tie decided by the chair" if d.tally.tie_broken else "") + ")" for d in decisions)


def minutes_text(*, bank_name: str, meeting_date: date, present: Sequence[str], minutes: Mapping | None,
                 decisions: Sequence[Decision]) -> str:
    summary = (minutes or {}).get("summary") or "The chair did not record a narrative summary."
    points = "\n".join(f"- {p}" for p in (minutes or {}).get("key_points") or []) or "- None recorded"
    actions = "\n".join(f"- {a.get('owner', 'Unassigned')}: {a.get('action', '')}" + (f" (due {a['due']})" if a.get("due") else "")
                        for a in (minutes or {}).get("action_items") or []) or "- None recorded"
    return (f"{bank_name} AI Governance Committee\nMinutes of the meeting held {long_date(meeting_date)}\n"
            f"Present: {', '.join(present)}\n\n{summary}\n\nKey points\n{points}\n\n"
            f"Decisions\n{results_text(decisions)}\n\nAction items\n{actions}")
