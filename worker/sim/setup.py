"""Create experiments and paired runs (SPEC 2)."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Sequence

from sim import ids
from sim.calendar import add_months, day_in_month
from sim.config import Config
from sim.db import Database, utc_now_iso
from sim.engine.rng import derive_seed
from sim.engine.state import initial_state
from sim.policy import PolicyRepo
from sim.prompts import PROMPTS_DIR
from sim.world import World


def prompts_hash() -> str:
    digest = hashlib.sha256()
    for path in sorted(PROMPTS_DIR.rglob("*")):
        if path.is_file() and path.suffix in (".md", ".yaml"):
            digest.update(path.read_bytes())
    return digest.hexdigest()[:16]


def create_experiment(db: Database, world: World, config: Config, *, name: str, replicates: int, seed: int,
                      data_dir: Path, banks: Sequence[str] | None = None, notes: str = "") -> list[str]:
    experiment_id = f"{name}-{ids.global_id()[:6]}"
    db.insert("experiments", {"experiment_id": experiment_id, "name": name, "notes": notes, "created_at": utc_now_iso()})
    config_hash = f"{world.config_hash()}-{prompts_hash()}"
    run_ids = []
    for replicate in range(1, replicates + 1):
        replicate_seed = derive_seed(seed, "replicate", replicate) % 2_000_000_000
        for bank_id in banks or list(world.banks):
            run_ids.append(_create_run(db, world, config, experiment_id=experiment_id, bank_id=bank_id,
                                       replicate=replicate, seed=replicate_seed, config_hash=config_hash,
                                       data_dir=data_dir))
    return run_ids


def _create_run(db: Database, world: World, config: Config, *, experiment_id: str, bank_id: str, replicate: int,
                seed: int, config_hash: str, data_dir: Path) -> str:
    bank = world.banks[bank_id]
    run_id = ids.new_run_id(experiment_id, bank_id, replicate)
    start = world.start_month
    db.insert("runs", {
        "run_id": run_id, "experiment_id": experiment_id, "bank_id": bank_id, "condition": bank.condition,
        "replicate": replicate, "seed": seed, "model_versions": dict(config.models.roles), "config_hash": config_hash,
        "start_month": start, "current_month": None, "status": "created",
        "spend_cap_usd_per_month": float(config.budget.raw["spend_caps_usd"]["per_bank_per_sim_month"]),
        "started_at": utc_now_iso(),
    })
    for seat in world.seats:
        persona = world.persona(bank_id, seat)
        db.insert("agents", {"agent_id": ids.scoped(run_id, "agent", seat, start), "run_id": run_id, "bank_id": bank_id,
                             "seat": seat, "name": persona.name, "title": persona.title, "persona_file": persona.path,
                             "active_from": start, "active_to": None, "stance_baseline": persona.stance_baseline})
    baseline_month = add_months(start, -1)
    state = initial_state(world.bank_profile, baseline_month)
    db.insert("sim_months", {"run_id": run_id, "bank_id": bank_id, "sim_month": baseline_month,
                             "company_state": state.model_dump_json(), "completed_at": utc_now_iso()})
    domain = world.bank_universe(bank_id).get("domain", "example.com")
    PolicyRepo(Path(data_dir) / "policies" / run_id / bank_id).init(bank.name, f"ai-committee@{domain}",
                                                                   day_in_month(baseline_month, 28))
    db.insert("interventions", {"intervention_id": ids.global_id(), "run_id": run_id, "sim_month": None,
                                "real_ts": utc_now_iso(), "kind": "run_created",
                                "description": f"Created with seed {seed}, config {config_hash}", "source": "cli"})
    return run_id
