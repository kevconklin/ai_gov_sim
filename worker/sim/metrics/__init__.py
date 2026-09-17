"""Monthly metrics (SPEC 9.2). Each group returns (metric, dimension, value) rows; definitions in analysis/metrics.yaml."""

from __future__ import annotations

from typing import Iterable

from sim.context import RunContext
from sim.metrics import behavior, decisions, operations, outcomes, policy

MetricRow = tuple[str, str, float | None]
GROUPS = (decisions.compute, policy.compute, outcomes.compute, behavior.compute, operations.compute)


def write_rows(ctx: RunContext, month: str, rows: Iterable[MetricRow]) -> int:
    count = 0
    for metric, dimension, value in rows:
        ctx.db.upsert("metrics", {"run_id": ctx.run_id, "bank_id": ctx.run["bank_id"], "sim_month": month, "metric": metric,
                                  "dimension": dimension, "value": None if value is None else float(value)},
                      key=("run_id", "sim_month", "metric", "dimension"))
        count += 1
    return count


def compute_month(ctx: RunContext, month: str) -> int:
    return sum(write_rows(ctx, month, group(ctx, month)) for group in GROUPS)
