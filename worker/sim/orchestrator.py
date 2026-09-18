"""The monthly cycle (SPEC 5). A month either completes fully or is rolled back to its starting snapshot."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Sequence

from sim import board, checkpoint, coding, events, regulator
from sim.alerts import raise_alert
from sim.budget import bank_under_cap, check_hard_cap
from sim.calendar import add_months, month_index
from sim.config import Config
from sim.context import RunContext
from sim.db import Database, utc_now_iso
from sim.engine.resolve import load_state, run_engine_month, write_report
from sim.llm import LLMClient, StopRequested
from sim.locks import run_lock
from sim.meeting import Meeting, MeetingResult
from sim.packet import AgendaItem
from sim.metrics import compute_month
from sim.world import World

log = logging.getLogger(__name__)


class RunNotActive(RuntimeError):
    pass


@dataclass
class Orchestrator:
    db: Database
    world: World
    config: Config
    llm: LLMClient
    data_dir: Path
    uploader: Any | None = None
    on_month_complete: Callable[[str, str], None] | None = None

    def context(self, run_id: str) -> RunContext:
        row = self.db.fetch_one("SELECT * FROM runs WHERE run_id = ?", (run_id,))
        if row is None:
            raise ValueError(f"unknown run {run_id}")
        run = dict(row)
        return RunContext(db=self.db, llm=self.llm, world=self.world, config=self.config, run=run, data_dir=self.data_dir,
                          budget_ok=lambda month: bank_under_cap(self.db, run, month, self.config))

    def next_month(self, run_id: str) -> str:
        run = self.db.fetch_one("SELECT start_month, current_month FROM runs WHERE run_id = ?", (run_id,))
        return add_months(run["current_month"], 1) if run["current_month"] else run["start_month"]

    def advance(self, run_id: str) -> str:
        """Advance one run by one month. Held under a per-run lock so workers cannot overlap."""
        with run_lock(self.data_dir, run_id):
            return self._advance_locked(run_id)

    def _advance_locked(self, run_id: str) -> str:
        if check_hard_cap(self.db, self.config):
            self._set_status(run_id, "paused", "hard monthly spend cap reached", source="worker")
            raise RunNotActive("hard monthly spend cap reached")
        ctx = self.context(run_id)
        self._check_pinned_models(ctx)
        month = self.next_month(run_id)
        self._recover_interrupted(ctx, month)
        started = time.monotonic()
        snapshot = checkpoint.dump_run(self.db, run_id, ctx.policy_repo)
        snapshot_file = checkpoint.snapshot_path(self.data_dir, run_id, month)
        checkpoint.write_snapshot(snapshot, snapshot_file)
        try:
            self._run_month(ctx, month)
        except StopRequested:
            checkpoint.rollback(self.db, snapshot, ctx.policy_repo)
            self._set_status(run_id, "paused", f"stopped during {month}; month rolled back", source="worker")
            raise
        except Exception as error:
            checkpoint.rollback(self.db, snapshot, ctx.policy_repo)
            self._set_status(run_id, "failed", f"{month} failed and was rolled back: {type(error).__name__}: {error}",
                             source="worker")
            raise_alert(self.db, "worker_error", "critical", f"{run_id} {month}: {type(error).__name__}: {error}",
                        run_id=run_id, sim_month=month)
            raise
        self.db.update("sim_months", {"wall_clock_seconds": time.monotonic() - started, "completed_at": utc_now_iso()},
                       where={"run_id": run_id, "sim_month": month})
        self.db.update("runs", {"current_month": month}, where={"run_id": run_id})
        snapshot_file.unlink(missing_ok=True)
        if month_index(ctx.run["start_month"], month) % 3 == 0:
            checkpoint.write_checkpoint(self.db, run_id, month, ctx.policy_repo, self.data_dir, self.uploader)
        if self.on_month_complete:
            self.on_month_complete(run_id, month)
        return month

    def convene(self, run_id: str, *, agenda: Sequence[AgendaItem], month: str | None = None) -> MeetingResult:
        """Hold a meeting a human called, on the agenda they set.

        Nothing the committee recommends applies here: the decisions come back for attestation,
        and sim.attestation.apply_attested is what makes them real.
        """
        with run_lock(self.data_dir, run_id):
            ctx = self.context(run_id)
            self._check_pinned_models(ctx)
            run = self.db.fetch_one("SELECT current_month, start_month FROM runs WHERE run_id = ?", (run_id,))
            return Meeting(ctx, month or run["current_month"] or run["start_month"], agenda=agenda).hold()

    def _recover_interrupted(self, ctx: RunContext, month: str) -> None:
        """A snapshot left on disk means a process died mid-month (e.g. killed). Restore it before retrying."""
        path = checkpoint.snapshot_path(self.data_dir, ctx.run_id, month)
        if not path.is_file():
            return
        checkpoint.rollback(self.db, checkpoint.load_checkpoint(path), ctx.policy_repo)
        for batch in self.db.fetch_all("SELECT batch_id FROM llm_batches WHERE run_id = ? AND status = 'submitted'",
                                       (ctx.run_id,)):
            try:
                self.llm.collect_batch(batch["batch_id"])      # log the orphaned batch's cost; results are not reused
            except Exception as error:  # noqa: BLE001 - recovery continues; the batch stays submitted
                log.warning("could not collect orphaned batch %s: %s", batch["batch_id"], error)
        from sim import ids
        self.db.insert("interventions", {"intervention_id": ids.global_id(), "run_id": ctx.run_id, "sim_month": month,
                                         "real_ts": utc_now_iso(), "kind": "recovered_interrupted_month",
                                         "description": f"{month} was interrupted; restored its starting snapshot and retried",
                                         "source": "worker"})
        path.unlink()

    def _check_pinned_models(self, ctx: RunContext) -> None:
        """Runs keep their pinned models. A differing config/models.yaml is flagged once, never silently applied."""
        import json as _json
        pinned = ctx.run["model_versions"]
        pinned = _json.loads(pinned) if isinstance(pinned, str) else pinned
        current = dict(self.config.models.roles)
        if pinned == current:
            return
        key = f"{ctx.run_id}:{_json.dumps(current, sort_keys=True)}"
        if raise_alert(self.db, "model_config_mismatch", "warning",
                       f"{ctx.run_id} keeps pinned models {pinned}; config/models.yaml now says {current}",
                       run_id=ctx.run_id, dedupe_key=key):
            from sim import ids
            self.db.insert("interventions", {"intervention_id": ids.global_id(), "run_id": ctx.run_id,
                                             "sim_month": ctx.run["current_month"], "real_ts": utc_now_iso(),
                                             "kind": "model_config_mismatch",
                                             "description": f"Pinned {pinned}; config now {current}. Pinned models kept.",
                                             "source": "worker"})

    def _run_month(self, ctx: RunContext, month: str) -> None:
        prior = load_state(ctx, add_months(month, -1))
        if prior is None:
            raise RuntimeError(f"no company state before {month} for {ctx.run_id}")
        prior = events.budget_cycle(ctx, month, prior)
        world_events = events.resolve_world_events(ctx, month, prior)                  # 1
        exam = regulator.exam_due(ctx, month, prior, world_events)
        if exam:
            regulator.conduct_exam(ctx, month, prior, *exam)
        board.board_step(ctx, month)
        result = Meeting(ctx, month).hold()                                               # 2-7, 9
        incidents = tuple((e.event_id, e.severity or "medium", e.payload.get("use_case_id"))
                          for e in world_events if e.type in ("data_leak", "model_error"))
        state = run_engine_month(ctx, result.decisions, month=month, prior=prior, world_incidents=incidents)  # 8
        self.db.insert("sim_months", {"run_id": ctx.run_id, "bank_id": ctx.run["bank_id"], "sim_month": month,
                                      "company_state": state.model_dump_json()})
        write_report(ctx, month=month, new_state=state)
        coding.code_month(ctx, month)                                                     # 10
        compute_month(ctx, month)

    def _set_status(self, run_id: str, status: str, reason: str, *, source: str) -> None:
        run = self.db.fetch_one("SELECT current_month FROM runs WHERE run_id = ?", (run_id,))
        self.db.update("runs", {"status": status}, where={"run_id": run_id})
        from sim import ids
        self.db.insert("interventions", {"intervention_id": ids.global_id(), "run_id": run_id,
                                         "sim_month": run["current_month"] if run else None, "real_ts": utc_now_iso(),
                                         "kind": f"status_{status}", "description": reason, "source": source})
