"""The one path to the fast decision model (TypeSafe's Jev, docs.typesafe.ai/api).

A System One call: send `state` (text or JSON) and a map of typed questions; get one typed answer per
question with calibrated probabilities and a confidence. A noul is a yes/no probability, a choice picks
one option with a probability for each, a score rates against ordered levels. The model writes no prose,
so it decides nothing a person reads; code reads the answers and routes, flags, or skips, and every call
lands in `gate_calls` with what the code then did. No key, a timeout, or a bad answer raises
`GateUnavailable`, and the caller carries on without the gate.
"""

from __future__ import annotations

import json
import logging
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping, Protocol

import yaml

from govern import ids
from govern.db import Database, utc_now_iso

log = logging.getLogger(__name__)

PROVIDER = "typesafe"
ENDPOINT = "https://api.typesafe.ai/v1/systemone"


class GateUnavailable(RuntimeError):
    """The gate could not answer. Whatever it guards runs as if there were no gate."""


@dataclass(frozen=True)
class JevSettings:
    endpoint: str = ENDPOINT
    model: str = "jev-1.13.0"
    key_env: str = "JEV_API_KEY"
    timeout: float = 5.0
    max_state_chars: int = 24_000
    price_per_mtok: float = 0.0          # USD per million input tokens, from models.yaml; 0 means unpriced

    @property
    def priced_model(self) -> str:
        return f"{PROVIDER}:{self.model}"


def load_settings(config_dir: Path, models_prices: Mapping[str, Any] | None = None) -> JevSettings:
    data = yaml.safe_load((Path(config_dir) / "classify.yaml").read_text()) or {}
    jev = data.get("jev") or {}
    model = str(jev.get("model") or "jev-1.13.0")
    price = 0.0
    if models_prices and f"{PROVIDER}:{model}" in models_prices:
        price = float(getattr(models_prices[f"{PROVIDER}:{model}"], "input", 0.0))
    return JevSettings(endpoint=str(jev.get("endpoint") or ENDPOINT), model=model, key_env=str(jev.get("key_env") or "JEV_API_KEY"),
                       timeout=float(jev.get("timeout_seconds", 5)), max_state_chars=int(jev.get("max_state_chars", 24_000)),
                       price_per_mtok=price)


def available(settings: JevSettings) -> bool:
    """A key in the environment and a price in models.yaml: unpriced spend cannot be capped."""
    return bool(os.environ.get(settings.key_env)) and settings.price_per_mtok > 0


@dataclass(frozen=True)
class Evaluation:
    call_id: str
    model: str
    answers: Mapping[str, Mapping[str, Any]]
    input_tokens: int
    cost_usd: float
    latency_ms: int

    def noul(self, key: str) -> float:
        return float(self.answers[key]["noul"])

    def choice(self, key: str) -> tuple[str, Mapping[str, float], float]:
        a = self.answers[key]
        return str(a["choice"]), {k: float(v) for k, v in a["probabilities"].items()}, float(a["confidence"])


class Transport(Protocol):
    def __call__(self, body: Mapping[str, Any], *, settings: JevSettings, key: str) -> Mapping[str, Any]: ...


