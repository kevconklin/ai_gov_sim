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


@dataclass(frozen=True)
class AgendaPriorityConfig:
    """Ranking for the candidate list a human picks an agenda from (config/agenda_priority.yaml)."""

    escalate_after: int
    count: str
    counts_as_deferral: tuple[str, ...]
    escalation: str
    age_days_full_at: int
    risk_tier_factors: Mapping[str, float]
    weights: Mapping[str, int]


WEIGHT_KEYS = ("age_days", "risk_tier", "control_gap", "blocking", "deferral")


def _load_agenda_priority(data: Mapping[str, Any]) -> AgendaPriorityConfig:
    source = "agenda_priority.yaml"
    deferral = _require(data, "deferral", source)
    weights = {k: int(v) for k, v in _require(data, "weights", source).items()}
    missing = sorted(set(WEIGHT_KEYS) - set(weights))
    if missing:
        raise ConfigError(f"{source} is missing weights: {', '.join(missing)}")
    if sum(weights.values()) != 100:
        raise ConfigError(f"{source} weights must sum to 100, got {sum(weights.values())}")
    escalate_after = int(_require(deferral, "escalate_after", f"{source} deferral"))
    if escalate_after < 1:
        raise ConfigError(f"{source} deferral.escalate_after must be at least 1")
    if deferral.get("count") not in ("cumulative", "consecutive"):
        raise ConfigError(f"{source} deferral.count must be 'cumulative' or 'consecutive'")
    return AgendaPriorityConfig(
        escalate_after=escalate_after,
        count=deferral["count"],
        counts_as_deferral=tuple(_require(deferral, "counts_as_deferral", f"{source} deferral")),
        escalation=str(_require(deferral, "escalation", f"{source} deferral")),
        age_days_full_at=int(_require(data, "age_days_full_at", source)),
        risk_tier_factors=MappingProxyType({k: float(v) for k, v in _require(data, "risk_tier_factors", source).items()}),
        weights=MappingProxyType(weights),
    )


def load_agenda_priority(config_dir: Path) -> AgendaPriorityConfig:
    return _load_agenda_priority(_read_yaml(Path(config_dir) / "agenda_priority.yaml"))


@dataclass(frozen=True)
class AttestationConfig:
    """The human oversight gate (config/attestation.yaml)."""

    outcomes: tuple[str, ...]
    require_dissent_response_for_tiers: tuple[str, ...]
    min_rationale_chars: int


def _load_attestation(data: Mapping[str, Any]) -> AttestationConfig:
    source = "attestation.yaml"
    outcomes = tuple(_require(data, "outcomes", source))
    if "deferred" not in outcomes:
        raise ConfigError(f"{source} outcomes must include 'deferred'; a human must be able to table an item")
    min_chars = int(_require(data, "min_rationale_chars", source))
    if min_chars < 1:
        raise ConfigError(f"{source} min_rationale_chars must be at least 1; a blank rationale is not oversight")
    return AttestationConfig(
        outcomes=outcomes,
        require_dissent_response_for_tiers=tuple(_require(data, "require_dissent_response_for_tiers", source)),
        min_rationale_chars=min_chars,
    )


def load_attestation(config_dir: Path) -> AttestationConfig:
    return _load_attestation(_read_yaml(Path(config_dir) / "attestation.yaml"))
