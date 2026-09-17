"""Classifier validation (SPEC 9.1, M11): draw samples for human coding, then report Cohen's kappa."""

from __future__ import annotations

import csv
import json
import math
from collections import Counter
from pathlib import Path
from typing import Sequence

from sim.coding import FRAMEWORK_IDS, MEASURES
from sim.db import Database
from sim.engine.rng import derive_seed

BINARY = {"suspicion": lambda v: bool(v), "objection": lambda v: bool((v or {}).get("objection"))}


def draw_sample(db: Database, measure: str, n: int, out_path: Path, seed: int = 20270101) -> int:
    """Random sample of coded messages, model codes hidden in a separate column for adjudication."""
    if measure not in MEASURES:
        raise ValueError(f"unknown measure {measure}")
    rows = db.fetch_all("SELECT c.msg_id, c.value, m.text, m.phase, m.run_id FROM coded_measures c JOIN messages m "
                        "ON m.msg_id = c.msg_id WHERE c.measure = ?", (measure,))
    ranked = sorted(rows, key=lambda r: derive_seed(seed, measure, r["msg_id"]))[:n]
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["msg_id", "phase", "text", "human_code", "model_code"])
        for r in ranked:
            writer.writerow([r["msg_id"], r["phase"], r["text"], "", r["value"]])
    return len(ranked)


def cohen_kappa(a: Sequence[object], b: Sequence[object], *, weights: str | None = None) -> float | None:
    if len(a) != len(b) or not a:
        return None
    labels = sorted(set(a) | set(b), key=str)
    if len(labels) == 1:
        return 1.0
    index = {label: i for i, label in enumerate(labels)}
    k = len(labels)

    def weight(i: int, j: int) -> float:
        if weights == "quadratic":
            return ((i - j) / (k - 1)) ** 2
        return 0.0 if i == j else 1.0

    total = len(a)
    counts_a, counts_b = Counter(a), Counter(b)
    observed = sum(weight(index[x], index[y]) for x, y in zip(a, b)) / total
    expected = sum(weight(index[x], index[y]) * counts_a[x] * counts_b[y] for x in labels for y in labels) / total ** 2
    return None if math.isclose(expected, 0.0) else 1 - observed / expected


def kappa_for_file(measure: str, path: Path) -> dict[str, float | None]:
    with path.open() as handle:
        rows = [r for r in csv.DictReader(handle) if r["human_code"].strip()]
    human = [json.loads(r["human_code"]) for r in rows]
    model = [json.loads(r["model_code"]) for r in rows]
    if measure == "stance":
        pairs = [(h, m) for h, m in zip(human, model)]
        return {"kappa_quadratic": cohen_kappa([str(h) for h, _ in pairs], [str(m) for _, m in pairs], weights="quadratic")
                if all(isinstance(x, (int, type(None))) for p in pairs for x in p) else None, "n": len(pairs)}
    if measure in BINARY:
        f = BINARY[measure]
        return {"kappa": cohen_kappa([f(h) for h in human], [f(m) for m in model]), "n": len(rows)}
    if measure == "frameworks":
        per_id = {fid: cohen_kappa([fid in (h or []) for h in human], [fid in (m or []) for m in model]) for fid in FRAMEWORK_IDS}
        valid = [v for v in per_id.values() if v is not None]
        return {"kappa_mean_over_ids": sum(valid) / len(valid) if valid else None, "n": len(rows)}
    has_claim = cohen_kappa([bool(h) for h in human], [bool(m) for m in model])
    return {"kappa_any_claim": has_claim, "n": len(rows)}
