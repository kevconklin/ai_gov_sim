"""Policy metrics."""

from __future__ import annotations

import json

from sim.calendar import add_months, month_index
from sim.coding import FRAMEWORK_IDS, keyword_frameworks
from sim.context import RunContext
from sim.metrics.text import tfidf_cosine


def partner_run_id(ctx: RunContext) -> str | None:
    """The other bank in the same replicate (following fork parents back to the original pair)."""
    root = dict(ctx.run)
    while root.get("parent_run_id"):
        root = dict(ctx.db.fetch_one("SELECT * FROM runs WHERE run_id = ?", (root["parent_run_id"],)))
    row = ctx.db.fetch_one("SELECT run_id FROM runs WHERE experiment_id = ? AND replicate = ? AND bank_id != ? "
                           "AND parent_run_id IS NULL", (root["experiment_id"], root["replicate"], root["bank_id"]))
    return row["run_id"] if row else None


def compute(ctx: RunContext, month: str) -> list:
    db, run_id = ctx.db, ctx.run_id
    rows = []
    version = db.fetch_one("SELECT * FROM policy_versions WHERE run_id = ? AND sim_month = ?", (run_id, month))
    previous = db.fetch_one("SELECT controls FROM policy_versions WHERE run_id = ? AND sim_month < ? ORDER BY sim_month DESC "
                            "LIMIT 1", (run_id, month))
    if version:
        rows += [("policy_word_count", "", version["word_count"]), ("control_count", "", version["control_count"]),
                 ("readability_grade", "", version["readability"])]
        now, before = set(json.loads(version["controls"])), set(json.loads(previous["controls"])) if previous else set()
        rows += [("controls_added", "", len(now - before)), ("controls_removed", "", len(before - now))]

    messages = db.fetch_all("SELECT m.msg_id, m.text, m.sim_month, c.value AS coded FROM messages m LEFT JOIN coded_measures c "
                            "ON c.msg_id = m.msg_id AND c.measure = 'frameworks' WHERE m.run_id = ? AND m.sim_month <= ? "
                            "AND m.agent_id IS NOT NULL AND m.phase IN ('circulate', 'position', 'debate')", (run_id, month))
    policy_text = version["policy_text"] if version else ""
    for fid in FRAMEWORK_IDS:
        hits = [m for m in messages if fid in keyword_frameworks(m["text"]) or fid in (json.loads(m["coded"]) if m["coded"] else [])]
        in_policy = fid in keyword_frameworks(policy_text)
        rows.append(("framework_mentions", fid, len(hits) + (1 if in_policy else 0)))
        first = min((m["sim_month"] for m in hits), default=None)
        if first:
            rows.append(("framework_first_mention_month_index", fid, month_index(ctx.run["start_month"], first)))

    partner = partner_run_id(ctx)
    if partner and version:
        other = db.fetch_one("SELECT policy_text FROM policy_versions WHERE run_id = ? AND sim_month = ?", (partner, month))
        if other:
            similarity = tfidf_cosine(policy_text, other["policy_text"])
            rows.append(("policy_similarity_cross_bank", "", similarity))
            # The partner finished this month first; record the same value for it.
            partner_bank = db.fetch_one("SELECT bank_id FROM runs WHERE run_id = ?", (partner,))["bank_id"]
            db.upsert("metrics", {"run_id": partner, "bank_id": partner_bank, "sim_month": month,
                                  "metric": "policy_similarity_cross_bank", "dimension": "", "value": similarity},
                      key=("run_id", "sim_month", "metric", "dimension"))
    return rows
