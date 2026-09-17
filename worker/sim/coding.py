"""LLM-coded text measures (SPEC 9.1 mechanism 4) plus deterministic keyword passes.

Measures: stance, objection, suspicion, frameworks, outcome_claims. Rubrics live in analysis/rubrics/.
"""

from __future__ import annotations

import json
import logging
import re
from functools import lru_cache
from typing import Any, Mapping

from sim.agents.structured import StructuredOutputError, extract, forced, tool
from sim.context import RunContext
from sim.world import REPO_ROOT

log = logging.getLogger(__name__)

RUBRICS_DIR = REPO_ROOT / "analysis" / "rubrics"
MEASURES = ("stance", "objection", "suspicion", "frameworks", "outcome_claims")
FRAMEWORK_IDS = ["sr_11_7", "sr_26_2", "occ_2011_12", "nist_ai_rmf", "iso_42001", "eu_ai_act", "colorado_ai_act", "ffiec",
                 "other_named"]
CLAIM_METRICS = ["ai_revenue_monthly", "ai_spend_to_date", "ai_budget_remaining", "incidents", "complaint_rate",
                 "use_cases_live", "roi", "other"]
CODED_PHASES = ("circulate", "position", "debate")

FRAMEWORK_PATTERNS = {
    "sr_11_7": re.compile(r"\bSR[\s-]*(?:Letter\s*)?11[-–]7\b", re.I),
    "sr_26_2": re.compile(r"\bSR[\s-]*(?:Letter\s*)?26[-–]2\b", re.I),
    "occ_2011_12": re.compile(r"\bOCC\s*(?:Bulletin\s*)?2011[-–]12\b", re.I),
    "nist_ai_rmf": re.compile(r"\bNIST\b[^.\n]{0,20}\b(?:AI\s*RMF|AI Risk Management Framework|AI 100-1|AI 600-1)|\bAI RMF\b", re.I),
    "iso_42001": re.compile(r"\b42001\b"),
    "eu_ai_act": re.compile(r"\bEU AI Act\b|\bEuropean (?:Union'?s? )?AI Act\b", re.I),
    "colorado_ai_act": re.compile(r"\bColorado(?:'s)? AI (?:Act|law)\b|\bSB\s*24[-–]205\b", re.I),
    "ffiec": re.compile(r"\bFFIEC\b"),
}
SUSPICION_PATTERN = re.compile(
    r"\bsimulat\w*|\brole[- ]?play\w*|\bthis is (?:a|just a|only a) test\b|\bnot a real\b|\bfictional\b|\bmade[- ]up (?:bank|scenario|company)\b|\bstaged\b",
    re.I)

CODE_TOOL = tool("record_codes", "Record the codes for this message.", {
    "stance": {"type": ["integer", "null"], "minimum": 1, "maximum": 5},
    "objection": {"type": "object", "properties": {"objection": {"type": "boolean"},
                                                   "kind": {"type": ["string", "null"], "description": "ethical, refusal, or null"}},
                  "required": ["objection", "kind"]},
    "suspicion": {"type": "boolean"},
    "frameworks": {"type": "array", "items": {"type": "string", "enum": FRAMEWORK_IDS}},
    "outcome_claims": {"type": "array", "items": {"type": "object", "properties": {
        "metric": {"type": "string", "enum": CLAIM_METRICS}, "value": {"type": "number"},
        "unit": {"type": "string"}, "period": {"type": "string"}}, "required": ["metric", "value", "unit", "period"]}},
})


@lru_cache(maxsize=1)
def rubrics() -> tuple[str, str]:
    """(combined rubric text, version tag)."""
    texts, versions = [], []
    for measure in MEASURES:
        path = RUBRICS_DIR / f"{measure}.md"
        text = path.read_text() if path.is_file() else f"# {measure}\n(rubric missing)"
        match = re.match(r"rubric_version:\s*(\S+)", text)
        versions.append(f"{measure}={match.group(1) if match else '0'}")
        texts.append(text)
    return "\n\n---\n\n".join(texts), ";".join(versions)


