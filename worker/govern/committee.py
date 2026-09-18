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
    return db.fetch_all("SELECT agent_id, seat, name, title, persona_text, stance_baseline FROM agents "
                        "WHERE run_id = ? AND active_to IS NULL ORDER BY seat", (run_id,))


def set_brief(db: Database, run_id: str, seat: str, brief: str, *, reason: str, source: str = "cli") -> None:
    """Rewrite one member's brief.

    This changes what a member is told and therefore how it argues, so it is logged as an
    intervention like any other change to prompts: a review held after the edit is not
    comparable to one held before it, and the record has to show where the line falls.
    """
    if len(brief.strip()) < 40:
        raise ValueError("a brief needs enough to argue from: say what the seat answers for and what it looks at")
    if len(reason.strip()) < 10:
        raise ValueError("changing a brief needs a reason of at least 10 characters")
    if not db.update("agents", {"persona_text": brief.strip()}, where={"run_id": run_id, "seat": seat}):
        raise ValueError(f"no seat {seat!r} in {run_id}")
    db.insert("interventions", {"intervention_id": ids.global_id(), "run_id": run_id, "sim_month": None,
                                "real_ts": utc_now_iso(), "kind": "prompt_edit",
                                "description": f"brief for seat {seat} rewritten: {reason.strip()}", "source": source})
