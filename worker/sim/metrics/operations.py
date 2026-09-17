"""Operations metrics: cost, tokens, failures."""

from __future__ import annotations

from sim.context import RunContext


def compute(ctx: RunContext, month: str) -> list:
    row = ctx.db.fetch_one(
        "SELECT COALESCE(SUM(cost_usd), 0) AS cost, COALESCE(SUM(input_tokens), 0) AS inp, COALESCE(SUM(cached_tokens), 0) AS cached, "
        "COALESCE(SUM(output_tokens), 0) AS out, COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) AS failed, "
        "COUNT(*) AS calls FROM llm_calls WHERE run_id = ? AND sim_month = ?", (ctx.run_id, month))
    return [("cost_usd", "", row["cost"]), ("tokens_input", "", row["inp"]), ("tokens_cached", "", row["cached"]),
            ("tokens_output", "", row["out"]), ("llm_failed_calls", "", row["failed"]), ("llm_calls", "", row["calls"])]
