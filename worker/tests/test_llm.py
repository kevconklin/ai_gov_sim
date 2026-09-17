from __future__ import annotations

import pytest

from fakes import FakeClient, make_message, make_status_error
from sim.llm import LLMCallFailed, LLMClient, LLMRequest


def _request(**overrides):
    base = dict(
        role="committee",
        purpose="committee_turn",
        run_id="run1",
        agent_id="agent_cfo",
        sim_month="2027-01",
        system_fixed=("You are the CFO of Calder Ridge Bank.", "Board statement."),
        system_dynamic=("Current packet.",),
        messages=({"role": "user", "content": "Agenda item 1 is open for discussion."},),
        max_tokens=400,
        temperature=0.7,
    )
    base.update(overrides)
    return LLMRequest(**base)


def _client(db, config, fake, sleeps=None):
    return LLMClient(db=db, config=config, client=fake, sleep=(sleeps.append if sleeps is not None else lambda s: None))


def test_call_logs_tokens_cost_request_and_response(db, config):
    fake = FakeClient()
    fake.messages.responses.append(make_message("I support item 1.", input_tokens=500, output_tokens=40, cache_read=2000))
    result = _client(db, config, fake).call(_request())

    assert result.text == "I support item 1."
    row = db.fetch_one("SELECT * FROM llm_calls WHERE call_id = ?", (result.call_id,))
    assert row["status"] == "ok"
    assert (row["input_tokens"], row["cached_tokens"], row["output_tokens"]) == (500, 2000, 40)
    assert row["model"] == "claude-sonnet-5"
    assert row["purpose"] == "committee_turn"
    assert row["sim_month"] == "2027-01"
    assert not row["batch"]
    expected = (500 * 2 + 2000 * 2 * 0.1 + 40 * 10) / 1_000_000
    assert row["cost_usd"] == pytest.approx(expected)
    assert result.cost_usd == pytest.approx(expected)
    request = db.loads(row["request"])
    assert request["temperature"] == 0.7 and request["max_tokens"] == 400
    assert db.loads(row["response"])["content"][0]["text"] == "I support item 1."


def test_fixed_system_blocks_get_cache_control_on_last_fixed_block_only(db, config):
    fake = FakeClient()
    fake.messages.responses.append(make_message())
    _client(db, config, fake).call(_request())

    system = fake.messages.calls[0]["system"]
    assert [b["text"] for b in system] == ["You are the CFO of Calder Ridge Bank.", "Board statement.", "Current packet."]
    assert "cache_control" not in system[0]
    assert system[1]["cache_control"] == {"type": "ephemeral"}
    assert "cache_control" not in system[2]


def test_optional_params_are_omitted_when_unset(db, config):
    fake = FakeClient()
    fake.messages.responses.append(make_message())
    _client(db, config, fake).call(_request(temperature=None, system_fixed=(), system_dynamic=()))
    params = fake.messages.calls[0]
    assert "temperature" not in params and "system" not in params and "tools" not in params


def test_tools_are_passed_and_tool_use_blocks_returned(db, config):
    fake = FakeClient()
    fake.messages.responses.append(make_message(extra_content=(
        {"type": "tool_use", "id": "toolu_1", "name": "cast_vote", "input": {"item_id": "i1", "vote": "yes"}},
    )))
    tool = {"name": "cast_vote", "description": "Vote.", "input_schema": {"type": "object"}}
    result = _client(db, config, fake).call(_request(tools=(tool,), tool_choice={"type": "any"}))

    assert fake.messages.calls[0]["tools"] == [tool]
    assert fake.messages.calls[0]["tool_choice"] == {"type": "any"}
    assert result.tool_uses == ({"id": "toolu_1", "name": "cast_vote", "input": {"item_id": "i1", "vote": "yes"}},)


def test_retryable_errors_are_logged_then_retried_with_backoff(db, config):
    fake = FakeClient()
    fake.messages.responses.extend([make_status_error(429), make_status_error(500), make_message("ok")])
    sleeps: list[float] = []
    result = _client(db, config, fake, sleeps).call(_request())

    rows = db.fetch_all("SELECT status, attempt, error FROM llm_calls ORDER BY attempt")
    assert [(r["status"], r["attempt"]) for r in rows] == [("error", 1), ("error", 2), ("ok", 3)]
    assert "RateLimitError" in rows[0]["error"]
    assert result.attempt == 3
    assert len(sleeps) == 2 and sleeps[1] > sleeps[0]


