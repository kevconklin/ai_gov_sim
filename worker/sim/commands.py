"""Control commands from the dashboard or CLI (SPEC 10.1, 10.2 Control page, 11.3 kill switch)."""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Mapping

from govern import ids

from sim import checkpoint
from govern.db import Database, utc_now_iso

log = logging.getLogger(__name__)

KINDS = frozenset({"start", "pause", "resume", "stop", "advance", "inject_event", "fork", "set_spend_cap",
                   "candidates", "convene", "attest", "submit", "set_brief",
                   "create_workspace", "update_profile", "add_document", "retire_document", "set_panel",
                   "add_seat", "remove_seat", "update_seat"})
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
        # Claim it first. Two workers can both see a command as pending; only the one whose
        # update lands may run it, or a review could be convened twice and paid for twice.
        if not db.update("commands", {"status": "processing"},
                         where={"command_id": command["command_id"], "status": "pending"}):
            continue
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
    if kind == "create_workspace":          # the one command with no run yet: it makes one
        from govern.workspace import create_workspace
        from sim.world import REPO_ROOT
        new_run = create_workspace(db, orchestrator.config, config_dir=REPO_ROOT / "config", data_dir=data_dir,
                                   name=payload["name"], risk_appetite=payload["risk_appetite"],
                                   facts=payload.get("facts", ""), actor=payload.get("actor", "unknown"),
                                   source=payload.get("source", "unknown"), profile=payload)
        return {"run_id": new_run}
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
        from govern.settings import record_change
        record_change(db, run_id, actor=payload.get("actor", "unknown"), source=payload.get("source", "unknown"),
                      area="budget", target="monthly spend cap (USD)", before=str(run["spend_cap_usd_per_month"]),
                      after=str(cap), reason=command["reason"])
        return {"spend_cap_usd_per_month": cap}
    if kind in ("candidates", "convene", "attest", "submit", "set_brief", "update_profile", "add_document",
                "retire_document", "set_panel", "add_seat", "remove_seat", "update_seat"):
        return _governance(db, orchestrator, command, payload, run)
    raise ValueError(f"unsupported command {kind}")