def http_transport(body: Mapping[str, Any], *, settings: JevSettings, key: str) -> Mapping[str, Any]:
    req = urllib.request.Request(settings.endpoint, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"})
    try:
        with urllib.request.urlopen(req, timeout=settings.timeout) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")[:200]
        raise GateUnavailable(f"HTTP {error.code}: {detail}") from None
    except Exception as error:  # noqa: BLE001 - any failure means the gate is skipped
        raise GateUnavailable(f"{type(error).__name__}: {error}"[:200]) from None


def _cut(state: Any, limit: int) -> Any:
    """Text state is cut to the limit; structured state is the caller's to keep small (the API refuses an oversize one)."""
    return state[:limit] if isinstance(state, str) and len(state) > limit else state


class Jev:
    """A client bound to one database (for the log) and one settings block."""

    def __init__(self, db: Database, settings: JevSettings, *, transport: Transport = http_transport, key: str | None = None) -> None:
        self.db, self.settings, self.transport = db, settings, transport
        self.key = key if key is not None else os.environ.get(settings.key_env)

    def evaluate(self, state: Any, questions: Mapping[str, Mapping[str, Any]], *, purpose: str, run_id: str,
                 item_id: str | None = None, meeting_id: str | None = None) -> Evaluation:
        """Ask. Logs the call either way; raises GateUnavailable when there is no usable answer."""
        key = self.key
        if not key:
            self._log(run_id, purpose, item_id, meeting_id, state, questions, status="unavailable", error=f"{self.settings.key_env} is not set")
            raise GateUnavailable(f"{self.settings.key_env} is not set")
        if self.settings.price_per_mtok <= 0:
            self._log(run_id, purpose, item_id, meeting_id, state, questions, status="unavailable", error="unpriced in models.yaml")
            raise GateUnavailable(f"{self.settings.priced_model} has no price in models.yaml")
        body = {"state": _cut(state, self.settings.max_state_chars), "model": self.settings.model, "questions": dict(questions)}
        started = time.monotonic()
        try:
            data = self.transport(body, settings=self.settings, key=key)
            answers = data["answers"]
            for q in questions:
                if q not in answers or answers[q].get("type") != questions[q]["type"]:
                    raise GateUnavailable(f"no answer of the right type for {q}")
            usage = data.get("usage") or {}
            tokens = int(usage.get("input_tokens") or 0)
        except GateUnavailable as error:
            latency = int((time.monotonic() - started) * 1000)
            self._log(run_id, purpose, item_id, meeting_id, state, questions, status="unavailable", error=str(error), latency_ms=latency)
            raise
        except (KeyError, TypeError, ValueError) as error:
            latency = int((time.monotonic() - started) * 1000)
            self._log(run_id, purpose, item_id, meeting_id, state, questions, status="unavailable", error=f"unusable answer: {error}"[:200], latency_ms=latency)
            raise GateUnavailable(f"unusable answer: {error}") from None
        latency = int((time.monotonic() - started) * 1000)
        cost = tokens * self.settings.price_per_mtok / 1_000_000
        call_id = self._log(run_id, purpose, item_id, meeting_id, state, questions, status="ok", answers=answers,
                            model=str(data.get("model") or self.settings.model), input_tokens=tokens, cost=cost, latency_ms=latency)
        return Evaluation(call_id, str(data.get("model") or self.settings.model), answers, tokens, cost, latency)

    def acted(self, call_id: str, what: Mapping[str, Any]) -> None:
        """What the code did with the answers, for the record."""
        self.db.update("gate_calls", {"acted": dict(what)}, where={"call_id": call_id})

    def _log(self, run_id: str, purpose: str, item_id: str | None, meeting_id: str | None, state: Any, questions: Mapping[str, Any], *,
             status: str, error: str | None = None, answers: Any = None, model: str | None = None, input_tokens: int = 0,
             cost: float = 0.0, latency_ms: int = 0) -> str:
        call_id = ids.unique(run_id, "jev")
        state_text = state if isinstance(state, str) else json.dumps(state)
        self.db.insert("gate_calls", {
            "call_id": call_id, "run_id": run_id, "purpose": purpose, "item_id": item_id, "meeting_id": meeting_id,
            "model": model or self.settings.model, "state": state_text[:self.settings.max_state_chars], "questions": dict(questions),
            "answers": answers, "acted": None, "input_tokens": input_tokens, "cost_usd": cost, "latency_ms": latency_ms,
            "status": status, "error": error, "created_at": utc_now_iso(),
        })
        if status == "ok":
            # on the same ledger as every model call, so a review's spend and the cap include it
            self.db.insert("llm_calls", {
                "call_id": call_id, "run_id": run_id, "agent_id": None, "sim_month": None, "model": self.settings.priced_model,
                "purpose": f"gate_{purpose}", "status": "ok", "attempt": 1, "input_tokens": input_tokens, "cached_tokens": 0,
                "cache_write_tokens": 0, "output_tokens": 0, "cost_usd": cost, "batch": False, "batch_id": None, "custom_id": None,
                "stop_reason": None, "error": None, "request": {"model": self.settings.model, "purpose": purpose},
                "response": {"answers": answers, "usage": {"input_tokens": input_tokens}}, "created_at": utc_now_iso(),
            })
        return call_id


class ScriptedJev:
    """Fixed answers for tests and demos: each question gets its first option, or a set noul, with confidence 0.9."""

    def __init__(self, db: Database, settings: JevSettings, answers: Mapping[str, Mapping[str, Any]] | None = None) -> None:
        self.inner = Jev(db, settings, transport=self._transport, key="scripted")
        self.scripted = dict(answers or {})
        self.db, self.settings = db, settings

    def _transport(self, body: Mapping[str, Any], *, settings: JevSettings, key: str) -> Mapping[str, Any]:
        answers: dict[str, Any] = {}
        for qid, q in body["questions"].items():
            if qid in self.scripted:
                answers[qid] = {"type": q["type"], **self.scripted[qid]}
            elif q["type"] == "noul":
                answers[qid] = {"type": "noul", "noul": 0.1}
            elif q["type"] == "choice":
                options = list(q["criteria"])
                answers[qid] = {"type": "choice", "choice": options[0], "confidence": 0.9,
                                "probabilities": {o: (0.9 if i == 0 else 0.1 / max(1, len(options) - 1)) for i, o in enumerate(options)}}
            else:
                levels = list(q["criteria"])
                answers[qid] = {"type": "score", "score": 0.0, "confidence": 0.9, "legend": {str(i): l for i, l in enumerate(levels)},
                                "probabilities": {str(i): (1.0 if i == 0 else 0.0) for i in range(len(levels))}}
        return {"model": "jev-scripted", "answers": answers, "usage": {"input_tokens": len(json.dumps(body)) // 4, "output_tokens": 0}}

    def evaluate(self, *args: Any, **kwargs: Any) -> Evaluation:
        return self.inner.evaluate(*args, **kwargs)

    def acted(self, call_id: str, what: Mapping[str, Any]) -> None:
        self.inner.acted(call_id, what)


def build_jev(db: Database, config_dir: Path, models: Any, *, scripted: bool = False) -> Jev | ScriptedJev:
    """The gate client a review or a command uses: scripted beside the scripted model client, real otherwise."""
    settings = load_settings(config_dir, getattr(models, "prices", None))
    if scripted:
        return ScriptedJev(db, settings)
    return Jev(db, settings)
