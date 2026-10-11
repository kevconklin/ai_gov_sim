"""What the committee recommends a person do, beyond a vote.

A ballot answers one question. The useful part of a committee is what it says around it: who
should own this, on what conditions, which document the organization is missing (and a draft
of it), what wording the policy needs, what to check and by when. Each of those is a
recommendation on the record, attached to the matter and the seat that made it. Nothing here
applies on its own: a person adds the document, proposes the wording through intake, names
the owner. The committee never writes.
"""

from __future__ import annotations

from typing import Any, Mapping

from govern import ids
from govern.db import Database, utc_now_iso

KINDS: Mapping[str, str] = {
    "owner": "Who should own it",
    "condition": "A condition for approval",
    "document": "A document to adopt",
    "policy_wording": "Policy wording to propose",
    "follow_up": "A follow-up",
}
MAX_BODY = 12_000


class RecommendError(ValueError):
    """The recommendation is missing something a person would need to act on it."""


def record(db: Database, run_id: str, *, meeting_id: str, item_id: str, agent_id: str, kind: str, title: str, body: str,
           due: str | None = None) -> str:
    if kind not in KINDS:
        raise RecommendError(f"kind must be one of {', '.join(KINDS)}")
    if len(title.strip()) < 3:
        raise RecommendError("a recommendation needs a title a person can act on")
    if len(body.strip()) < 10:
        raise RecommendError("say what you recommend and why, in at least a sentence")
    if len(body) > MAX_BODY:
        raise RecommendError(f"keep a recommendation under {MAX_BODY:,} characters; a longer document can be summarized")
    rec_id = ids.unique(run_id, "rec")
    db.insert("recommendations", {"rec_id": rec_id, "run_id": run_id, "meeting_id": meeting_id, "item_id": item_id.strip().upper(),
                                  "agent_id": agent_id, "kind": kind, "title": title.strip(), "body": body.strip(),
                                  "due": (due or "").strip() or None, "created_at": utc_now_iso()})
    return rec_id


def for_item(db: Database, meeting_id: str, item_id: str) -> list[Any]:
    return db.fetch_all("SELECT r.*, a.title AS seat_title, a.seat FROM recommendations r JOIN agents a ON a.agent_id = r.agent_id "
                        "WHERE r.meeting_id = ? AND r.item_id = ? ORDER BY r.kind, r.created_at", (meeting_id, item_id.upper()))


def summary(db: Database, meeting_id: str, item_id: str) -> str:
    """One block for the minutes and the pre-read of a later review: what was recommended, by whom."""
    rows = for_item(db, meeting_id, item_id)
    if not rows:
        return ""
    lines = [f"- {KINDS[r['kind']]}: {r['title']} ({r['seat_title']})" + (f", by {r['due']}" if r["due"] else "") for r in rows]
    return "Recommendations recorded:\n" + "\n".join(lines)
