"""Exports for analysis (SPEC 9.3): CSV and Parquet per table, reproducible from the database alone."""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from sim.db import Database

EXPORT_QUERIES = {
    "runs": "SELECT run_id, experiment_id, bank_id, condition, replicate, seed, parent_run_id, fork_month, model_versions, "
            "config_hash, start_month, current_month, status FROM runs",
    "metrics": "SELECT m.*, r.condition, r.replicate, r.experiment_id, r.parent_run_id FROM metrics m JOIN runs r ON r.run_id = m.run_id",
    "decisions": "SELECT d.*, r.condition, r.replicate FROM decisions d JOIN runs r ON r.run_id = d.run_id",
    "votes": "SELECT v.*, a.seat, d.outcome, d.kind, d.sim_month FROM votes v JOIN agents a ON a.agent_id = v.agent_id "
             "LEFT JOIN decisions d ON d.meeting_id = v.meeting_id AND d.item_id = v.item_id",
    "positions": "SELECT p.*, a.seat, m.sim_month FROM positions p JOIN agents a ON a.agent_id = p.agent_id "
                 "JOIN meetings m ON m.meeting_id = p.meeting_id",
    "use_cases": "SELECT * FROM use_cases",
    "use_case_history": "SELECT * FROM use_case_history",
    "policy_versions": "SELECT * FROM policy_versions",
    "events": "SELECT * FROM events",
    "findings": "SELECT * FROM findings",
    "agents": "SELECT * FROM agents",
    "messages": "SELECT m.*, a.seat FROM messages m LEFT JOIN agents a ON a.agent_id = m.agent_id",
    "coded_measures": "SELECT * FROM coded_measures",
    "interventions": "SELECT * FROM interventions",
    "llm_calls": "SELECT call_id, run_id, agent_id, sim_month, model, purpose, status, attempt, input_tokens, cached_tokens, "
                 "cache_write_tokens, output_tokens, cost_usd, batch, stop_reason, created_at FROM llm_calls",
}


def export_all(db: Database, out_dir: Path) -> dict[str, int]:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    counts = {}
    for name, sql in EXPORT_QUERIES.items():
        frame = pd.DataFrame([dict(r) for r in db.fetch_all(sql)])
        frame.to_csv(out_dir / f"{name}.csv", index=False)
        frame.astype({c: "string" for c in frame.columns if frame[c].dtype == object}).to_parquet(out_dir / f"{name}.parquet", index=False)
        counts[name] = len(frame)
    return counts
