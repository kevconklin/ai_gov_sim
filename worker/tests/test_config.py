from __future__ import annotations

import pytest

from govern.config import ConfigError, load_config


def test_loads_pinned_models_and_retry_settings(config):
    assert config.models.model_for("committee") == "claude-sonnet-5"
    assert config.models.model_for("utility") == "claude-haiku-4-5-20251001"
    assert config.budget.retries.max_attempts >= 1


def test_unknown_role_fails_loudly(config):
    with pytest.raises(KeyError, match="no model pinned"):
        config.models.model_for("nonexistent")


def test_role_model_without_price_is_rejected(tmp_path):
    (tmp_path / "models.yaml").write_text(
        "roles: {committee: claude-x}\nprices: {}\n"
        "multipliers: {cache_write: 1.25, cache_read: 0.1, batch: 0.5}\n"
    )
    (tmp_path / "budget.yaml").write_text(
        "retries: {max_attempts: 3, base_delay_seconds: 1, max_delay_seconds: 5}\n"
        "batch: {poll_interval_seconds: 1}\n"
    )
    with pytest.raises(ConfigError, match="claude-x"):
        load_config(tmp_path)


def test_missing_file_is_config_error(tmp_path):
    with pytest.raises(ConfigError, match="models.yaml"):
        load_config(tmp_path)
