"""One committee member's call sequence: context assembly (SPEC 4.3) plus the tool loop."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from sim import prompts
from sim.agents.memory import latest_memory
from sim.calendar import long_date
from sim.context import Agent, RunContext
from sim.llm import LLMRequest
from sim.tools import TOOLS, ToolSession, execute
from sim.world import load_persona

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class TurnResult:
    text: str
    tool_calls: tuple[dict[str, Any], ...]
    steps: int


def fixed_block(ctx: RunContext, agent: Agent) -> str:
    """Persona, role, bank background, and board direction: identical on every call, so it is cached."""
    persona = load_persona(ctx.world.config_dir, agent.persona_file)
    facts = ctx.world.bank_universe(ctx.run["bank_id"])
    return prompts.render(
        "committee/fixed.md",
        name=agent.name, title=agent.title, bank_name=ctx.bank.name,
        profile=persona.body, bank_facts=_bank_facts(ctx, facts), risk_appetite=ctx.bank.risk_appetite,
        chair_name=ctx.chair().name,
    )


def _bank_facts(ctx: RunContext, facts: Any) -> str:
    if not facts:
        return f"{ctx.bank.name} is a state-chartered commercial bank and Federal Reserve member headquartered in the Midwest."
    keys = [("legal_name", "Legal name"), ("hq_address", "Headquarters"), ("total_assets_usd", "Total assets"),
            ("employees", "Employees"), ("branches", "Branches"), ("customers", "Customers")]
    lines = []
    for key, label in keys:
        if key in facts:
            value = facts[key]
            lines.append(f"- {label}: ${value:,.0f}" if key == "total_assets_usd" and isinstance(value, (int, float))
                         else f"- {label}: {value:,}" if isinstance(value, int) else f"- {label}: {value}")
    return "\n".join(lines)


def _request_blocks(content: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Echo assistant blocks back with only request-side fields (responses carry extras such as citations: null)."""
    blocks = []
    for block in content:
        if block["type"] == "text" and block.get("text"):
            blocks.append({"type": "text", "text": block["text"]})
        elif block["type"] == "tool_use":
            blocks.append({"type": "tool_use", "id": block["id"], "name": block["name"], "input": block["input"]})
    return blocks


def run_turn(ctx: RunContext, session: ToolSession, *, instruction: str, packet: str, purpose: str,
             max_tokens: int) -> TurnResult:
    agent = session.agent
    memory = latest_memory(ctx.db, agent.agent_id, before_month=session.month)
    notes = prompts.render("committee/notes_header.md", date=long_date(session.meeting_date),
                           notes=memory or "You have not written any notes yet.")
    messages: list[dict[str, Any]] = [{"role": "user", "content": instruction}]
    texts: list[str] = []
    calls: list[dict[str, Any]] = []
    max_steps = int(ctx.budget("agent", "max_tool_steps"))
    for step in range(1, max_steps + 1):
        result = ctx.llm.call(LLMRequest(
            role="committee", purpose=purpose, run_id=ctx.run_id, agent_id=agent.agent_id, sim_month=session.month,
            system_fixed=(fixed_block(ctx, agent),), system_dynamic=(notes, packet),
            messages=tuple(messages), tools=TOOLS, max_tokens=max_tokens,
        ))
        if result.text.strip():
            texts.append(result.text.strip())
        if not result.tool_uses:
            return TurnResult("\n\n".join(texts), tuple(calls), step)
        messages.append({"role": "assistant", "content": _request_blocks(result.raw["content"])})
        tool_results = []
        for use in result.tool_uses:
            output, is_error = execute(session, use["name"], use["input"])
            calls.append({"name": use["name"], "input": use["input"], "error": is_error})
            tool_results.append({"type": "tool_result", "tool_use_id": use["id"], "content": output,
                                 **({"is_error": True} if is_error else {})})
        messages.append({"role": "user", "content": tool_results})
        if result.stop_reason == "max_tokens":
            break
    log.info("%s reached the tool step limit in %s", agent.agent_id, purpose)
    return TurnResult("\n\n".join(texts), tuple(calls), max_steps)
