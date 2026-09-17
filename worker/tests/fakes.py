"""Fake Anthropic client that returns real SDK types, so tests exercise the same parsing as production."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import anthropic
import httpx2 as httpx
from anthropic.types import Message
from anthropic.types.messages import MessageBatch, MessageBatchIndividualResponse


def make_message(
    text: str = "Noted.",
    *,
    model: str = "claude-sonnet-5",
    input_tokens: int = 100,
    output_tokens: int = 20,
    cache_read: int = 0,
    cache_write: int = 0,
    extra_content: tuple[dict[str, Any], ...] = (),
) -> Message:
    return Message.model_validate(
        {
            "id": "msg_fake",
            "type": "message",
            "role": "assistant",
            "model": model,
            "content": [{"type": "text", "text": text}, *extra_content],
            "stop_reason": "end_turn",
            "stop_sequence": None,
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cache_read_input_tokens": cache_read,
                "cache_creation_input_tokens": cache_write,
            },
        }
    )


def make_status_error(status: int) -> anthropic.APIStatusError:
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    response = httpx.Response(status, request=request, json={"error": {"message": "fake"}})
    error_cls = {429: anthropic.RateLimitError, 500: anthropic.InternalServerError}.get(
        status, anthropic.BadRequestError
    )
    return error_cls("fake error", response=response, body=None)


@dataclass
class FakeBatches:
    results_by_id: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    status_by_id: dict[str, str] = field(default_factory=dict)
    created: list[list[dict[str, Any]]] = field(default_factory=list)

    def create(self, *, requests: list[dict[str, Any]]) -> MessageBatch:
        batch_id = f"msgbatch_{len(self.created)}"
        self.created.append(list(requests))
        self.status_by_id[batch_id] = "in_progress"
        return self._batch(batch_id)

    def retrieve(self, batch_id: str) -> MessageBatch:
        return self._batch(batch_id)

    def results(self, batch_id: str) -> list[MessageBatchIndividualResponse]:
        return [MessageBatchIndividualResponse.model_validate(r) for r in self.results_by_id[batch_id]]

    def _batch(self, batch_id: str) -> MessageBatch:
        return MessageBatch.model_validate(
            {
                "id": batch_id,
                "type": "message_batch",
                "processing_status": self.status_by_id[batch_id],
                "request_counts": {"processing": 0, "succeeded": 0, "errored": 0, "canceled": 0, "expired": 0},
                "created_at": "2026-09-17T00:00:00Z",
                "expires_at": "2026-09-18T00:00:00Z",
                "archived_at": None,
                "cancel_initiated_at": None,
                "ended_at": None,
                "results_url": None,
            }
        )


@dataclass
class FakeMessages:
    responses: list[Message | Exception] = field(default_factory=list)
    calls: list[dict[str, Any]] = field(default_factory=list)
    batches: FakeBatches = field(default_factory=FakeBatches)

    def create(self, **params: Any) -> Message:
        self.calls.append(params)
        result = self.responses.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


@dataclass
class FakeClient:
    messages: FakeMessages = field(default_factory=FakeMessages)
