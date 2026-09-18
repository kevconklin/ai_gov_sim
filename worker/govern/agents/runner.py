"""One committee member's call sequence: context assembly (SPEC 4.3) plus the tool loop."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Callable

from govern import prompts
from govern.agents.memory import latest_memory
from govern.calendar import long_date
from govern.context import Agent, ReviewContext
from govern.llm import LLMRequest
from govern.tools import TOOLS, ToolSession, execute

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class TurnResult:
    text: str
    tool_calls: tuple[dict[str, Any], ...]
    steps: int


def fixed_block(ctx: ReviewContext, agent: Agent) -> str:
    """Persona, role, organisation background, and board direction: identical on every call, so it is cached.

    Two templates, chosen by whether the members have been told what they are. A customer's
    committee is told: its output is advisory, machine-generated, and a named person decides.
    The simulation's is not (SPEC 7), and its template is leak-checked to keep it that way.
    """
    org = ctx.org
    template = "review/fixed.md" if org.disclosed else "committee/fixed.md"
    return prompts.render(
        template,
        name=agent.name, title=agent.title, bank_name=org.name,
        profile=ctx.persona_body(agent), bank_facts=org.facts, risk_appetite=org.risk_appetite,
        chair_name=ctx.chair().name,
    )


def _request_blocks(content: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Echo assistant blocks back with only request-side fields (responses carry extras such as citations: null)."""
    blocks = []
    for block in content:
        if block["type"] == "text" and block.get("text"):
            blocks.append({"type": "text", "text": block["text"]})
        elif block["type"] == "tool_use":
            blocks.append({"type": "tool_use", "id": block["id"], "name": block["name"], "input": block["input"]})
    return blocks


def run_turn(ctx: ReviewContext, session: ToolSession, *, instruction: str, packet: str, purpose: str,
             max_tokens: int, until: Callable[[], bool] | None = None, required_tool: str | None = None,
             free_steps: int = 0, max_steps: int | None = None, tools_enabled: bool = True) -> TurnResult:
    """Run one member's call sequence.

    `until` ends the turn once the required actions are recorded. With `required_tool`, the member may use other
    tools for `free_steps` steps; after that every step must call the required tool, so reading cannot crowd out
    positions, ballots, or minutes. With `tools_enabled` false no tools are offered, so a phase whose output is
    prose (private notes, a handover memo) cannot come back empty because the member kept reading instead.
    """
    agent = session.agent
    memory = latest_memory(ctx.db, agent.agent_id, before_month=session.month)
    notes = prompts.render("committee/notes_header.md", date=long_date(session.meeting_date),
                           notes=memory or "You have not written any notes yet.")
    messages: list[dict[str, Any]] = [{"role": "user", "content": instruction}]
    texts: list[str] = []
    calls: list[dict[str, Any]] = []
    max_steps = max_steps or int(ctx.budget("agent", "max_tool_steps"))
    truncations = 0
    for step in range(1, max_steps + 1):
        forced = required_tool is not None and step > free_steps
        result = ctx.llm.call(LLMRequest(
            role="committee", purpose=purpose, run_id=ctx.run_id, agent_id=agent.agent_id, sim_month=session.month,
            system_fixed=(fixed_block(ctx, agent),), system_dynamic=(notes, packet),
            messages=tuple(messages), tools=TOOLS if tools_enabled else (), max_tokens=max_tokens,
            tool_choice={"type": "tool", "name": required_tool} if forced else None,
        ))
        if result.text.strip():
            texts.append(result.text.strip())
        if not result.tool_uses:
            if required_tool is not None and until is not None and not until() and step < max_steps:
                messages.append({"role": "assistant", "content": _request_blocks(result.raw["content"]) or
                                 [{"type": "text", "text": "Noted."}]})
                messages.append({"role": "user", "content": "Please record the remaining items now."})
                continue
            return TurnResult("\n\n".join(texts), tuple(calls), step)
        messages.append({"role": "assistant", "content": _request_blocks(result.raw["content"])})
        tool_results = []
        for use in result.tool_uses:
            output, is_error = execute(session, use["name"], use["input"])
            calls.append({"name": use["name"], "input": use["input"], "error": is_error})
            tool_results.append({"type": "tool_result", "tool_use_id": use["id"], "content": output,
                                 **({"is_error": True} if is_error else {})})
        messages.append({"role": "user", "content": tool_results})
        if until is not None and until():
            return TurnResult("\n\n".join(texts), tuple(calls), step)
        if result.stop_reason == "max_tokens":
            # Thinking plus output hit the limit, so the last tool call may be truncated: ask for it again, briefly.
            log.warning("%s hit max_tokens in %s at step %d; asking again", agent.agent_id, purpose, step)
            truncations += 1
            messages.append({"role": "user", "content": "That reply was cut off before it finished. Send it again, "
                                                        "shorter, and complete the tool call."})
    log.info("%s reached the tool step limit in %s (%d truncated)", agent.agent_id, purpose, truncations)
    return TurnResult("\n\n".join(texts), tuple(calls), max_steps)
