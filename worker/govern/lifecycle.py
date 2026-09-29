"""A use case across its life.

Approval is a beginning, not an end. An approved use case is built, piloted, goes live, is paused
or retired, and comes back to the committee on a schedule set by its risk. The stage is changed
by a person with a note, every change is a row of its own, and a re-review arrives through intake
like any other matter, citing the decision that approved it, so the committee reads its own
precedent and the person signs again.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Mapping, Sequence

import yaml

from govern import ids
from govern.config import ConfigError
from govern.context import display_id
from govern.db import Database, utc_now_iso

ACTIVE = ("approved", "building", "piloting", "live")     # stages a re-review applies to
STAGE_WORDS = {"approved": "Approved", "building": "Building", "piloting": "Piloting", "live": "Live", "paused": "Paused", "retired": "Retired"}


class LifecycleError(ValueError):
    """The stage change cannot be made as asked."""


@dataclass(frozen=True)
class LifecycleConfig:
    stages: tuple[str, ...]
    transitions: Mapping[str, tuple[str, ...]]
    review_every_months: Mapping[str, int]

    def months_for(self, risk_tier: str | None) -> int:
        return int(self.review_every_months.get(risk_tier or "medium", self.review_every_months["medium"]))


def load_lifecycle(config_dir: Path) -> LifecycleConfig:
    path = Path(config_dir) / "lifecycle.yaml"
    if not path.is_file():
        raise ConfigError(f"missing config file: lifecycle.yaml (looked in {config_dir})")
    data = yaml.safe_load(path.read_text()) or {}
    stages = tuple(str(s) for s in data.get("stages") or [])
    transitions = {str(k): tuple(str(x) for x in v or []) for k, v in (data.get("transitions") or {}).items()}
    months = {str(k): int(v) for k, v in (data.get("review_every_months") or {}).items()}
    if not stages or set(transitions) != set(stages) or any(set(v) - set(stages) for v in transitions.values()):
        raise ConfigError("lifecycle.yaml: every stage needs a transitions entry naming only known stages")
    if "medium" not in months:
        raise ConfigError("lifecycle.yaml: review_every_months needs at least 'medium'")
    return LifecycleConfig(stages=stages, transitions=transitions, review_every_months=months)


def _add_months(d: date, months: int) -> date:
    month = d.month - 1 + months
    year = d.year + month // 12
    month = month % 12 + 1
    day = min(d.day, [31, 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1])
    return date(year, month, day)


def _item(db: Database, item_id: str) -> Any:
    row = db.fetch_one("SELECT * FROM items WHERE item_id = ?", (item_id,))
    if row is None:
        raise LifecycleError(f"no such matter: {item_id}")
    return row


def _details(row: Any) -> dict[str, Any]:
    d = row["details"]
    return json.loads(d) if isinstance(d, str) else dict(d or {})


def _log(db: Database, run_id: str, item_id: str, *, from_stage: str | None, to_stage: str, by: str, on: date, note: str) -> str:
    change_id = ids.unique(run_id, "stage")
    db.insert("stage_changes", {"change_id": change_id, "run_id": run_id, "item_id": item_id, "from_stage": from_stage,
                                "to_stage": to_stage, "changed_by": by, "changed_on": on.isoformat(), "note": note,
                                "created_at": utc_now_iso()})
    return change_id


# ---- after a decision ---------------------------------------------------------------------------

def after_decision(db: Database, run_id: str, *, item_id: str, outcome: str, by: str, on: date, config: LifecycleConfig) -> None:
    """What a signed decision does to a use case's life: start it, renew it, or stop it."""
    row = _item(db, item_id)
    details = _details(row)
    original_id = details.get("rereview_of")
    if original_id:
        original = db.fetch_one("SELECT * FROM items WHERE item_id = ?", (original_id,))
        if original is None:
            return
        if outcome == "approved":
            due = _add_months(on, config.months_for(original["risk_tier"]))
            db.update("items", {"review_due": due.isoformat()}, where={"item_id": original_id})
            _log(db, run_id, original_id, from_stage=original["stage"], to_stage=original["stage"] or "approved", by=by, on=on,
                 note=f"Re-review {display_id(item_id)} signed approved; next review due {due.isoformat()}.")
        elif outcome == "rejected" and original["stage"] in ACTIVE:
            db.update("items", {"stage": "paused", "stage_changed_on": on.isoformat()}, where={"item_id": original_id})
            _log(db, run_id, original_id, from_stage=original["stage"], to_stage="paused", by=by, on=on,
                 note=f"Re-review {display_id(item_id)} signed rejected; paused until the committee approves it again.")
        return
    if row["kind"] != "use_case" or outcome != "approved" or row["stage"]:
        return
    due = _add_months(on, config.months_for(row["risk_tier"]))
    db.update("items", {"stage": "approved", "stage_changed_on": on.isoformat(), "review_due": due.isoformat(),
                        "owner": row["owner"] or details.get("accountable_owner") or None}, where={"item_id": item_id})
    _log(db, run_id, item_id, from_stage=None, to_stage="approved", by=by, on=on, note=f"Approved; review due {due.isoformat()}.")


