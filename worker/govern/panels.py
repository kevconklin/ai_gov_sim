"""Panels: the members convened for one agenda.

A committee is a set of targeted advisers, and a review should seat the ones whose lens the
matter needs. The whole committee sits for anything high tier, for use cases, and for questions;
narrower matters get a narrower panel. The chair always sits.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Mapping, Sequence

import yaml

from govern.config import ConfigError
from govern.context import OrgProfile
from govern.db import Database

ALL = "all"


def load_panels(config_dir: Path) -> Mapping[str, Any]:
    path = Path(config_dir) / "panels.yaml"
    if not path.is_file():
        raise ConfigError(f"missing config file: panels.yaml (looked in {config_dir})")
    data = yaml.safe_load(path.read_text()) or {}
    if "rules" not in data:
        raise ConfigError("panels.yaml is missing required key 'rules'")
    return data


def _override(db: Database, run_id: str, kind: str, tier: str | None) -> list[str] | None:
    for wanted in (tier or "*", "*"):
        row = db.fetch_one("SELECT seats FROM panel_rules WHERE run_id = ? AND kind = ? AND risk_tier = ?",
                           (run_id, kind, wanted))
        if row:
            return json.loads(row["seats"])
    return None


def set_panel_rule(db: Database, run_id: str, *, kind: str, seats: Sequence[str], risk_tier: str = "*") -> None:
    db.upsert("panel_rules", {"run_id": run_id, "kind": kind, "risk_tier": risk_tier, "seats": list(seats)},
              key=("run_id", "kind", "risk_tier"))


def panel_for(db: Database, run_id: str, matters: Sequence[tuple[str, str | None]], *, org: OrgProfile,
              rules: Mapping[str, Any]) -> tuple[str, ...]:
    """Seats to convene for `matters`, each an (intake kind, risk tier), in the committee's speaking order.

    A kind with no rule gets the whole committee: seating too many costs money, seating too few
    costs the objection nobody was there to raise.
    """
    full_tiers = set(rules.get("full_committee_tiers", ()))
    wanted: set[str] = {org.chair_seat}
    for kind, tier in matters:
        seats = _override(db, run_id, kind, tier)
        if seats is None:
            if tier in full_tiers:
                return org.seats
            seats = rules["rules"].get(kind, ALL)
        if seats == ALL:
            return org.seats
        wanted |= set(seats)
    if not matters:
        return org.seats
    return tuple(s for s in org.seats if s in wanted)
