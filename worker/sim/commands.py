"""Control commands from the dashboard or CLI (SPEC 10.1, 10.2 Control page, 11.3 kill switch)."""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Mapping

from sim import checkpoint, ids
from sim.db import Database, utc_now_iso

log = logging.getLogger(__name__)

KINDS = frozenset({"start", "pause", "resume", "stop", "advance", "inject_event", "fork", "set_spend_cap"})
TRANSITIONS = {"start": ({"created", "paused"}, "running"), "resume": ({"paused", "failed"}, "running"),
               "pause": ({"running", "created"}, "paused"), "stop": ({"created", "running", "paused", "failed"}, "stopped")}


def enqueue(db: Database, *, kind: str, run_id: str | None, reason: str, payload: Mapping[str, Any] | None = None,
            source: str = "cli") -> str:
    if kind not in KINDS:
        raise ValueError(f"unknown command {kind}")
    if len(reason.strip()) < 10:
        raise ValueError("every control action needs a reason of at least 10 characters")
    command_id = ids.global_id()
    db.insert("commands", {"command_id": command_id, "run_id": run_id, "kind": kind, "payload": dict(payload or {}),
                           "reason": reason, "status": "pending", "created_at": utc_now_iso()})
    db.insert("interventions", {"intervention_id": ids.global_id(), "run_id": run_id, "sim_month": None, "real_ts": utc_now_iso(),
                                "kind": f"command_{kind}", "description": f"{reason} {json.dumps(dict(payload or {}))}",
                                "source": source})
    return command_id


def stop_requested(db: Database, data_dir: Path) -> bool:
    """Kill switch: SIM_STOP=1, a STOP file in the data dir, or a pending stop command."""
    if os.environ.get("SIM_STOP") == "1" or (Path(data_dir) / "STOP").exists():
        return True
    return db.fetch_one("SELECT 1 FROM commands WHERE kind = 'stop' AND status = 'pending'") is not None


def _finish(db: Database, command_id: str, status: str, result: Any) -> None:
    db.update("commands", {"status": status, "result": result, "processed_at": utc_now_iso()},
              where={"command_id": command_id})


def process_pending(db: Database, orchestrator: Any, data_dir: Path) -> list[str]:
    """Apply pending commands in order. Returns ids processed. Advance commands run months synchronously."""
    processed = []
    for row in db.fetch_all("SELECT * FROM commands WHERE status = 'pending' ORDER BY created_at"):
        command = dict(row)
        payload = json.loads(command["payload"] or "{}")
        try:
            result = _apply(db, orchestrator, data_dir, command, payload)
            _finish(db, command["command_id"], "done", result)
        except Exception as error:  # noqa: BLE001 - failures are reported on the command row
            log.exception("command %s failed", command["command_id"])
            _finish(db, command["command_id"], "failed", {"error": f"{type(error).__name__}: {error}"})
        processed.append(command["command_id"])
    return processed


def _apply(db: Database, orchestrator: Any, data_dir: Path, command: Mapping[str, Any], payload: Mapping[str, Any]) -> Any:
    kind, run_id = command["kind"], command["run_id"]
    run = db.fetch_one("SELECT * FROM runs WHERE run_id = ?", (run_id,)) if run_id else None
    if run is None:
        raise ValueError(f"unknown run {run_id}")
    if kind in TRANSITIONS:
        allowed, target = TRANSITIONS[kind]
        if run["status"] not in allowed:
            raise ValueError(f"cannot {kind} a run that is {run['status']}")
        db.update("runs", {"status": target}, where={"run_id": run_id})
        if kind == "stop" and run["current_month"]:
            ctx = orchestrator.context(run_id)
            checkpoint.write_checkpoint(db, run_id, run["current_month"], ctx.policy_repo, data_dir, orchestrator.uploader)
        return {"status": target}
    if kind == "advance":
        if run["status"] == "stopped":
            raise ValueError("cannot advance a stopped run")
        months = max(1, min(12, int(payload.get("months", 1))))
        return {"completed": [orchestrator.advance(run_id) for _ in range(months)]}
    if kind == "inject_event":
        month = orchestrator.next_month(run_id)
        event_id = checkpoint.inject(db, run_id, run["bank_id"], month, payload, command["reason"], "dashboard")
        return {"event_id": event_id, "sim_month": month}
    if kind == "fork":
        inject = payload.get("inject_event")
        new_run = checkpoint.fork_run(db, parent_run_id=run_id, from_month=payload["from_month"], data_dir=data_dir,
                                      reason=command["reason"], inject_event=inject, source="dashboard")
        return {"run_id": new_run}
    if kind == "set_spend_cap":
        cap = float(payload["usd_per_sim_month"])
        if cap <= 0:
            raise ValueError("spend cap must be positive")
        db.update("runs", {"spend_cap_usd_per_month": cap}, where={"run_id": run_id})
        return {"spend_cap_usd_per_month": cap}
    raise ValueError(f"unsupported command {kind}")
