"""The committee as data: who sits, and the brief each member is given."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

import yaml

from govern import ids
from govern.config import ConfigError
from govern.db import Database, utc_now_iso


def load_default_committee(config_dir: Path) -> Mapping[str, Mapping[str, Any]]:
    path = Path(config_dir) / "committee" / "seats.yaml"
    if not path.is_file():
        raise ConfigError(f"missing config file: committee/seats.yaml (looked in {config_dir})")
    seats = (yaml.safe_load(path.read_text()) or {}).get("seats") or {}
    if sum(bool(s.get("chair")) for s in seats.values()) != 1:
        raise ConfigError("committee/seats.yaml must mark exactly one chair seat")
    for seat_id, seat in seats.items():
        for key in ("title", "name", "brief"):
            if not str(seat.get(key, "")).strip():
                raise ConfigError(f"committee/seats.yaml seat {seat_id!r} is missing {key!r}")
    return seats


def seats(db: Database, run_id: str) -> list[Mapping[str, Any]]:
    return db.fetch_all("SELECT agent_id, seat, name, title, persona_text, stance_baseline, model FROM agents "
                        "WHERE run_id = ? AND active_to IS NULL ORDER BY seat", (run_id,))


def set_brief(db: Database, run_id: str, seat: str, brief: str, *, reason: str, source: str = "cli",
              actor: str = "unknown") -> None:
    """Rewrite one member's brief.

    This changes what a member is told and therefore how it argues, so it is logged as an
    intervention like any other change to prompts: a review held after the edit is not
    comparable to one held before it, and the record has to show where the line falls.
    """
    if len(brief.strip()) < 40:
        raise ValueError("a brief needs enough to argue from: say what the seat answers for and what it looks at")
    if len(reason.strip()) < 10:
        raise ValueError("changing a brief needs a reason of at least 10 characters")
    from govern.settings import record_change
    current = db.fetch_one("SELECT persona_text FROM agents WHERE run_id = ? AND seat = ? AND active_to IS NULL", (run_id, seat))
    if current is None:
        raise ValueError(f"no seat {seat!r} in {run_id}")
    db.update("agents", {"persona_text": brief.strip()}, where={"run_id": run_id, "seat": seat})
    record_change(db, run_id, actor=actor, source=source, area="brief", target=seat,
                  before=current["persona_text"], after=brief.strip(), reason=reason.strip())
    db.insert("interventions", {"intervention_id": ids.global_id(), "run_id": run_id, "sim_month": None,
                                "real_ts": utc_now_iso(), "kind": "prompt_edit",
                                "description": f"brief for seat {seat} rewritten: {reason.strip()}", "source": source})


# ---- shaping the committee --------------------------------------------------

SEAT_FIELDS = ("title", "name", "stance_baseline", "model")


def _why(reason: str) -> str:
    if len(reason.strip()) < 10:
        raise ValueError("changing the committee needs a reason of at least 10 characters")
    return reason.strip()


def _check_model(model: str | None, models: Any, registry: Any) -> str | None:
    """A seat's model must be one the platform prices, on a provider this worker can reach.
    Unpriced spend could not be capped, and an unreachable model would fail the seat mid-review."""
    if not model:
        return None
    if model not in {m.id for m in models.catalog}:
        raise ValueError(f"{model} is not a model on offer; add it to config/models.yaml with a price first")
    if not registry.available(model):
        from govern.providers import split_model
        spec = registry.spec(split_model(model)[0])
        raise ValueError(f"{model} needs {spec.api_key_env}, which is not set on the worker")
    return model


def _order(db: Database, run_id: str) -> tuple[list[str], str]:
    import json
    row = db.fetch_one("SELECT seats, chair_seat FROM org_profiles WHERE run_id = ?", (run_id,))
    if row is None:
        raise ValueError(f"{run_id} has no committee that can be changed here")
    return list(json.loads(row["seats"])), row["chair_seat"]


def add_seat(db: Database, run_id: str, *, seat: str, title: str, name: str, brief: str, models: Any, registry: Any,
             reason: str, actor: str, source: str = "cli_asserted", stance_baseline: float = 3.0,
             model: str | None = None) -> str:
    """Seat a new adviser. It speaks last; a removed seat can be added back under the same id."""
    import re
    from govern.settings import record_change
    why = _why(reason)
    seat = seat.strip().lower()
    if not re.fullmatch(r"[a-z][a-z0-9_]{1,39}", seat):
        raise ValueError("a seat id is lowercase letters, digits and underscores, such as clinical or data_protection")
    if len(brief.strip()) < 40:
        raise ValueError("a brief needs enough to argue from: say what the seat answers for and what it looks at")
    if len(title.strip()) < 2 or not name.strip():
        raise ValueError("a seat needs a title and a short name")
    if not 1 <= float(stance_baseline) <= 5:
        raise ValueError("stance runs from 1 (very cautious) to 5 (very keen)")
    order, _ = _order(db, run_id)
    if seat in order:
        raise ValueError(f"there is already a {seat} seat")
    chosen = _check_model(model, models, registry)
    run = db.fetch_one("SELECT bank_id FROM runs WHERE run_id = ?", (run_id,))
    taken = db.fetch_one("SELECT COUNT(*) AS n FROM agents WHERE run_id = ? AND seat = ?", (run_id, seat))["n"]
    agent_id = ids.scoped(run_id, "agent", seat) if not taken else ids.scoped(run_id, "agent", seat, taken + 1)
    db.insert("agents", {"agent_id": agent_id, "run_id": run_id, "bank_id": run["bank_id"], "seat": seat,
                         "name": name.strip(), "title": title.strip(), "persona_file": "", "persona_text": brief.strip(),
                         "active_from": utc_now_iso()[:7], "active_to": None, "stance_baseline": float(stance_baseline),
                         "model": chosen})
    db.update("org_profiles", {"seats": [*order, seat]}, where={"run_id": run_id})
    record_change(db, run_id, actor=actor, source=source, area="committee", target=f"{seat} added", before=None,
                  after=f"{title.strip()}" + (f" on {chosen}" if chosen else ""), reason=why)
    return agent_id


def remove_seat(db: Database, run_id: str, seat: str, *, reason: str, actor: str, source: str = "cli_asserted") -> None:
    """Stand an adviser down. The seat's row is kept, closed, so past reviews still name who sat."""
    from govern.settings import record_change
    why = _why(reason)
    order, chair = _order(db, run_id)
    if seat not in order:
        raise ValueError(f"no {seat} seat on this committee")
    if seat == chair:
        raise ValueError("the chair cannot be removed: it opens and closes discussion, breaks ties, and writes the minutes")
    if len(order) <= 2:
        raise ValueError("a committee needs at least two seats, or there is nobody to disagree")
    current = db.fetch_one("SELECT title FROM agents WHERE run_id = ? AND seat = ? AND active_to IS NULL", (run_id, seat))
    db.execute("UPDATE agents SET active_to = ? WHERE run_id = ? AND seat = ? AND active_to IS NULL",
               (utc_now_iso()[:7], run_id, seat))
    db.update("org_profiles", {"seats": [s for s in order if s != seat]}, where={"run_id": run_id})
    record_change(db, run_id, actor=actor, source=source, area="committee", target=f"{seat} removed",
                  before=current["title"] if current else seat, after=None, reason=why)


