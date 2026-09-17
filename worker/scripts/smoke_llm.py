"""Live check for M1: prompt caching and the Batch API against the real API.

Usage (needs ANTHROPIC_API_KEY; costs well under $0.05):
    cd worker && .venv/bin/python scripts/smoke_llm.py [--db smoke.sqlite] [--skip-batch]

Uses the `utility` role (Haiku). The fixed block is padded past the model's minimum cacheable length.
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from sim.config import load_config
from sim.db import Database
from sim.llm import LLMClient, LLMRequest

REPO_ROOT = Path(__file__).resolve().parents[2]
log = logging.getLogger("smoke")

_HANDBOOK_PARAGRAPH = (
    "Calder Ridge Bank operations handbook. Branch staff verify customer identity before discussing "
    "account details, escalate suspected fraud to the regional operations desk within one business day, "
    "and record every complaint in the service log with the date, product, and resolution owner. "
)


def _request(purpose: str) -> LLMRequest:
    return LLMRequest(
        role="utility",
        purpose=purpose,
        system_fixed=(_HANDBOOK_PARAGRAPH * 120,),
        messages=({"role": "user", "content": "In one short sentence, where is suspected fraud escalated?"},),
        max_tokens=60,
        temperature=0.0,
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default="smoke.sqlite")
    parser.add_argument("--skip-batch", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    db = Database.connect_sqlite(args.db)
    db.migrate(REPO_ROOT / "db" / "migrations")
    llm = LLMClient(db=db, config=load_config(REPO_ROOT / "config"))

    first = llm.call(_request("smoke_cache_1"))
    second = llm.call(_request("smoke_cache_2"))
    log.info("call 1: write=%d read=%d cost=$%.5f", first.usage.cache_write_tokens, first.usage.cache_read_tokens, first.cost_usd)
    log.info("call 2: write=%d read=%d cost=$%.5f", second.usage.cache_write_tokens, second.usage.cache_read_tokens, second.cost_usd)
    cache_ok = second.usage.cache_read_tokens > 0
    log.info("caching: %s", "OK" if cache_ok else "FAILED (no cache read on second call)")

    batch_ok = True
    if not args.skip_batch:
        batch_id = llm.submit_batch({"smoke_1": _request("smoke_batch")}, run_id=None)
        log.info("batch %s submitted; polling (can take several minutes)", batch_id)
        result = llm.wait_for_batch(batch_id)["smoke_1"]
        batch_ok = result.ok
        log.info("batch: %s cost=$%.5f text=%r", "OK" if batch_ok else f"FAILED {result.error}", result.cost_usd, result.text)

    total = db.fetch_one("SELECT COUNT(*) AS n, SUM(cost_usd) AS cost FROM llm_calls")
    log.info("logged %d calls, total $%.5f", total["n"], total["cost"] or 0.0)
    db.close()
    return 0 if cache_ok and batch_ok else 1


if __name__ == "__main__":
    sys.exit(main())
