from __future__ import annotations

import pytest

from govern.pricing import TokenUsage, compute_cost


def test_standard_call_cost(config):
    usage = TokenUsage(input_tokens=1_000_000, output_tokens=1_000_000)
    assert compute_cost(config.models, "claude-sonnet-5", usage, batch=False) == pytest.approx(12.0)


def test_cache_read_and_write_rates(config):
    usage = TokenUsage(input_tokens=0, output_tokens=0, cache_read_tokens=1_000_000, cache_write_tokens=1_000_000)
    # read 0.10 * $2 + write 1.25 * $2
    assert compute_cost(config.models, "claude-sonnet-5", usage, batch=False) == pytest.approx(0.2 + 2.5)


def test_batch_discount_stacks_with_caching(config):
    usage = TokenUsage(input_tokens=1_000_000, output_tokens=0, cache_read_tokens=1_000_000)
    standard = compute_cost(config.models, "claude-haiku-4-5-20251001", usage, batch=False)
    batched = compute_cost(config.models, "claude-haiku-4-5-20251001", usage, batch=True)
    assert standard == pytest.approx(1.1)
    assert batched == pytest.approx(0.55)


def test_unknown_model_fails_loudly(config):
    with pytest.raises(KeyError, match="no price"):
        compute_cost(config.models, "claude-unknown", TokenUsage(1, 1), batch=False)
