"""Model providers behind one seam.

Every model call in the system already goes through `govern.llm.LLMClient`, which speaks the
Anthropic Messages shape: system blocks, content blocks, tool_use and tool_result. Rather than
teach the rest of the system a second dialect, this module translates at the edge. Anthropic is
called natively. Everything else (OpenAI, the Hugging Face router, vLLM, TGI, Ollama, a
customer's own gateway) speaks the OpenAI chat completions API, so one translator covers them.

A model is referred to as "<provider>:<model>"; a bare id means anthropic, which is what every
existing run has pinned. Keys are read from the worker's environment and never stored.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Mapping

import yaml

from govern.config import ConfigError

DEFAULT_PROVIDER = "anthropic"
Transport = Callable[[str, Mapping[str, str], Mapping[str, Any]], Mapping[str, Any]]


class ProviderUnavailable(RuntimeError):
    """The provider a model needs cannot be reached from this worker, usually for want of a key."""


class ProviderError(RuntimeError):
    """The provider answered with an error. `status_code` decides whether it is worth retrying."""

    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(f"{status_code}: {message}")
        self.status_code = status_code


@dataclass(frozen=True)
class ProviderSpec:
    name: str
    kind: str                                  # anthropic | openai_compatible
    api_key_env: str
    base_url: str | None = None
    max_tokens_param: str = "max_tokens"
    key_optional: bool = False


def split_model(ref: str) -> tuple[str, str]:
    """("openai", "gpt-4.1") from "openai:gpt-4.1". Only the first colon splits: model ids may contain more."""
    provider, sep, model = ref.partition(":")
    return (provider, model) if sep and "/" not in provider else (DEFAULT_PROVIDER, ref)


def load_providers(config_dir: Path) -> dict[str, ProviderSpec]:
    path = Path(config_dir) / "providers.yaml"
    if not path.is_file():
        raise ConfigError(f"missing config file: providers.yaml (looked in {config_dir})")
    out = {}
    for name, raw in ((yaml.safe_load(path.read_text()) or {}).get("providers") or {}).items():
        if raw.get("kind") not in ("anthropic", "openai_compatible"):
            raise ConfigError(f"providers.yaml: {name} has unknown kind {raw.get('kind')!r}")
        if raw["kind"] == "openai_compatible" and not raw.get("base_url"):
            raise ConfigError(f"providers.yaml: {name} needs a base_url")
        out[name] = ProviderSpec(name=name, kind=raw["kind"], api_key_env=str(raw["api_key_env"]),
                                 base_url=raw.get("base_url"), max_tokens_param=raw.get("max_tokens_param", "max_tokens"),
                                 key_optional=bool(raw.get("key_optional", False)))
    return out


# ---- Anthropic Messages -> chat completions ---------------------------------


def _text_of(content: Any) -> str:
    if isinstance(content, str):
        return content
    return "\n".join(str(b.get("text", "")) if isinstance(b, Mapping) else str(b) for b in content or ())


def _turns(message: Mapping[str, Any]) -> list[dict[str, Any]]:
    role, content = message["role"], message["content"]
    if isinstance(content, str):
        return [{"role": role, "content": content}]
    text = "\n".join(b["text"] for b in content if b.get("type") == "text" and b.get("text"))
    if role == "assistant":
        calls = [{"id": b["id"], "type": "function",
                  "function": {"name": b["name"], "arguments": json.dumps(b.get("input") or {})}}
                 for b in content if b.get("type") == "tool_use"]
        return [{"role": "assistant", "content": text or None, **({"tool_calls": calls} if calls else {})}]
    # Each result must directly follow the assistant message that asked for it, so they go first.
    results = [{"role": "tool", "tool_call_id": b["tool_use_id"], "content": _text_of(b.get("content"))}
               for b in content if b.get("type") == "tool_result"]
    return results + ([{"role": "user", "content": text}] if text else [])


def to_chat_request(params: Mapping[str, Any], *, max_tokens_param: str = "max_tokens") -> dict[str, Any]:
    """Thinking blocks, cache markers and effort hints have no counterpart and are dropped."""
    messages: list[dict[str, Any]] = []
    system = params.get("system")
    if system:
        messages.append({"role": "system", "content": system if isinstance(system, str)
                         else "\n\n".join(b["text"] for b in system if b.get("text"))})
    for message in params["messages"]:
        messages.extend(_turns(message))
    body: dict[str, Any] = {"model": params["model"], "messages": messages, max_tokens_param: params["max_tokens"]}
    if params.get("tools"):
        body["tools"] = [{"type": "function", "function": {"name": t["name"], "description": t.get("description", ""),
                                                           "parameters": t.get("input_schema") or {"type": "object", "properties": {}}}}
                         for t in params["tools"]]
    choice = params.get("tool_choice")
    if choice:
        kind = choice.get("type")
        body["tool_choice"] = ({"type": "function", "function": {"name": choice["name"]}} if kind == "tool"
                               else "required" if kind == "any" else "none" if kind == "none" else "auto")
    if params.get("stop_sequences"):
        body["stop"] = list(params["stop_sequences"])
    return body


# ---- chat completions -> Anthropic Messages ---------------------------------


@dataclass(frozen=True)
class Block:
    type: str
    text: str = ""
    id: str = ""
    name: str = ""
    input: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_input_tokens: int = 0
    cache_creation_input_tokens: int = 0


@dataclass(frozen=True)
class CompatMessage:
    """Enough of an Anthropic Message for LLMClient to log and parse it like any other."""

    content: tuple[Block, ...]
    stop_reason: str | None
    usage: Usage
    raw: Mapping[str, Any]

    def model_dump(self, mode: str = "json") -> dict[str, Any]:     # noqa: ARG002 - mirrors the SDK's signature
        return dict(self.raw)


_STOP = {"stop": "end_turn", "length": "max_tokens", "tool_calls": "tool_use", "function_call": "tool_use"}


def from_chat_response(reply: Mapping[str, Any]) -> CompatMessage:
    choice = (reply.get("choices") or [{}])[0]
    message = choice.get("message") or {}
    blocks: list[Block] = []
    if message.get("content"):
        blocks.append(Block(type="text", text=_text_of(message["content"])))
    for call in message.get("tool_calls") or ():
        fn = call.get("function") or {}
        try:
            arguments = json.loads(fn.get("arguments") or "{}")
            arguments = arguments if isinstance(arguments, dict) else {"_unparsed_arguments": fn.get("arguments")}
        except (TypeError, ValueError):
            # The tool layer reports this back to the model as an invalid submission, which it can
            # correct. Raising here would fail the whole turn over one malformed argument string.
            arguments = {"_unparsed_arguments": fn.get("arguments")}
        blocks.append(Block(type="tool_use", id=str(call.get("id", "")), name=str(fn.get("name", "")), input=arguments))
    usage = reply.get("usage") or {}
    cached = int((usage.get("prompt_tokens_details") or {}).get("cached_tokens") or 0)
    return CompatMessage(
        content=tuple(blocks), stop_reason=_STOP.get(choice.get("finish_reason"), choice.get("finish_reason")),
        usage=Usage(input_tokens=max(int(usage.get("prompt_tokens") or 0) - cached, 0),
                    output_tokens=int(usage.get("completion_tokens") or 0), cache_read_input_tokens=cached),
        raw=reply)


# ---- clients ----------------------------------------------------------------


def _post(url: str, headers: Mapping[str, str], body: Mapping[str, Any]) -> Mapping[str, Any]:
    request = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                     headers={"Content-Type": "application/json", **headers})
    try:
        with urllib.request.urlopen(request, timeout=300) as response:       # noqa: S310 - url comes from providers.yaml
            return json.loads(response.read())
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")[:500]
        raise ProviderError(error.code, detail) from error
    except urllib.error.URLError as error:
        raise ProviderError(503, f"could not reach {url}: {error.reason}") from error


class _Messages:
    def __init__(self, spec: ProviderSpec, key: str | None, transport: Transport) -> None:
        self._spec, self._key, self._transport = spec, key, transport

    def create(self, **params: Any) -> CompatMessage:
        headers = {"Authorization": f"Bearer {self._key}"} if self._key else {}
        body = to_chat_request(params, max_tokens_param=self._spec.max_tokens_param)
        return from_chat_response(self._transport(f"{self._spec.base_url.rstrip('/')}/chat/completions", headers, body))


class OpenAICompatClient:
    """Looks like the Anthropic SDK client where LLMClient touches it: `client.messages.create(**params)`."""

    def __init__(self, spec: ProviderSpec, key: str | None, transport: Transport = _post) -> None:
        self.messages = _Messages(spec, key, transport)


class Registry:
    def __init__(self, specs: Mapping[str, ProviderSpec], *, transport: Transport = _post,
                 env: Mapping[str, str] | None = None) -> None:
        self._specs, self._transport, self._env = dict(specs), transport, env
        self._clients: dict[str, Any] = {}

    def _getenv(self, name: str) -> str | None:
        return (self._env if self._env is not None else os.environ).get(name) or None

    def spec(self, provider: str) -> ProviderSpec:
        if provider not in self._specs:
            raise ProviderUnavailable(f"no provider named {provider!r} in providers.yaml")
        spec = self._specs[provider]
        override = self._getenv(f"{provider.upper()}_BASE_URL")
        return ProviderSpec(**{**spec.__dict__, "base_url": override}) if override else spec

    def available(self, model_ref: str) -> bool:
        provider, _ = split_model(model_ref)
        if provider not in self._specs:
            return False
        spec = self._specs[provider]
        return spec.key_optional or self._getenv(spec.api_key_env) is not None

    def wire_model(self, model_ref: str) -> str:
        """The id the provider is sent: ours without the prefix, or <NAME>_MODEL for a self-hosted server."""
        provider, model = split_model(model_ref)
        return self._getenv(f"{provider.upper()}_MODEL") or model

    def client_for(self, model_ref: str) -> Any:
        provider, _ = split_model(model_ref)
        spec = self.spec(provider)
        key = self._getenv(spec.api_key_env)
        if key is None and not spec.key_optional:
            raise ProviderUnavailable(f"{model_ref} needs {spec.api_key_env}, which is not set on the worker")
        if provider not in self._clients:
            if spec.kind == "anthropic":
                import anthropic
                self._clients[provider] = anthropic.Anthropic(api_key=key, max_retries=0)
            else:
                self._clients[provider] = OpenAICompatClient(spec, key, self._transport)
        return self._clients[provider]


def publish_catalog(db: Any, models: Any, registry: Registry) -> None:
    """Tell the dashboard what can be offered. It cannot read config/ or the worker's environment,
    so without this it could not know which providers have a key."""
    from govern.db import utc_now_iso
    db.execute("DELETE FROM model_catalog")
    for model in models.catalog:
        price = models.prices[model.id]
        db.insert("model_catalog", {"model_id": model.id, "label": model.label, "provider": model.provider,
                                    "available": registry.available(model.id), "input_price": price.input,
                                    "output_price": price.output, "updated_at": utc_now_iso()})
