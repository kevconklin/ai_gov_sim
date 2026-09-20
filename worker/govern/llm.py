"""The only path to the Claude API (SPEC section 15). Handles caching, batches, retries, logging, and cost.

Every attempt, successful or not, becomes one row in `llm_calls` with the full request and response.
"""

from __future__ import annotations

import re
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Mapping

import anthropic

from govern.config import Config
from govern.db import Database, utc_now_iso
from govern.providers import ProviderError, Registry
from govern.pricing import TokenUsage, compute_cost

_CUSTOM_ID = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")
_RETRYABLE_STATUS = frozenset({408, 409, 429})
_CACHE_CONTROL = {"type": "ephemeral"}


class LLMCallFailed(RuntimeError):
    """Raised when a call fails permanently. Every failed attempt is already logged."""


class StopRequested(RuntimeError):
    """The kill switch was set; no further API calls are made (SPEC 11.3)."""


@dataclass(frozen=True)
class LLMRequest:
    role: str                                   # key into models.yaml roles
    purpose: str                                # e.g. committee_turn, estimator_effort
    messages: tuple[Mapping[str, Any], ...]
    max_tokens: int
    run_id: str | None = None
    agent_id: str | None = None
    sim_month: str | None = None
    system_fixed: tuple[str, ...] = ()          # persona, role, background: cached
    system_dynamic: tuple[str, ...] = ()        # memory, packet: not cached
    tools: tuple[Mapping[str, Any], ...] = ()
    tool_choice: Mapping[str, Any] | None = None
    stop_sequences: tuple[str, ...] = ()
    effort: str | None = None          # output_config.effort: how much the model thinks (model-dependent)
    model: str | None = None           # "<provider>:<model>" chosen for this seat; overrides the role's model

    def __post_init__(self) -> None:
        if self.max_tokens < 1:
            raise ValueError("max_tokens must be positive")
        if not self.messages:
            raise ValueError("a request needs at least one message")
        if not self.purpose:
            raise ValueError("purpose is required for cost attribution")

    def to_params(self, model: str) -> dict[str, Any]:
        """Messages API params. The last fixed system block carries the cache breakpoint."""
        params: dict[str, Any] = {
            "model": model,
            "max_tokens": self.max_tokens,
            "messages": [dict(m) for m in self.messages],
        }
        system = [
            {"type": "text", "text": text, **({"cache_control": _CACHE_CONTROL} if i == len(self.system_fixed) - 1 else {})}
            for i, text in enumerate(self.system_fixed)
        ] + [{"type": "text", "text": text} for text in self.system_dynamic]
        optional = {
            "system": system or None,
            "tools": [dict(t) for t in self.tools] or None,
            "tool_choice": dict(self.tool_choice) if self.tool_choice else None,
            "stop_sequences": list(self.stop_sequences) or None,
            "output_config": {"effort": self.effort} if self.effort else None,
        }
        return {**params, **{k: v for k, v in optional.items() if v is not None}}


@dataclass(frozen=True)
class LLMResult:
    call_id: str
    ok: bool
    model: str
    text: str
    tool_uses: tuple[dict[str, Any], ...]
    stop_reason: str | None
    usage: TokenUsage
    cost_usd: float
    attempt: int
    error: str | None = None
    raw: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class _CallMeta:
    purpose: str
    model: str
    run_id: str | None
    agent_id: str | None
    sim_month: str | None
    params: Mapping[str, Any]

    @classmethod
    def of(cls, request: LLMRequest, model: str) -> "_CallMeta":
        return cls(request.purpose, model, request.run_id, request.agent_id, request.sim_month, request.to_params(model))

    def to_json(self) -> dict[str, Any]:
        return {"purpose": self.purpose, "model": self.model, "run_id": self.run_id,
                "agent_id": self.agent_id, "sim_month": self.sim_month, "params": dict(self.params)}


def _is_retryable(error: Exception) -> bool:
    if isinstance(error, ProviderError):
        return error.status_code in _RETRYABLE_STATUS or error.status_code >= 500
    if isinstance(error, anthropic.APIConnectionError):
        return True
    if isinstance(error, anthropic.APIStatusError):
        return error.status_code in _RETRYABLE_STATUS or error.status_code >= 500
    return False


def _describe(error: Exception) -> str:
    return f"{type(error).__name__}: {error}"


def _parse_content(content: Any) -> tuple[str, tuple[dict[str, Any], ...]]:
    text = "".join(block.text for block in content if block.type == "text")
    tool_uses = tuple(
        {"id": block.id, "name": block.name, "input": block.input} for block in content if block.type == "tool_use"
    )
    return text, tool_uses


