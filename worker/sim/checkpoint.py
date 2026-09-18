"""Checkpoints, rollback snapshots, and forks (SPEC 2.1, 11.3).

A dump holds every run-scoped row except API logs and control records, plus the policy repo's git sha.
Run-scoped ids start with "<run_id>/", so restoring into a new run remaps ids with a prefix replacement.
"""

from __future__ import annotations

import gzip
import json
from pathlib import Path
from typing import Any, Mapping

from sim import ids
from sim.db import Database, utc_now_iso
from sim.policy import PolicyRepo

# Insert order respects foreign keys; deletes run in reverse.
RUN_TABLES: tuple[str, ...] = (
    "sim_months", "agents", "agent_memories", "meetings", "messages", "positions", "votes", "decisions", "use_cases",
    "use_case_history", "policy_edits", "status_changes", "agenda_deferrals", "policy_versions", "engine_decisions", "engine_draws",
    "outcome_reports", "events", "inbox_items", "news_items", "exams", "findings", "board_memos", "coded_measures",
    "metrics",
)


def dump_run(db: Database, run_id: str, policy_repo: PolicyRepo | None) -> dict[str, Any]:
    tables = {}
    for table in RUN_TABLES:
        rows = [dict(r) for r in db.fetch_all(f"SELECT * FROM {table} WHERE run_id = ?", (run_id,))]
        if table == "agents":
            rows.sort(key=lambda r: (r["replaced_agent_id"] is not None, r["active_from"]))
        tables[table] = rows
    sha = policy_repo.head() if policy_repo and policy_repo.path.exists() else None
    return {"run_id": run_id, "git_sha": sha, "tables": tables}


def delete_run_rows(db: Database, run_id: str) -> None:
    for table in reversed(RUN_TABLES):
        db.execute(f"DELETE FROM {table} WHERE run_id = ?", (run_id,))


def _remap(value: Any, old: str, new: str) -> Any:
    if isinstance(value, str) and old != new:
        return value.replace(f"{old}/", f"{new}/")
    return value


def restore_rows(db: Database, dump: Mapping[str, Any], *, into_run_id: str | None = None) -> None:
    old = dump["run_id"]
    new = into_run_id or old
    for table in RUN_TABLES:
        for row in dump["tables"].get(table, []):
            db.insert(table, {k: (new if k == "run_id" else _remap(v, old, new)) for k, v in row.items()})


def rollback(db: Database, snapshot: Mapping[str, Any], policy_repo: PolicyRepo) -> None:
    """Return a run to a snapshot taken at the start of a month. LLM call logs are kept."""
    delete_run_rows(db, snapshot["run_id"])
    restore_rows(db, snapshot)
    if snapshot.get("git_sha"):
        policy_repo.reset_to(snapshot["git_sha"])


def write_checkpoint(db: Database, run_id: str, month: str, policy_repo: PolicyRepo, data_dir: Path,
                     uploader: Any | None = None) -> str:
    dump = dump_run(db, run_id, policy_repo)
    path = Path(data_dir) / "checkpoints" / run_id / f"{month}.json.gz"
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as handle:
        json.dump(dump, handle)
    uri = uploader.upload(path, f"checkpoints/{run_id}/{month}.json.gz") if uploader else str(path)
    db.execute("DELETE FROM checkpoints WHERE run_id = ? AND sim_month = ?", (run_id, month))
    db.insert("checkpoints", {"checkpoint_id": ids.scoped(run_id, "checkpoint", month), "run_id": run_id,
                              "sim_month": month, "uri": uri, "git_sha": dump["git_sha"], "created_at": utc_now_iso()})
    return uri


def snapshot_path(data_dir: Path, run_id: str, month: str) -> Path:
    return Path(data_dir) / "snapshots" / run_id / f"{month}.json.gz"


def write_snapshot(dump: Mapping[str, Any], path: Path) -> None:
    """Written before a month starts; its presence on the next start means the month was interrupted."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with gzip.open(tmp, "wt", encoding="utf-8") as handle:
        json.dump(dump, handle)
    tmp.replace(path)


def load_checkpoint(path: Path) -> dict[str, Any]:
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        return json.load(handle)


def fork_run(db: Database, *, parent_run_id: str, from_month: str, data_dir: Path, reason: str,
             inject_event: Mapping[str, Any] | None = None, source: str = "cli") -> str:
    from sim.calendar import add_months

    parent = db.fetch_one("SELECT * FROM runs WHERE run_id = ?", (parent_run_id,))
    if parent is None:
        raise ValueError(f"unknown run {parent_run_id}")
    row = db.fetch_one("SELECT uri FROM checkpoints WHERE run_id = ? AND sim_month = ?", (parent_run_id, from_month))
    if row is None:
        raise ValueError(f"no checkpoint for {parent_run_id} at {from_month}")
    local = Path(row["uri"])
    if not local.is_file():
        local = Path(data_dir) / "checkpoints" / parent_run_id / f"{from_month}.json.gz"
    dump = load_checkpoint(local)
    new_run_id = ids.new_run_id(parent["experiment_id"], parent["bank_id"], parent["replicate"]) + "-fork"
    db.insert("runs", {**dict(parent), "run_id": new_run_id, "parent_run_id": parent_run_id, "fork_month": from_month,
                       "current_month": from_month, "status": "paused", "started_at": utc_now_iso()})
    restore_rows(db, dump, into_run_id=new_run_id)
    parent_repo = PolicyRepo(Path(data_dir) / "policies" / parent_run_id / parent["bank_id"])
    if dump.get("git_sha"):
        parent_repo.clone_to(Path(data_dir) / "policies" / new_run_id / parent["bank_id"], dump["git_sha"])
    db.insert("interventions", {"intervention_id": ids.global_id(), "run_id": new_run_id, "sim_month": from_month,
                                "real_ts": utc_now_iso(), "kind": "fork",
                                "description": f"Forked from {parent_run_id} at {from_month}: {reason}", "source": source})
    if inject_event:
        inject(db, new_run_id, parent["bank_id"], add_months(from_month, 1), inject_event, reason, source)
    return new_run_id


def inject(db: Database, run_id: str, bank_id: str, month: str, event: Mapping[str, Any], reason: str, source: str) -> str:
    event_id = ids.unique(run_id, "event")
    db.insert("events", {"event_id": event_id, "run_id": run_id, "bank_id": bank_id, "sim_month": month,
                         "type": event["event_type"], "severity": event.get("severity", "medium"), "source": "injected",
                         "payload": {"notes": event.get("notes", "")}})
    db.insert("interventions", {"intervention_id": ids.global_id(), "run_id": run_id, "sim_month": month,
                                "real_ts": utc_now_iso(), "kind": "inject_event",
                                "description": f"{event['event_type']} ({event.get('severity', 'medium')}) for {month}: {reason}",
                                "source": source})
    return event_id
