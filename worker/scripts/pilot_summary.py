"""Print the pilot comparison: cost, decisions, policy growth, outcomes, and behaviour, per bank per month.

    cd worker && .venv/bin/python scripts/pilot_summary.py --experiment pilot-932476
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sim.cli import _open_db   # noqa: E402

METRICS = [("proposals_submitted", ""), ("approval_rate", ""), ("unanimity_rate", ""), ("control_count", ""),
           ("policy_word_count", ""), ("use_cases_live", "total"), ("ai_revenue_monthly", ""), ("ai_spend_cumulative", ""),
           ("incidents", "high"), ("findings_open", ""), ("shadow_ai_rate", ""), ("suspicion_rate", ""),
           ("policy_similarity_cross_bank", ""), ("cost_usd", "")]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--experiment", required=True)
    args = parser.parse_args()
    db = _open_db()
    runs = db.fetch_all("SELECT run_id, bank_id, condition, current_month FROM runs WHERE experiment_id = ? "
                        "AND parent_run_id IS NULL ORDER BY condition", (args.experiment,))
    if not runs:
        sys.exit(f"no runs for experiment {args.experiment}")
    months = [r["sim_month"] for r in db.fetch_all(
        "SELECT DISTINCT sim_month FROM metrics WHERE run_id IN (SELECT run_id FROM runs WHERE experiment_id = ?) "
        "ORDER BY sim_month", (args.experiment,))]

    described = ", ".join("{} ({}, through {})".format(r["bank_id"], r["condition"], r["current_month"]) for r in runs)
    print(f"Experiment {args.experiment}: {described}\n")
    for metric, dimension in METRICS:
        print(f"{metric}{' [' + dimension + ']' if dimension else ''}")
        for run in runs:
            values = {r["sim_month"]: r["value"] for r in db.fetch_all(
                "SELECT sim_month, value FROM metrics WHERE run_id = ? AND metric = ? AND dimension = ?",
                (run["run_id"], metric, dimension))}
            cells = " ".join(f"{values[m]:>9.2f}" if values.get(m) is not None else "        -" for m in months)
            print(f"  {run['bank_id']:<14}{cells}")
        print(f"  {'month':<14}" + " ".join(f"{m[-2:]:>9}" for m in months))

    print("\nDecisions by kind and outcome")
    for run in runs:
        rows = db.fetch_all("SELECT kind, outcome, COUNT(*) AS n FROM decisions WHERE run_id = ? GROUP BY kind, outcome "
                            "ORDER BY kind, outcome", (run["run_id"],))
        print(f"  {run['bank_id']:<14}" + ", ".join(f"{r['kind']} {r['outcome']}: {r['n']}" for r in rows))

    print("\nCost per bank-month (US$)")
    for run in runs:
        rows = db.fetch_all("SELECT sim_month, ROUND(SUM(cost_usd), 2) AS c FROM llm_calls WHERE run_id = ? "
                            "GROUP BY sim_month ORDER BY sim_month", (run["run_id"],))
        print(f"  {run['bank_id']:<14}" + " ".join(f"{r['sim_month'][-2:]}: {r['c']:>6.2f}" for r in rows))
    total = db.fetch_one("SELECT ROUND(SUM(cost_usd), 2) AS c FROM llm_calls WHERE run_id IN "
                         "(SELECT run_id FROM runs WHERE experiment_id = ?)", (args.experiment,))["c"]
    print(f"  total: ${total}")

    print("\nStance drift by seat (coded stance minus baseline, last month with data)")
    for run in runs:
        rows = db.fetch_all("SELECT dimension, value FROM metrics WHERE run_id = ? AND metric = 'stance_drift' "
                            "AND value IS NOT NULL ORDER BY sim_month DESC, dimension", (run["run_id"],))
        seen: dict[str, float] = {}
        for r in rows:
            seen.setdefault(r["dimension"], r["value"])
        print(f"  {run['bank_id']:<14}" + " ".join(f"{k}: {v:+.2f}" for k, v in sorted(seen.items())))

    print("\nInterventions and data caveats")
    for r in db.fetch_all("SELECT substr(run_id, 14, 14) AS bank, sim_month, kind, description FROM interventions "
                          "WHERE run_id IN (SELECT run_id FROM runs WHERE experiment_id = ?) ORDER BY real_ts",
                          (args.experiment,)):
        print(f"  {r['bank']:<16}{r['sim_month'] or '-':<9}{r['kind']}: {r['description'][:150]}")


if __name__ == "__main__":
    main()
