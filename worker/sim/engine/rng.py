"""The only source of randomness (SPEC 15). Draws are stateless: each value comes from a seed derived from
(run seed, stream, sim month, variable, key), so replays, forks, and paired banks see identical draws.

Streams:
  "exogenous"  shared by both banks in a replicate (same run seed): common random numbers for events
  "bank"       also keyed only by run seed; bank-specific outcomes differ through probabilities, not draws
"""

from __future__ import annotations

import hashlib
import math
import random
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from govern import ids
from govern.db import Database


def derive_seed(*parts: object) -> int:
    digest = hashlib.sha256("|".join(str(p) for p in parts).encode()).digest()
    return int.from_bytes(digest[:8], "big") & 0x7FFF_FFFF_FFFF_FFFF


def stable_int(low: int, high: int, *parts: object) -> int:
    """Cosmetic, unlogged choice (e.g. which day an email arrives). Inclusive bounds."""
    return random.Random(derive_seed("cosmetic", *parts)).randint(low, high)


def _sample(rand: random.Random, dist: str, params: Mapping[str, Any]) -> float:
    if dist == "triangular":
        low, mode, high = sorted((float(params["low"]), float(params["mode"]), float(params["high"])))
        return low if high == low else rand.triangular(low, high, mode)
    if dist == "lognormal":
        return rand.lognormvariate(math.log(float(params["median"])), float(params["sigma"]))
    if dist == "bernoulli":
        return 1.0 if rand.random() < float(params["p"]) else 0.0
    if dist == "uniform":
        return rand.uniform(float(params["low"]), float(params["high"]))
    if dist == "normal":
        return rand.gauss(float(params["mean"]), float(params["sd"]))
    if dist == "choice":
        weights = [float(w) for w in params["weights"]]
        if not weights or sum(weights) <= 0:
            raise ValueError("choice needs positive weights")
        return float(rand.choices(range(len(weights)), weights=weights)[0])
    raise ValueError(f"unknown distribution {dist!r}")


@dataclass(frozen=True)
class RNG:
    db: Database
    run_id: str
    seed: int

    def draw(
        self,
        variable: str,
        dist: str,
        params: Mapping[str, Any],
        *,
        sim_month: str,
        stream: str = "bank",
        key: Sequence[object] = (),
        decision_id: str | None = None,
    ) -> float:
        seed = derive_seed(self.seed, stream, sim_month, variable, *key)
        value = _sample(random.Random(seed), dist, params)
        self.db.insert("engine_draws", {
            "draw_id": ids.unique(self.run_id, "draw"),
            "run_id": self.run_id,
            "decision_id": decision_id,
            "sim_month": sim_month,
            "variable": ":".join([variable, *map(str, key)]) if key else variable,
            "dist": dist,
            "params": dict(params),
            "seed": seed,
            "value": value,
        })
        return value
