"""Any model behind the same seam: Anthropic natively, everything else through one OpenAI-compatible translator."""

from __future__ import annotations

import json

import pytest

from conftest import REPO_ROOT
from govern import providers
from govern.config import load_config
from govern.llm import LLMClient, LLMRequest

CONFIG = REPO_ROOT / "config"

TOOL = {"name": "cast_vote", "description": "Cast a ballot.",
        "input_schema": {"type": "object", "properties": {"vote": {"type": "string"}}, "required": ["vote"]}}


# ---- translating a request -------------------------------------------------


def test_system_blocks_tools_and_a_forced_tool_translate():
    params = {"model": "gpt-x", "max_tokens": 300, "stop_sequences": ["END"],
              "system": [{"type": "text", "text": "You are the CRO.", "cache_control": {"type": "ephemeral"}}, {"type": "text", "text": "Pre-read."}],
              "messages": [{"role": "user", "content": "Vote now."}],
              "tools": [TOOL], "tool_choice": {"type": "tool", "name": "cast_vote"}, "output_config": {"effort": "low"}}
    body = providers.to_chat_request(params, max_tokens_param="max_completion_tokens")
    assert body["messages"][0] == {"role": "system", "content": "You are the CRO.\n\nPre-read."}
    assert body["messages"][1] == {"role": "user", "content": "Vote now."}
    assert body["tools"][0] == {"type": "function", "function": {"name": "cast_vote", "description": "Cast a ballot.", "parameters": TOOL["input_schema"]}}
    assert body["tool_choice"] == {"type": "function", "function": {"name": "cast_vote"}}
    assert body["max_completion_tokens"] == 300 and "max_tokens" not in body
    assert body["stop"] == ["END"]
    assert "output_config" not in body and "cache_control" not in json.dumps(body)


def test_a_tool_round_trip_keeps_its_order():
    """The provider requires each tool result to follow the assistant message that asked for it."""
    params = {"model": "m", "max_tokens": 10, "messages": [
        {"role": "user", "content": "Go."},
        {"role": "assistant", "content": [{"type": "thinking", "thinking": "hm"}, {"type": "text", "text": "Reading."},
                                          {"type": "tool_use", "id": "t1", "name": "read_policy", "input": {"section": "Scope"}}]},
        {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t1", "content": "Scope text", "is_error": False},
                                     {"type": "text", "text": "Continue."}]},
    ]}
    messages = providers.to_chat_request(params)["messages"]
    assert [m["role"] for m in messages] == ["user", "assistant", "tool", "user"]
    assert messages[1]["tool_calls"][0] == {"id": "t1", "type": "function", "function": {"name": "read_policy", "arguments": '{"section": "Scope"}'}}
    assert messages[2] == {"role": "tool", "tool_call_id": "t1", "content": "Scope text"}
    assert messages[3]["content"] == "Continue."


def test_any_tool_means_required():
    body = providers.to_chat_request({"model": "m", "max_tokens": 5, "messages": [{"role": "user", "content": "x"}],
                                      "tools": [TOOL], "tool_choice": {"type": "any"}})
    assert body["tool_choice"] == "required" and body["max_tokens"] == 5


# ---- translating a response ------------------------------------------------


def test_a_reply_with_a_tool_call_reads_like_any_other():
    reply = {"model": "gpt-x", "choices": [{"finish_reason": "tool_calls", "message": {"content": "Voting.", "tool_calls": [
        {"id": "c1", "type": "function", "function": {"name": "cast_vote", "arguments": '{"vote": "no"}'}}]}}],
        "usage": {"prompt_tokens": 120, "completion_tokens": 30, "prompt_tokens_details": {"cached_tokens": 100}}}
    message = providers.from_chat_response(reply)
    assert [b.type for b in message.content] == ["text", "tool_use"]
    assert message.content[1].name == "cast_vote" and message.content[1].input == {"vote": "no"}
    assert message.stop_reason == "tool_use"
    assert (message.usage.input_tokens, message.usage.cache_read_input_tokens, message.usage.output_tokens) == (20, 100, 30)
    assert message.model_dump(mode="json")["choices"][0]["finish_reason"] == "tool_calls"