def test_non_retryable_error_is_logged_and_raised_immediately(db, config):
    fake = FakeClient()
    fake.messages.responses.append(make_status_error(400))
    with pytest.raises(LLMCallFailed):
        _client(db, config, fake).call(_request())
    rows = db.fetch_all("SELECT status FROM llm_calls")
    assert [r["status"] for r in rows] == ["error"]


def test_exhausted_retries_raise_after_logging_every_attempt(db, config):
    fake = FakeClient()
    attempts = config.budget.retries.max_attempts
    fake.messages.responses.extend([make_status_error(500)] * attempts)
    with pytest.raises(LLMCallFailed, match=str(attempts)):
        _client(db, config, fake).call(_request())
    assert db.fetch_one("SELECT COUNT(*) AS n FROM llm_calls")["n"] == attempts


def _batch_result(custom_id, message=None, error=False):
    if error:
        return {"custom_id": custom_id, "result": {"type": "errored", "error": {
            "type": "error", "error": {"type": "invalid_request_error", "message": "bad"}}}}
    return {"custom_id": custom_id, "result": {"type": "succeeded", "message": message.model_dump(mode="json")}}


def test_batch_submit_persists_then_collect_logs_each_result_at_batch_price(db, config):
    fake = FakeClient()
    llm = _client(db, config, fake)
    requests = {
        "est_effort": _request(role="estimator", purpose="estimator_effort", agent_id=None),
        "est_risk": _request(role="estimator", purpose="estimator_risk", agent_id=None),
    }
    batch_id = llm.submit_batch(requests, run_id="run1")

    sent = fake.messages.batches.created[0]
    assert {r["custom_id"] for r in sent} == {"est_effort", "est_risk"}
    assert sent[0]["params"]["system"][1]["cache_control"] == {"type": "ephemeral"}
    assert db.fetch_one("SELECT status FROM llm_batches WHERE batch_id = ?", (batch_id,))["status"] == "submitted"

    assert llm.collect_batch(batch_id) is None  # still processing

    fake.messages.batches.status_by_id[batch_id] = "ended"
    fake.messages.batches.results_by_id[batch_id] = [
        _batch_result("est_effort", make_message('{"weeks": 12}', input_tokens=1_000_000, output_tokens=0)),
        _batch_result("est_risk", error=True),
    ]
    results = llm.collect_batch(batch_id)

    assert results["est_effort"].text == '{"weeks": 12}'
    assert results["est_effort"].cost_usd == pytest.approx(1.0)  # $2/MTok input, halved
    assert results["est_risk"].ok is False
    rows = {r["custom_id"]: r for r in db.fetch_all("SELECT * FROM llm_calls WHERE batch_id = ?", (batch_id,))}
    assert rows["est_effort"]["batch"] and rows["est_effort"]["status"] == "ok"
    assert rows["est_effort"]["purpose"] == "estimator_effort"
    assert rows["est_risk"]["status"] == "error"
    assert db.fetch_one("SELECT status FROM llm_batches WHERE batch_id = ?", (batch_id,))["status"] == "collected"


def test_collect_batch_twice_does_not_double_log(db, config):
    fake = FakeClient()
    llm = _client(db, config, fake)
    batch_id = llm.submit_batch({"a": _request()}, run_id="run1")
    fake.messages.batches.status_by_id[batch_id] = "ended"
    fake.messages.batches.results_by_id[batch_id] = [_batch_result("a", make_message())]
    llm.collect_batch(batch_id)
    with pytest.raises(ValueError, match="already collected"):
        llm.collect_batch(batch_id)
    assert db.fetch_one("SELECT COUNT(*) AS n FROM llm_calls")["n"] == 1