# ---- what a person does -------------------------------------------------------------------------

def set_stage(db: Database, run_id: str, item_id: str, *, to: str, by: str, note: str, on: date, config: LifecycleConfig) -> None:
    row = _item(db, item_id)
    if row["run_id"] != run_id:
        raise LifecycleError("that matter belongs to another organization")
    if not row["stage"]:
        raise LifecycleError("only an approved use case has a stage; this one has not been approved")
    if to not in config.stages:
        raise LifecycleError(f"stage must be one of {', '.join(config.stages)}")
    if to not in config.transitions.get(row["stage"], ()):
        raise LifecycleError(f"a use case that is {STAGE_WORDS.get(row['stage'], row['stage']).lower()} cannot go straight to {STAGE_WORDS.get(to, to).lower()}")
    if len(note.strip()) < 10:
        raise LifecycleError("a stage change needs a note of at least 10 characters: someone will ask what happened")
    db.update("items", {"stage": to, "stage_changed_on": on.isoformat()}, where={"item_id": item_id})
    _log(db, run_id, item_id, from_stage=row["stage"], to_stage=to, by=by, on=on, note=note.strip())


def set_owner(db: Database, run_id: str, item_id: str, *, owner: str, by: str, on: date) -> None:
    row = _item(db, item_id)
    if row["run_id"] != run_id:
        raise LifecycleError("that matter belongs to another organization")
    if len(owner.strip()) < 2:
        raise LifecycleError("an owner needs a name")
    db.update("items", {"owner": owner.strip()}, where={"item_id": item_id})
    _log(db, run_id, item_id, from_stage=row["stage"], to_stage=row["stage"] or "approved", by=by, on=on,
         note=f"Owner set to {owner.strip()}" + (f" (was {row['owner']})" if row["owner"] else "") + ".")


def history(db: Database, item_id: str) -> list[Any]:
    return db.fetch_all("SELECT from_stage, to_stage, changed_by, changed_on, note FROM stage_changes WHERE item_id = ? ORDER BY created_at, change_id", (item_id,))


# ---- coming back for review ---------------------------------------------------------------------

def due_for_review(db: Database, run_id: str, today: date) -> list[Any]:
    """Active use cases whose review date has passed."""
    return db.fetch_all("SELECT * FROM items WHERE run_id = ? AND stage IN ('approved', 'building', 'piloting', 'live') "
                        "AND review_due IS NOT NULL AND review_due <= ? ORDER BY review_due", (run_id, today.isoformat()))


def open_due_rereviews(db: Database, run_id: str, today: date, *, by: str = "the review schedule") -> list[str]:
    """Put each overdue use case back in front of the committee as a matter, once, citing its approval."""
    from govern.intake import submit_item
    opened = []
    for row in due_for_review(db, run_id, today):
        pending = db.fetch_one("SELECT 1 FROM items WHERE run_id = ? AND status IN ('submitted', 'in_review', 'recommended') "
                               "AND details LIKE ?", (run_id, f'%"rereview_of": "{row["item_id"]}"%'))
        if pending:
            continue
        details = _details(row)
        item_id = submit_item(
            db, run_id, kind="use_case", title=f"Re-review: {row['title']}", submitted_by=by, risk_tier=row["risk_tier"], today=today,
            description=(f"{row['title']} was approved and is {STAGE_WORDS.get(row['stage'], row['stage']).lower()}"
                         f"{', owned by ' + row['owner'] if row['owner'] else ''}. Its review was due {row['review_due']}. "
                         "Is it still doing what was approved, on the conditions set, and should it continue? "
                         "Approve to renew it for another period; reject to pause it until it is brought back."),
            details={"rereview_of": row["item_id"], "related_decisions": [display_id(row["item_id"])],
                     "stage": row["stage"], **({"accountable_owner": row["owner"]} if row["owner"] else {}),
                     **({k: v for k, v in details.items() if k in ("business_goal", "who_is_affected", "decides_or_advises", "data_involved")})})
        opened.append(item_id)
    return opened