def update_seat(db: Database, run_id: str, seat: str, changes: Mapping[str, Any], *, models: Any, registry: Any,
                reason: str, actor: str, source: str = "cli_asserted") -> list[str]:
    """Change a seat's title, short name, leaning, or model. One record per field that changed."""
    from govern.settings import record_change
    why = _why(reason)
    unknown = sorted(set(changes) - set(SEAT_FIELDS))
    if unknown:
        raise ValueError(f"{', '.join(unknown)} cannot be changed here")
    current = db.fetch_one("SELECT title, name, stance_baseline, model FROM agents WHERE run_id = ? AND seat = ? "
                           "AND active_to IS NULL", (run_id, seat))
    if current is None:
        raise ValueError(f"no {seat} seat on this committee")
    cleaned: dict[str, Any] = {}
    for key, value in changes.items():
        if key == "model":
            cleaned[key] = _check_model(str(value).strip() or None, models, registry)
        elif key == "stance_baseline":
            if not 1 <= float(value) <= 5:
                raise ValueError("stance runs from 1 (very cautious) to 5 (very keen)")
            cleaned[key] = float(value)
        else:
            if not str(value).strip():
                raise ValueError(f"{key} cannot be empty")
            cleaned[key] = str(value).strip()
    changed = [k for k, v in cleaned.items() if current[k] != v]
    for key in changed:
        before, after = current[key], cleaned[key]
        record_change(db, run_id, actor=actor, source=source, area="committee", target=f"{seat}: {key}",
                      before=None if before is None else str(before), after=None if after is None else str(after), reason=why)
    if changed:
        db.execute("UPDATE agents SET " + ", ".join(f"{k} = ?" for k in changed) + " WHERE run_id = ? AND seat = ? AND active_to IS NULL",
                   (*[cleaned[k] for k in changed], run_id, seat))
    return changed