def test_wait_for_batch_polls_until_ended(db, config):
    fake = FakeClient()
    sleeps: list[float] = []
    llm = _client(db, config, fake, sleeps)
    batch_id = llm.submit_batch({"a": _request()}, run_id="run1")
    fake.messages.batches.results_by_id[batch_id] = [_batch_result("a", make_message("done"))]

    polls = {"n": 0}
    original = fake.messages.batches.retrieve

    def retrieve(bid):
        polls["n"] += 1
        if polls["n"] >= 3:
            fake.messages.batches.status_by_id[bid] = "ended"
        return original(bid)

    fake.messages.batches.retrieve = retrieve
    results = llm.wait_for_batch(batch_id)
    assert results["a"].text == "done"
    assert sleeps == [config.budget.batch_poll_interval_seconds] * 2


def test_submit_batch_rejects_empty_and_bad_ids(db, config):
    llm = _client(db, config, FakeClient())
    with pytest.raises(ValueError):
        llm.submit_batch({}, run_id="run1")
    with pytest.raises(ValueError):
        llm.submit_batch({"has space": _request()}, run_id="run1")


def test_request_validation():
    with pytest.raises(ValueError):
        _request(max_tokens=0)
    with pytest.raises(ValueError):
        _request(messages=())


def test_collect_batch_resumes_after_crash_without_duplicate_rows(db, config):
    fake = FakeClient()
    llm = _client(db, config, fake)
    batch_id = llm.submit_batch({"a": _request(), "b": _request()}, run_id="run1")
    fake.messages.batches.status_by_id[batch_id] = "ended"
    fake.messages.batches.results_by_id[batch_id] = [
        _batch_result("a", make_message("first", input_tokens=1000, output_tokens=0)),
        _batch_result("b", make_message("second")),
    ]

    original_write = llm._write_row
    writes = {"n": 0}

    def crash_on_second_write(*args, **kwargs):
        writes["n"] += 1
        if writes["n"] == 2:
            raise RuntimeError("worker killed")
        return original_write(*args, **kwargs)

    llm._write_row = crash_on_second_write
    with pytest.raises(RuntimeError):
        llm.collect_batch(batch_id)
    llm._write_row = original_write

    results = llm.collect_batch(batch_id)
    rows = db.fetch_all("SELECT custom_id FROM llm_calls WHERE batch_id = ? ORDER BY custom_id", (batch_id,))
    assert [r["custom_id"] for r in rows] == ["a", "b"]
    assert results["a"].text == "first" and results["a"].cost_usd == pytest.approx(0.001)
    assert results["b"].text == "second"


def test_llm_calls_rejects_duplicate_batch_rows(db):
    row = {"call_id": "c1", "model": "m", "purpose": "p", "status": "ok", "attempt": 1, "batch": True,
           "batch_id": "b1", "custom_id": "x", "request": {}, "created_at": "t"}
    db.insert("llm_calls", row)
    with pytest.raises(Exception, match="UNIQUE"):
        db.insert("llm_calls", {**row, "call_id": "c2"})


def test_stop_flag_blocks_calls_and_batches(db, config):
    fake = FakeClient()
    llm = LLMClient(db=db, config=config, client=fake, sleep=lambda s: None, should_stop=lambda: True)
    from sim.llm import StopRequested
    with pytest.raises(StopRequested):
        llm.call(_request())
    with pytest.raises(StopRequested):
        llm.submit_batch({"a": _request()}, run_id="run1")
    assert fake.messages.calls == []


def test_failure_streak_callback_fires_every_three_failures(db, config):
    fake = FakeClient()
    fake.messages.responses.extend([make_status_error(500)] * config.budget.retries.max_attempts)
    streaks = []
    llm = LLMClient(db=db, config=config, client=fake, sleep=lambda s: None,
                    on_failure_streak=lambda n, d: streaks.append(n))
    with pytest.raises(LLMCallFailed):
        llm.call(_request())
    assert streaks == [3]


def test_run_pinned_model_overrides_config(db, config):
    db.insert("experiments", {"experiment_id": "e1", "name": "t", "created_at": "t"})
    db.insert("runs", {"run_id": "run1", "experiment_id": "e1", "bank_id": "tollgate", "condition": "aggressive",
                       "replicate": 1, "seed": 1, "model_versions": {"committee": "claude-opus-5"}, "config_hash": "x",
                       "start_month": "2027-01", "status": "running", "started_at": "t"})
    fake = FakeClient()
    fake.messages.responses.append(make_message())
    _client(db, config, fake).call(_request())
    assert fake.messages.calls[0]["model"] == "claude-opus-5"
