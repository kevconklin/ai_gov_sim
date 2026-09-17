"""Typed, validated loading of config/*.yaml."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any, Mapping

import yaml


class ConfigError(ValueError):
    """Raised when a config file is missing or malformed."""


@dataclass(frozen=True)
class ModelPrice:
    input: float
    output: float


@dataclass(frozen=True)
class ModelsConfig:
    roles: Mapping[str, str]
    prices: Mapping[str, ModelPrice]
    cache_write_multiplier: float
    cache_read_multiplier: float
    batch_multiplier: float

    def model_for(self, role: str) -> str:
        if role not in self.roles:
            raise KeyError(f"no model pinned for role {role!r} in models.yaml")
        return self.roles[role]


@dataclass(frozen=True)
class RetryConfig:
    max_attempts: int
    base_delay_seconds: float
    max_delay_seconds: float


@dataclass(frozen=True)
class BudgetConfig:
    retries: RetryConfig
    batch_poll_interval_seconds: float
    raw: Mapping[str, Any]


@dataclass(frozen=True)
class Config:
    models: ModelsConfig
    budget: BudgetConfig


def _read_yaml(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise ConfigError(f"missing config file: {path.name} (looked in {path.parent})")
    data = yaml.safe_load(path.read_text())
    if not isinstance(data, dict):
        raise ConfigError(f"{path.name} must contain a mapping at the top level")
    return data


def _require(data: Mapping[str, Any], key: str, source: str) -> Any:
    if key not in data:
        raise ConfigError(f"{source} is missing required key {key!r}")
    return data[key]


def _load_models(data: Mapping[str, Any]) -> ModelsConfig:
    roles = dict(_require(data, "roles", "models.yaml"))
    raw_prices = _require(data, "prices", "models.yaml") or {}
    multipliers = _require(data, "multipliers", "models.yaml")
    prices = {
        model: ModelPrice(input=float(p["input"]), output=float(p["output"]))
        for model, p in raw_prices.items()
    }
    unpriced = sorted({m for m in roles.values() if m not in prices})
    if unpriced:
        raise ConfigError(f"models.yaml pins models with no price: {', '.join(unpriced)}")
    return ModelsConfig(
        roles=MappingProxyType(roles),
        prices=MappingProxyType(prices),
        cache_write_multiplier=float(_require(multipliers, "cache_write", "models.yaml multipliers")),
        cache_read_multiplier=float(_require(multipliers, "cache_read", "models.yaml multipliers")),
        batch_multiplier=float(_require(multipliers, "batch", "models.yaml multipliers")),
    )


def _load_budget(data: Mapping[str, Any]) -> BudgetConfig:
    retries = _require(data, "retries", "budget.yaml")
    batch = _require(data, "batch", "budget.yaml")
    retry = RetryConfig(
        max_attempts=int(retries["max_attempts"]),
        base_delay_seconds=float(retries["base_delay_seconds"]),
        max_delay_seconds=float(retries["max_delay_seconds"]),
    )
    if retry.max_attempts < 1:
        raise ConfigError("budget.yaml retries.max_attempts must be at least 1")
    return BudgetConfig(
        retries=retry,
        batch_poll_interval_seconds=float(batch["poll_interval_seconds"]),
        raw=MappingProxyType(dict(data)),
    )


def load_config(config_dir: Path) -> Config:
    config_dir = Path(config_dir)
    return Config(
        models=_load_models(_read_yaml(config_dir / "models.yaml")),
        budget=_load_budget(_read_yaml(config_dir / "budget.yaml")),
    )