def _governance(db: Database, orchestrator: Any, command: Mapping[str, Any], payload: Mapping[str, Any],
                run: Mapping[str, Any]) -> Any:
    """The human loop: rank candidates, convene on a set agenda, attest to what carried.

    Nothing here applies a decision on its own. 'attest' does so only when asked, and only
    once every item in that meeting has a person on record for it.
    """
    from datetime import date

    from govern.agenda import candidates
    from govern.attestation import apply_meeting, record_attestation
    from govern.config import load_agenda_priority, load_attestation
    from govern.packet import AgendaItem
    from sim.world import REPO_ROOT

    kind, run_id = command["kind"], command["run_id"]
    config_dir = REPO_ROOT / "config"

    if kind == "candidates":
        ranked = candidates(db, run_id, load_agenda_priority(config_dir),
                            today=payload.get("today") or date.today().isoformat())
        return {"candidates": [{"kind": c.kind, "ref_id": c.ref_id, "title": c.title, "priority": c.priority,
                                "reasons": list(c.reasons), "deferrals": c.deferral_count,
                                "escalated": c.escalated} for c in ranked]}

    if kind == "submit":
        from govern.intake import submit_item
        item_id = submit_item(db, run_id, kind=payload["kind"], title=payload["title"],
                              description=payload["description"], submitted_by=payload["submitted_by"],
                              risk_tier=payload.get("risk_tier"), details=payload.get("details"))
        return {"item_id": item_id}

    who = {"actor": payload.get("actor", "unknown"), "source": payload.get("source", "unknown")}
    why = payload.get("why") or command["reason"]

    if kind == "set_brief":
        from govern.committee import set_brief
        set_brief(db, run_id, payload["seat"], payload["brief"], reason=why, **who)
        return {"seat": payload["seat"]}

    if kind in ("add_seat", "remove_seat", "update_seat"):
        from govern import committee
        from govern.providers import Registry, load_providers
        registry, models = Registry(load_providers(config_dir)), orchestrator.config.models
        if kind == "add_seat":
            return {"agent_id": committee.add_seat(
                db, run_id, seat=payload["seat"], title=payload["title"], name=payload.get("name") or payload["title"],
                brief=payload["brief"], stance_baseline=float(payload.get("stance_baseline", 3.0)),
                model=payload.get("model") or None, models=models, registry=registry, reason=why, **who)}
        if kind == "remove_seat":
            committee.remove_seat(db, run_id, payload["seat"], reason=why, **who)
            return {"removed": payload["seat"]}
        return {"changed": committee.update_seat(db, run_id, payload["seat"], payload["changes"], models=models,
                                                 registry=registry, reason=why, **who)}

    if kind in ("update_profile", "add_document", "retire_document", "set_panel"):
        from govern import settings
        if kind == "update_profile":
            return {"changed": settings.update_profile(db, run_id, payload["changes"], reason=why, **who)}
        if kind == "add_document":
            return {"document_id": settings.add_document(db, run_id, kind=payload["kind"], title=payload["title"],
                                                         body=payload["body"], reason=why, **who)}
        if kind == "retire_document":
            settings.retire_document(db, run_id, payload["document_id"], reason=why, **who)
            return {"retired": payload["document_id"]}
        settings.set_panel(db, run_id, kind=payload["kind"], seats=payload["seats"], config_dir=config_dir,
                           risk_tier=payload.get("risk_tier", "*"), reason=why, **who)
        return {"panel": payload["kind"]}

    if kind == "convene":
        items = [AgendaItem(i["item_id"], i["kind"], i["title"], i.get("ref_id")) for i in payload.get("agenda", [])]
        items += [AgendaItem(f"ADV-{n:03d}", "advisory", q)
                  for n, q in enumerate(payload.get("advisory", []), start=len(items) + 1)]
        if not items:
            raise ValueError("convene needs an agenda: pass 'agenda' items, 'advisory' questions, or both")
        result = orchestrator.convene(run_id, agenda=items, month=payload.get("month"))
        return {"meeting_id": result.meeting_id, "date": result.meeting_date.isoformat(),
                "recommendations": [{"decision_id": d.decision_id, "item_id": d.item.item_id,
                                     "recommended": d.outcome, "yes": d.tally.yes, "no": d.tally.no,
                                     "abstain": d.tally.abstain} for d in result.decisions]}

    attested = record_attestation(db, run_id, decision_id=payload["decision_id"], actor=payload["actor"],
                                  outcome=payload["outcome"], rationale=payload.get("rationale", ""),
                                  responded_to=payload.get("responded_to", ()),
                                  source=payload.get("source", "unknown"),
                                  config=load_attestation(config_dir))
    out: dict[str, Any] = {"attestation_id": attested.attestation_id, "outcome": attested.outcome}
    if payload.get("apply"):
        meeting = db.fetch_one("SELECT meeting_id, sim_month, meeting_date FROM meetings WHERE meeting_id = "
                               "(SELECT meeting_id FROM decisions WHERE decision_id = ?)", (payload["decision_id"],))
        # A review takes effect when its last matter is signed. Signing an earlier one is not a
        # failure, so it is reported as waiting rather than raised: the person did the right thing.
        from govern.attestation import AttestationRequired
        try:
            out["problems"] = apply_meeting(orchestrator.context(run_id), meeting["meeting_id"],
                                            month=meeting["sim_month"],
                                            meeting_date=date.fromisoformat(meeting["meeting_date"]))
            out["applied"] = meeting["meeting_id"]
        except AttestationRequired as waiting:
            out["applied"] = None
            out["waiting_on"] = str(waiting)
    return out
