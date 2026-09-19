"""Rolling memory (SPEC 4.3): each member rewrites private notes monthly; long notes are compressed by Haiku."""

from __future__ import annotations

import math

from govern import prompts
from govern.db import Database
from govern.llm import LLMClient, LLMRequest


def estimate_tokens(text: str) -> int:
    return math.ceil(len(text) / 4)


def latest_memory(db: Database, agent_id: str, *, before_month: str) -> str | None:
    row = db.fetch_one("SELECT text FROM agent_memories WHERE agent_id = ? AND sim_month < ? ORDER BY sim_month DESC LIMIT 1",
                       (agent_id, before_month))
    return row["text"] if row else None


def save_memory(db: Database, llm: LLMClient, *, run_id: str, agent_id: str, month: str, text: str,
                max_tokens: int, compression_max_tokens: int) -> str:
    compressed = False
    if estimate_tokens(text) > max_tokens:
        result = llm.call(LLMRequest(
            role="utility", purpose="memory_compression", run_id=run_id, agent_id=agent_id, sim_month=month,
            system_fixed=(prompts.render("committee/compress_notes.md"),),
            messages=({"role": "user", "content": text},), max_tokens=compression_max_tokens,
        ))
        if result.text.strip():
            text, compressed = result.text.strip(), True
    db.upsert("agent_memories", {"run_id": run_id, "agent_id": agent_id, "sim_month": month, "text": text,
                                 "token_estimate": estimate_tokens(text), "compressed": compressed},
              key=("agent_id", "sim_month"))
    return text