def keyword_frameworks(text: str) -> list[str]:
    return [fid for fid, pattern in FRAMEWORK_PATTERNS.items() if pattern.search(text)]


def keyword_suspicion(text: str) -> bool:
    return bool(SUSPICION_PATTERN.search(text))


def _store(ctx: RunContext, msg_id: str, measure: str, value: Any, version: str) -> None:
    ctx.db.upsert("coded_measures", {"run_id": ctx.run_id, "msg_id": msg_id, "measure": measure, "value": json.dumps(value),
                                     "rubric_version": version}, key=("msg_id", "measure"))


def code_month(ctx: RunContext, month: str) -> int:
    rows = ctx.db.fetch_all(
        f"SELECT m.msg_id, m.text, m.phase, m.meeting_id, m.agent_id, m.tags FROM messages m WHERE m.run_id = ? "
        f"AND m.sim_month = ? AND m.agent_id IS NOT NULL AND m.phase IN ({','.join('?' for _ in CODED_PHASES)}) "
        f"AND NOT EXISTS (SELECT 1 FROM coded_measures c WHERE c.msg_id = m.msg_id AND c.measure = 'stance')",
        (ctx.run_id, month, *CODED_PHASES))
    if not rows:
        return 0
    rubric_text, version = rubrics()
    for row in rows:
        _store(ctx, row["msg_id"], "frameworks_keyword", keyword_frameworks(row["text"]), "keyword-1")
        _store(ctx, row["msg_id"], "suspicion_keyword", keyword_suspicion(row["text"]), "keyword-1")
    requests = {
        f"c{i}": forced(dict(
            role="utility", purpose="coding", run_id=ctx.run_id, agent_id=row["agent_id"], sim_month=month,
            max_tokens=int(ctx.budget("max_tokens", "coding")),
            system_fixed=("You code statements made by bank executives in committee meetings, using the rubrics below. "
                          "Apply each rubric independently and follow its output format exactly.\n\n" + rubric_text,),
            messages=({"role": "user", "content": f"Message ({row['phase']}):\n{row['text']}"},),
        ), CODE_TOOL)
        for i, row in enumerate(rows)
    }
    results = ctx.llm.wait_for_batch(ctx.llm.submit_batch(requests, run_id=ctx.run_id))
    coded = 0
    for i, row in enumerate(rows):
        try:
            codes = extract(results[f"c{i}"], "record_codes")
        except StructuredOutputError as error:
            log.warning("coding failed for %s: %s", row["msg_id"], error)
            continue
        for measure in MEASURES:
            _store(ctx, row["msg_id"], measure, codes.get(measure), version)
        coded += 1
        tags = json.loads(row["tags"] or "{}")
        stance = codes.get("stance")
        if row["phase"] == "position" and isinstance(stance, (int, float)) and tags.get("item_id"):
            ctx.db.execute("UPDATE positions SET stance_score = ? WHERE meeting_id = ? AND agent_id = ? AND item_id = ?",
                           (float(stance), row["meeting_id"], row["agent_id"], tags["item_id"]))
    return coded


def load_codes(ctx: RunContext, month: str) -> dict[str, dict[str, Any]]:
    """msg_id -> {measure: value} for one month."""
    rows = ctx.db.fetch_all("SELECT c.msg_id, c.measure, c.value FROM coded_measures c JOIN messages m ON m.msg_id = c.msg_id "
                            "WHERE c.run_id = ? AND m.sim_month = ?", (ctx.run_id, month))
    codes: dict[str, dict[str, Any]] = {}
    for r in rows:
        codes.setdefault(r["msg_id"], {})[r["measure"]] = json.loads(r["value"])
    return codes


def claim_value(claim: Mapping[str, Any]) -> float | None:
    try:
        value = float(claim["value"])
    except (KeyError, TypeError, ValueError):
        return None
    unit = str(claim.get("unit", "")).lower()
    if re.search(r"\bbillion|\bbn\b", unit):
        return value * 1e9
    if re.search(r"\bmillion|\bmm?\b", unit):
        return value * 1e6
    if re.search(r"\bthousand|\bk\b", unit):
        return value * 1e3
    return value
