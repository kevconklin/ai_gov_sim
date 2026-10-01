"""Forced tool calls for structured output (SPEC 9.1: prefer structured tool calls over parsing prose)."""

from __future__ import annotations

from typing import Any, Mapping

from govern.llm import LLMClient, LLMRequest, LLMResult


class StructuredOutputError(RuntimeError):
    """The model did not return the required tool call."""


def tool(name: str, description: str, properties: Mapping[str, Any], required: list[str] | None = None) -> dict[str, Any]:
    return {
        "name": name,
        "description": description,
        "input_schema": {
            "type": "object",
            "properties": dict(properties),
            "required": list(required if required is not None else properties.keys()),
        },
    }


def number_range(description: str) -> dict[str, Any]:
    return {
        "type": "object",
        "description": description,
        "properties": {k: {"type": "number"} for k in ("low", "mode", "high")},
        "required": ["low", "mode", "high"],
    }


def forced(request_fields: Mapping[str, Any], tool_def: Mapping[str, Any]) -> LLMRequest:
    return LLMRequest(**{**request_fields, "tools": (tool_def,),
                         "tool_choice": {"type": "tool", "name": tool_def["name"]}})


def extract(result: LLMResult, tool_name: str) -> dict[str, Any]:
    if not result.ok:
        raise StructuredOutputError(f"call failed: {result.error}")
    for use in result.tool_uses:
        if use["name"] == tool_name:
            return dict(use["input"])
    raise StructuredOutputError(f"no {tool_name} call in response (stop_reason={result.stop_reason})")


def call_structured(llm: LLMClient, request_fields: Mapping[str, Any], tool_def: Mapping[str, Any]) -> dict[str, Any]:
    return extract(llm.call(forced(request_fields, tool_def)), tool_def["name"])