class LLMClient:
    def __init__(
        self,
        *,
        db: Database,
        config: Config,
        client: Any | None = None,
        sleep: Callable[[float], None] = time.sleep,
        should_stop: Callable[[], bool] = lambda: False,
        on_failure_streak: Callable[[int, str], None] | None = None,
        price_scale: float = 1.0,
        registry: Registry | None = None,
    ) -> None:
        self._price_scale = price_scale   # 0 for the scripted demo client, so demo rows never count toward spend caps
        self._db = db
        self._config = config
        self._should_stop = should_stop
        self._on_failure_streak = on_failure_streak
        self._consecutive_failures = 0
        self._pinned: dict[str, Mapping[str, str]] = {}
        # One injected client answers for every model: that is how the scripted client and the
        # tests work. Otherwise each model is routed to its own provider by the registry, and
        # SDK retries stay disabled so every attempt is visible in llm_calls.
        self._client = client
        self._registry = registry
        if client is None and registry is None:
            self._client = anthropic.Anthropic(max_retries=0)
        self._sleep = sleep

    # ---- standard calls -------------------------------------------------

    def model_for(self, request: LLMRequest) -> str:
        """A seat's own model if it has one; else the run's pinned model for the role; else config."""
        if request.model:
            return request.model
        if request.run_id:
            if request.run_id not in self._pinned:
                row = self._db.fetch_one("SELECT model_versions FROM runs WHERE run_id = ?", (request.run_id,))
                self._pinned[request.run_id] = Database.loads(row["model_versions"]) if row else {}
            pinned = self._pinned[request.run_id]
            if request.role in pinned:
                return pinned[request.role]
        return self._config.models.model_for(request.role)

    def call(self, request: LLMRequest) -> LLMResult:
        meta = _CallMeta.of(request, self.model_for(request))
        retries = self._config.budget.retries
        for attempt in range(1, retries.max_attempts + 1):
            self._check_stop()
            try:
                message = self._client_for(meta.model).messages.create(**self._wire(meta))
            except Exception as error:  # noqa: BLE001 - every failure is logged before deciding
                self._log_failure(meta, attempt, _describe(error), batch=False)
                self._note_failure(_describe(error))
                if not _is_retryable(error):
                    raise LLMCallFailed(f"{meta.purpose} failed (not retryable): {_describe(error)}") from error
                if attempt < retries.max_attempts:
                    self._sleep(min(retries.max_delay_seconds, retries.base_delay_seconds * 2 ** (attempt - 1)))
                continue
            self._consecutive_failures = 0
            return self._log_success(meta, message, attempt, batch=False)
        raise LLMCallFailed(f"{meta.purpose} failed after {retries.max_attempts} attempts")

    def _client_for(self, model: str) -> Any:
        return self._client if self._client is not None else self._registry.client_for(model)

    def _wire(self, meta: "_CallMeta") -> dict[str, Any]:
        """What is sent. The log keeps our "<provider>:<model>"; the provider is sent its own id."""
        if self._client is not None or self._registry is None:
            return dict(meta.params)
        return {**meta.params, "model": self._registry.wire_model(meta.model)}

    # ---- batch calls ----------------------------------------------------

    def _check_stop(self) -> None:
        if self._should_stop():
            raise StopRequested("stop requested")

    def _note_failure(self, description: str) -> None:
        self._consecutive_failures += 1
        if self._on_failure_streak and self._consecutive_failures % 3 == 0:
            self._on_failure_streak(self._consecutive_failures, description)

    def submit_batch(self, requests: Mapping[str, LLMRequest], *, run_id: str | None) -> str:
        self._check_stop()
        if not requests:
            raise ValueError("a batch needs at least one request")
        bad = [cid for cid in requests if not _CUSTOM_ID.match(cid)]
        if bad:
            raise ValueError(f"invalid batch custom_id(s): {bad}")
        metas = {cid: _CallMeta.of(r, self.model_for(r)) for cid, r in requests.items()}
        batch = self._client.messages.batches.create(
            requests=[{"custom_id": cid, "params": dict(meta.params)} for cid, meta in metas.items()]
        )
        self._db.insert("llm_batches", {
            "batch_id": batch.id,
            "run_id": run_id,
            "status": "submitted",
            "requests": {cid: meta.to_json() for cid, meta in metas.items()},
            "submitted_at": utc_now_iso(),
        })
        return batch.id

    def collect_batch(self, batch_id: str) -> dict[str, LLMResult] | None:
        """Log and return results if the batch has ended; None while it is still processing."""
        record = self._db.fetch_one("SELECT status, requests FROM llm_batches WHERE batch_id = ?", (batch_id,))
        if record is None:
            raise ValueError(f"unknown batch {batch_id}")
        if record["status"] == "collected":
            raise ValueError(f"batch {batch_id} already collected")
        if self._client.messages.batches.retrieve(batch_id).processing_status != "ended":
            return None

        metas = {
            cid: _CallMeta(m["purpose"], m["model"], m["run_id"], m["agent_id"], m["sim_month"], m["params"])
            for cid, m in Database.loads(record["requests"]).items()
        }
        # Results logged by an earlier, interrupted collection are reused, not logged again.
        results: dict[str, LLMResult] = {
            row["custom_id"]: self._result_from_row(row)
            for row in self._db.fetch_all("SELECT * FROM llm_calls WHERE batch_id = ?", (batch_id,))
        }
        for entry in self._client.messages.batches.results(batch_id):
            if entry.custom_id in results:
                continue
            meta = metas[entry.custom_id]
            if entry.result.type == "succeeded":
                results[entry.custom_id] = self._log_success(
                    meta, entry.result.message, 1, batch=True, batch_id=batch_id, custom_id=entry.custom_id
                )
            else:
                detail = entry.result.model_dump(mode="json")
                results[entry.custom_id] = self._log_failure(
                    meta, 1, f"batch result {entry.result.type}: {detail}", batch=True,
                    batch_id=batch_id, custom_id=entry.custom_id,
                )
        for cid in metas.keys() - results.keys():
            results[cid] = self._log_failure(
                metas[cid], 1, "missing from batch results", batch=True, batch_id=batch_id, custom_id=cid
            )
        self._db.update("llm_batches", {"status": "collected", "collected_at": utc_now_iso()},
                        where={"batch_id": batch_id})
        return results

    def wait_for_batch(self, batch_id: str) -> dict[str, LLMResult]:
        while (results := self.collect_batch(batch_id)) is None:
            self._check_stop()
            self._sleep(self._config.budget.batch_poll_interval_seconds)
        return results

    # ---- logging --------------------------------------------------------

    @staticmethod
    def _result_from_row(row: Any) -> LLMResult:
        raw = Database.loads(row["response"]) or {}
        content = raw.get("content", [])
        text = "".join(b["text"] for b in content if b.get("type") == "text")
        tool_uses = tuple(
            {"id": b["id"], "name": b["name"], "input": b["input"]} for b in content if b.get("type") == "tool_use"
        )
        usage = TokenUsage(row["input_tokens"], row["output_tokens"], row["cached_tokens"], row["cache_write_tokens"])
        return LLMResult(call_id=row["call_id"], ok=row["status"] == "ok", model=row["model"], text=text,
                         tool_uses=tool_uses, stop_reason=row["stop_reason"], usage=usage,
                         cost_usd=row["cost_usd"], attempt=row["attempt"], error=row["error"], raw=raw)

    def _log_success(self, meta: _CallMeta, message: Any, attempt: int, *, batch: bool,
                     batch_id: str | None = None, custom_id: str | None = None) -> LLMResult:
        usage = TokenUsage.from_api(message.usage)
        cost = compute_cost(self._config.models, meta.model, usage, batch=batch) * self._price_scale
        text, tool_uses = _parse_content(message.content)
        raw = message.model_dump(mode="json")
        call_id = self._write_row(meta, status="ok", attempt=attempt, usage=usage, cost=cost, batch=batch,
                                  batch_id=batch_id, custom_id=custom_id, stop_reason=message.stop_reason,
                                  error=None, response=raw)
        return LLMResult(call_id=call_id, ok=True, model=meta.model, text=text, tool_uses=tool_uses,
                         stop_reason=message.stop_reason, usage=usage, cost_usd=cost, attempt=attempt, raw=raw)

    def _log_failure(self, meta: _CallMeta, attempt: int, error: str, *, batch: bool,
                     batch_id: str | None = None, custom_id: str | None = None) -> LLMResult:
        usage = TokenUsage(0, 0)
        call_id = self._write_row(meta, status="error", attempt=attempt, usage=usage, cost=0.0, batch=batch,
                                  batch_id=batch_id, custom_id=custom_id, stop_reason=None,
                                  error=error, response=None)
        return LLMResult(call_id=call_id, ok=False, model=meta.model, text="", tool_uses=(), stop_reason=None,
                         usage=usage, cost_usd=0.0, attempt=attempt, error=error)

    def _write_row(self, meta: _CallMeta, *, status: str, attempt: int, usage: TokenUsage, cost: float,
                   batch: bool, batch_id: str | None, custom_id: str | None, stop_reason: str | None,
                   error: str | None, response: Mapping[str, Any] | None) -> str:
        call_id = str(uuid.uuid4())
        self._db.insert("llm_calls", {
            "call_id": call_id,
            "run_id": meta.run_id,
            "agent_id": meta.agent_id,
            "sim_month": meta.sim_month,
            "model": meta.model,
            "purpose": meta.purpose,
            "status": status,
            "attempt": attempt,
            "input_tokens": usage.input_tokens,
            "cached_tokens": usage.cache_read_tokens,
            "cache_write_tokens": usage.cache_write_tokens,
            "output_tokens": usage.output_tokens,
            "cost_usd": cost,
            "batch": batch,
            "batch_id": batch_id,
            "custom_id": custom_id,
            "stop_reason": stop_reason,
            "error": error,
            "request": dict(meta.params),
            "response": dict(response) if response is not None else None,
            "created_at": utc_now_iso(),
        })
        return call_id
