"""Signed decisions as precedent.

A decision a person signed is the organization's own case law. Later reviews should read it:
what was asked, what the committee recommended, what the person decided and why, and whether
they overruled the advice. A new matter can cite an earlier decision by its id, and matters on
the same subject are matched by their words. Nothing here calls a model.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Sequence

from govern.context import display_id
from govern.db import Database
from govern.intake import KIND_LABELS

DISPLAY_ID = re.compile(r"\b[A-Z]{2,3}-\d{3,4}\b")
_WORD = re.compile(r"[a-z0-9][a-z0-9.\-]{2,}")
# words that match everything and mean nothing for precedent
_STOP = frozenset("the and for our with that this from into what use using tool tools about will would should could their there".split())
MATCH_WORDS = 2          # a subject match needs this many shared words
RECENT = 5


@dataclass(frozen=True)
class Precedent:
    item_id: str
    display_id: str
    kind: str
    title: str
    description: str
    recommended: str
    outcome: str            # approved | rejected
    actor: str
    rationale: str
    signed_on: str          # the review's date
    yes: int
    no: int
    objections_weighed: int

    @property
    def overruled(self) -> bool:
        return self.outcome != self.recommended

    def line(self) -> str:
        """One line for a pre-read: what, who, when, and whether the advice was followed."""
        how = "overruling the committee" if self.overruled else "as the committee recommended"
        return (f"{self.display_id} {KIND_LABELS.get(self.kind, self.kind)}: {self.title} - {self.outcome} by {self.actor} "
                f"on {self.signed_on}, {how} ({self.yes} yes, {self.no} no). Reason given: {self.rationale}")


def _rows(db: Database, run_id: str, *, item_ids: Sequence[str] = ()) -> list[Precedent]:
    where = "d.run_id = ? AND d.kind = 'item' AND a.outcome IN ('approved', 'rejected')"
    params: list[Any] = [run_id]
    if item_ids:
        where += f" AND i.item_id IN ({', '.join('?' for _ in item_ids)})"
        params += list(item_ids)
    rows = db.fetch_all(
        f"""SELECT i.item_id, i.kind, i.title, i.description, d.outcome AS recommended, a.outcome, a.actor, a.rationale,
                   a.responded_to, m.meeting_date, d.yes_votes, d.no_votes
            FROM attestations a
            JOIN decisions d ON d.decision_id = a.decision_id
            JOIN meetings m ON m.meeting_id = d.meeting_id
            JOIN items i ON i.item_id = d.ref_id
            WHERE {where} ORDER BY m.meeting_date DESC, a.created_at DESC""", params)
    out = []
    for r in rows:
        answered = r["responded_to"]
        answered = json.loads(answered) if isinstance(answered, str) else (answered or [])
        out.append(Precedent(item_id=r["item_id"], display_id=display_id(r["item_id"]), kind=r["kind"], title=r["title"],
                             description=r["description"], recommended=r["recommended"], outcome=r["outcome"], actor=r["actor"],
                             rationale=r["rationale"], signed_on=str(r["meeting_date"]), yes=int(r["yes_votes"]), no=int(r["no_votes"]),
                             objections_weighed=len(answered)))
    return out


def signed(db: Database, run_id: str) -> tuple[Precedent, ...]:
    """Every decision a person has signed on an intake matter, newest first. Deferrals are not decisions."""
    return tuple(_rows(db, run_id))


def by_display_id(db: Database, run_id: str, wanted: str) -> Precedent | None:
    wanted = wanted.strip().upper()
    return next((p for p in signed(db, run_id) if p.display_id == wanted), None)


def _words(*texts: str) -> set[str]:
    return {w for t in texts for w in _WORD.findall(t.lower()) if w not in _STOP}


def related(db: Database, run_id: str, *, item_id: str) -> tuple[tuple[Precedent, str], ...]:
    """Precedent for one matter: what its submitter cited, then anything on the same subject.

    Each is paired with how it was found ("cited" or "same subject"), so the pre-read can say so.
    """
    row = db.fetch_one("SELECT title, description, details FROM items WHERE item_id = ?", (item_id,))
    if row is None:
        return ()
    details = row["details"]
    details = json.loads(details) if isinstance(details, str) else (details or {})
    cited = [str(x).strip().upper() for x in (details.get("related_decisions") or []) if DISPLAY_ID.fullmatch(str(x).strip().upper())]
    found: list[tuple[Precedent, str]] = []
    seen: set[str] = set()
    for p in signed(db, run_id):
        if p.item_id == item_id:
            continue
        if p.display_id in cited:
            found.append((p, "cited"))
            seen.add(p.item_id)
    mine = _words(row["title"], row["description"])
    scored = []
    for p in signed(db, run_id):
        if p.item_id in seen or p.item_id == item_id:
            continue
        shared = mine & _words(p.title, p.description)
        if len(shared) >= MATCH_WORDS:
            scored.append((len(shared), p))
    found += [(p, "same subject") for _, p in sorted(scored, key=lambda x: -x[0])[:3]]
    return tuple(found)


def pre_read(db: Database, run_id: str, agenda_item_ids: Sequence[str]) -> str:
    """The precedent section of a review's pre-read: per agenda item, then the most recent signed decisions."""
    blocks = []
    shown: set[str] = set()
    for item_id in agenda_item_ids:
        matches = related(db, run_id, item_id=item_id)
        if not matches:
            continue
        lines = [f"For {display_id(item_id)}:"]
        for p, how in matches:
            lines.append(f"- {p.line()} [{'cited by the submitter' if how == 'cited' else 'same subject'}]")
            shown.add(p.item_id)
        blocks.append("\n".join(lines))
    recent = [p for p in signed(db, run_id) if p.item_id not in shown][:RECENT]
    if recent:
        blocks.append("Most recent signed decisions:\n" + "\n".join(f"- {p.line()}" for p in recent))
    if not blocks:
        return "None yet. Nothing a person has signed bears on this agenda."
    return "\n\n".join(blocks) + "\n\nUse read_decision for the full record of any of them."


def record(db: Database, run_id: str, wanted: str) -> str:
    """The full record of one signed decision, for an adviser who asks."""
    p = by_display_id(db, run_id, wanted)
    if p is None:
        have = ", ".join(x.display_id for x in signed(db, run_id)[:12])
        return f"No signed decision {wanted.strip().upper()}." + (f" Signed decisions: {have}." if have else " Nothing has been signed yet.")
    how = "This overruled the committee." if p.overruled else "This followed the committee's recommendation."
    return (f"{p.display_id} {KIND_LABELS.get(p.kind, p.kind)}: {p.title}\n\nWhat was submitted:\n{p.description}\n\n"
            f"The committee recommended: {p.recommended} ({p.yes} yes, {p.no} no).\n"
            f"Decision: {p.outcome}, signed by {p.actor} on {p.signed_on}. {how}"
            + (f" {p.objections_weighed} objection(s) were weighed and answered before signing." if p.objections_weighed else "")
            + f"\n\nReason given by {p.actor}:\n{p.rationale}")
