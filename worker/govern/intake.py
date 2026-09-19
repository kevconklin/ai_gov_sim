"""Intake: how an AI matter reaches the committee.

Anything an organisation wants reviewed is submitted here first. It then shows up as a ranked
candidate, and a person decides whether and when it goes on an agenda. A question is the one
kind that is never put to a vote: it is heard as an advisory item and answered with a synthesis.
"""

from __future__ import annotations

from datetime import date
from typing import Any, Mapping, Sequence

from govern import ids
from govern.context import next_display_id
from govern.db import Database

KIND_LABELS: Mapping[str, str] = {
    "use_case": "AI use case",
    "tool": "AI tool",
    "vendor": "AI vendor",
    "policy_change": "Policy change",
    "exception": "Policy exception",
    "incident": "AI incident",
    "question": "Question for the committee",
}
RISK_TIERS = ("low", "medium", "high")
OPEN, IN_REVIEW, RECOMMENDED, ADVISED, WITHDRAWN = "submitted", "in_review", "recommended", "advised", "withdrawn"


class IntakeError(ValueError):
    """The submission cannot be taken as it stands."""


def submit_item(db: Database, run_id: str, *, kind: str, title: str, description: str, submitted_by: str,
                risk_tier: str | None = None, details: Mapping[str, Any] | None = None,
                today: date | None = None) -> str:
    if kind not in KIND_LABELS:
        raise IntakeError(f"kind must be one of {', '.join(KIND_LABELS)}")
    if risk_tier is not None and risk_tier not in RISK_TIERS:
        raise IntakeError(f"risk tier must be one of {', '.join(RISK_TIERS)}")
    if len(title.strip()) < 3 or len(description.strip()) < 10:
        raise IntakeError("a submission needs a title and a description the committee can act on")
    if not submitted_by.strip():
        raise IntakeError("a submission needs a submitter")
    item_id = ids.scoped(run_id, "item", next_display_id(db, run_id, "items", "item_id", "IT"))
    db.insert("items", {
        "item_id": item_id, "run_id": run_id, "kind": kind, "title": title.strip(),
        "description": description.strip(), "details": dict(details or {}), "risk_tier": risk_tier,
        "status": OPEN, "submitted_by": submitted_by.strip(), "submitted_on": (today or date.today()).isoformat(),
    })
    return item_id


def withdraw_item(db: Database, item_id: str) -> None:
    """Only something not yet in front of the committee can be pulled back."""
    if not db.update("items", {"status": WITHDRAWN}, where={"item_id": item_id, "status": OPEN}):
        raise IntakeError(f"{item_id} is not open, so it cannot be withdrawn")


def mark_items(db: Database, item_ids: Sequence[str | None], status: str, *, decided_on: date | None = None) -> None:
    """Move intake items through review. Ids that are not intake items are ignored, so callers
    can pass every agenda reference without sorting them first."""
    for item_id in item_ids:
        if item_id:
            values = {"status": status, **({"decided_on": decided_on.isoformat()} if decided_on else {})}
            db.update("items", values, where={"item_id": item_id})


def get_item(db: Database, item_id: str) -> Any:
    return db.fetch_one("SELECT * FROM items WHERE item_id = ?", (item_id,))
