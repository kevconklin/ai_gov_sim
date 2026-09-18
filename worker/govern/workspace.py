"""A workspace: one organisation's committee, with no simulation behind it.

It reuses the run as its scope, so every run-scoped table, id convention, checkpoint and audit
record works unchanged. What makes it a workspace is that it has an organisation profile, its
committee's briefs are stored rather than read from files, and its status is one the simulation's
clock never advances.
"""

from __future__ import annotations

import re
from datetime import date
from pathlib import Path
from typing import Any, Mapping

from govern import ids
from govern.committee import load_default_committee
from govern.config import Config
from govern.db import Database, utc_now_iso
from govern.policy import PolicyRepo

WORKSPACE = "workspace"          # runs.condition and runs.status; `serve` only advances 'running'


def is_workspace(run: Mapping[str, Any]) -> bool:
    return run["condition"] == WORKSPACE


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")[:40] or "org"


def create_workspace(db: Database, config: Config, *, config_dir: Path, data_dir: Path, name: str,
                     risk_appetite: str, facts: str = "", today: date | None = None,
                     committee: Mapping[str, Mapping[str, Any]] | None = None, source: str = "cli") -> str:
    if len(name.strip()) < 2:
        raise ValueError("a workspace needs the organisation's name")
    if len(risk_appetite.strip()) < 20:
        raise ValueError("a workspace needs the board's direction on AI: the committee argues from it")
    today = today or date.today()
    month = today.isoformat()[:7]
    seats = committee or load_default_committee(config_dir)
    slug = _slug(name)
    experiment_id = f"{slug}-{ids.global_id()[:6]}"
    run_id = ids.new_run_id(experiment_id, slug, 1)
    db.insert("experiments", {"experiment_id": experiment_id, "name": name.strip(),
                              "notes": "workspace", "created_at": utc_now_iso()})
    db.insert("runs", {
        "run_id": run_id, "experiment_id": experiment_id, "bank_id": slug, "condition": WORKSPACE, "replicate": 1,
        "seed": 0, "model_versions": dict(config.models.roles), "config_hash": "workspace", "start_month": month,
        "current_month": None, "status": WORKSPACE,
        "spend_cap_usd_per_month": float(config.budget.raw["spend_caps_usd"]["per_bank_per_sim_month"]),
        "started_at": utc_now_iso(),
    })
    db.insert("org_profiles", {
        "run_id": run_id, "name": name.strip(), "risk_appetite": risk_appetite.strip(),
        "facts": facts.strip() or f"{name.strip()} has not yet described itself to the committee.",
        "seats": list(seats), "chair_seat": next(s for s, v in seats.items() if v.get("chair")),
        "created_at": utc_now_iso(),
    })
    for seat_id, seat in seats.items():
        db.insert("agents", {"agent_id": ids.scoped(run_id, "agent", seat_id), "run_id": run_id, "bank_id": slug,
                             "seat": seat_id, "name": seat["name"], "title": seat["title"],
                             "persona_file": "", "persona_text": str(seat["brief"]).strip(),
                             "active_from": month, "active_to": None, "stance_baseline": float(seat.get("stance", 3.0))})
    PolicyRepo(Path(data_dir) / "policies" / run_id / slug).init(name.strip(), "ai-governance@workspace.invalid", today)
    db.insert("interventions", {"intervention_id": ids.global_id(), "run_id": run_id, "sim_month": None,
                                "real_ts": utc_now_iso(), "kind": "workspace_created",
                                "description": f"Workspace for {name.strip()} with {len(seats)} seats", "source": source})
    return run_id