def test_arguments_that_are_not_json_reach_the_tool_as_an_error_not_a_crash():
    reply = {"choices": [{"finish_reason": "tool_calls", "message": {"content": None, "tool_calls": [
        {"id": "c1", "type": "function", "function": {"name": "cast_vote", "arguments": "{vote: no"}}]}}], "usage": {}}
    block = providers.from_chat_response(reply).content[0]
    assert block.input == {"_unparsed_arguments": "{vote: no"}


def test_running_out_of_tokens_is_reported_as_such():
    reply = {"choices": [{"finish_reason": "length", "message": {"content": "Trunc"}}], "usage": {"prompt_tokens": 1, "completion_tokens": 1}}
    assert providers.from_chat_response(reply).stop_reason == "max_tokens"


# ---- choosing a provider ---------------------------------------------------


def test_a_model_reference_names_its_provider_and_a_bare_one_is_anthropic():
    assert providers.split_model("openai:gpt-4.1") == ("openai", "gpt-4.1")
    assert providers.split_model("huggingface:meta-llama/Llama-3.3-70B-Instruct") == ("huggingface", "meta-llama/Llama-3.3-70B-Instruct")
    assert providers.split_model("claude-sonnet-5") == ("anthropic", "claude-sonnet-5")


def test_the_shipped_providers_cover_openai_hugging_face_and_a_local_endpoint():
    specs = providers.load_providers(CONFIG)
    assert {"anthropic", "openai", "huggingface", "local"} <= set(specs)
    assert specs["huggingface"].kind == "openai_compatible" and specs["huggingface"].api_key_env == "HF_TOKEN"


def test_a_missing_key_is_named_before_any_call_is_made(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    registry = providers.Registry(providers.load_providers(CONFIG))
    assert registry.available("openai:gpt-4.1") is False
    with pytest.raises(providers.ProviderUnavailable, match="OPENAI_API_KEY"):
        registry.client_for("openai:gpt-4.1")


def test_a_base_url_can_be_pointed_elsewhere_by_environment(monkeypatch):
    monkeypatch.setenv("LOCAL_BASE_URL", "http://gpu-box:8000/v1")
    assert providers.Registry(providers.load_providers(CONFIG)).spec("local").base_url == "http://gpu-box:8000/v1"


# ---- through the client ----------------------------------------------------


class FakeTransport:
    def __init__(self):
        self.sent = []

    def __call__(self, url, headers, body):
        self.sent.append((url, headers, body))
        return {"model": body["model"], "choices": [{"finish_reason": "stop", "message": {"content": "I would defer."}}],
                "usage": {"prompt_tokens": 50, "completion_tokens": 10}}


def test_a_call_is_routed_by_the_models_provider_priced_and_logged(db, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    transport = FakeTransport()
    config = load_config(CONFIG)
    client = LLMClient(db=db, config=config, sleep=lambda s: None,
                       registry=providers.Registry(providers.load_providers(CONFIG), transport=transport))
    result = client.call(LLMRequest(role="committee", purpose="committee_turn", max_tokens=50, model="openai:gpt-4.1",
                                    messages=({"role": "user", "content": "Speak."},)))
    url, headers, body = transport.sent[0]
    assert url == "https://api.openai.com/v1/chat/completions" and headers["Authorization"] == "Bearer sk-test"
    assert body["model"] == "gpt-4.1"                     # the provider never sees our prefix
    assert result.text == "I would defer." and result.model == "openai:gpt-4.1"
    row = db.fetch_one("SELECT model, cost_usd FROM llm_calls WHERE call_id = ?", (result.call_id,))
    assert row["model"] == "openai:gpt-4.1" and row["cost_usd"] > 0


def test_every_model_on_offer_is_priced_so_the_budget_can_be_enforced():
    models = load_config(CONFIG).models
    assert models.catalog and all(m.id in models.prices for m in models.catalog)
    assert {m.provider for m in models.catalog} >= {"anthropic", "openai", "huggingface"}
