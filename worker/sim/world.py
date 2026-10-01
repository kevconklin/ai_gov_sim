"""Loads the static world: banks, seats, personas, universe, and engine/event/turnover parameters."""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any, Mapping

import yaml

from govern.config import ConfigError

REPO_ROOT = Path(os.environ.get("SIM_REPO_ROOT") or Path(__file__).resolve().parents[2])
DEFAULT_CONFIG_DIR = REPO_ROOT / "config"


@dataclass(frozen=True)
class Seat:
    seat_id: str
    title: str
    default_stance: float
    chair: bool


@dataclass(frozen=True)
class Bank:
    bank_id: str
    name: str
    condition: str
    risk_appetite: str
    stance_shift: float


@dataclass(frozen=True)
class Persona:
    seat: str
    name: str
    title: str
    email: str
    stance_baseline: float
    body: str
    path: str                     # relative to the config dir

    @property
    def first_name(self) -> str:
        return self.name.split()[0]


@dataclass(frozen=True)
class World:
    config_dir: Path
    start_month: str
    seats: Mapping[str, Seat]
    banks: Mapping[str, Bank]
    universe: Mapping[str, Any]
    news_seeds: tuple[Mapping[str, Any], ...]
    engine_params: Mapping[str, Any]
    events: Mapping[str, Any]
    turnover: Mapping[str, Any]
    bank_profile: Mapping[str, Any]
    rulebook: str

    @property
    def chair_seat(self) -> str:
        return next(s.seat_id for s in self.seats.values() if s.chair)

    def persona(self, bank_id: str, seat: str, *, replacement: bool = False) -> Persona:
        sub = f"personas/{bank_id}/replacements/{seat}.md" if replacement else f"personas/{bank_id}/{seat}.md"
        return load_persona(self.config_dir, sub)

    def has_replacement(self, bank_id: str, seat: str) -> bool:
        return (self.config_dir / f"personas/{bank_id}/replacements/{seat}.md").is_file()

    def bank_universe(self, bank_id: str) -> Mapping[str, Any]:
        return self.universe.get("banks", {}).get(bank_id, {})

    def config_hash(self) -> str:
        digest = hashlib.sha256()
        for path in sorted(self.config_dir.rglob("*")):
            if path.is_file():
                digest.update(str(path.relative_to(self.config_dir)).encode())
                digest.update(path.read_bytes())
        return digest.hexdigest()[:16]


def _yaml(path: Path, *, required: bool = True) -> Any:
    if not path.is_file():
        if required:
            raise ConfigError(f"missing config file: {path}")
        return {}
    return yaml.safe_load(path.read_text()) or {}


def load_persona(config_dir: Path, relative_path: str) -> Persona:
    path = config_dir / relative_path
    if not path.is_file():
        raise ConfigError(f"missing persona file: {relative_path}")
    text = path.read_text()
    if not text.startswith("---"):
        raise ConfigError(f"persona file lacks front matter: {relative_path}")
    _, front, body = text.split("---", 2)
    meta = yaml.safe_load(front) or {}
    missing = [k for k in ("name", "seat", "title", "email", "stance_baseline") if k not in meta]
    if missing:
        raise ConfigError(f"persona {relative_path} missing fields: {missing}")
    stance = float(meta["stance_baseline"])
    if not 1.0 <= stance <= 5.0:
        raise ConfigError(f"persona {relative_path} stance_baseline must be within 1..5")
    return Persona(seat=meta["seat"], name=meta["name"], title=meta["title"], email=meta["email"],
                   stance_baseline=stance, body=body.strip(), path=relative_path)


def load_world(config_dir: Path = DEFAULT_CONFIG_DIR) -> World:
    config_dir = Path(config_dir)
    banks_cfg = _yaml(config_dir / "banks.yaml")
    seats = {
        seat_id: Seat(seat_id, s["title"], float(s["stance"]), bool(s.get("chair", False)))
        for seat_id, s in banks_cfg["seats"].items()
    }
    if sum(s.chair for s in seats.values()) != 1:
        raise ConfigError("banks.yaml must mark exactly one chair seat")
    banks = {}
    for bank_id, b in banks_cfg["banks"].items():
        appetite_path = config_dir / b["risk_appetite_file"]
        if not appetite_path.is_file():
            raise ConfigError(f"missing risk appetite statement: {appetite_path}")
        banks[bank_id] = Bank(bank_id, b["name"], b["condition"], appetite_path.read_text().strip(),
                              float(b["stance_shift"]))
    rulebook_path = config_dir / "regulator" / "rulebook.md"
    return World(
        config_dir=config_dir,
        start_month=str(banks_cfg["start_month"]),
        seats=MappingProxyType(seats),
        banks=MappingProxyType(banks),
        universe=MappingProxyType(_yaml(config_dir / "universe" / "universe.yaml", required=False)),
        news_seeds=tuple(_yaml(config_dir / "universe" / "news_seeds.yaml", required=False) or ()),
        engine_params=MappingProxyType(_yaml(config_dir / "engine_params.yaml")),
        events=MappingProxyType(_yaml(config_dir / "events.yaml")),
        turnover=MappingProxyType(_yaml(config_dir / "turnover.yaml")),
        bank_profile=MappingProxyType(_yaml(config_dir / "bank_profile.yaml")),
        rulebook=rulebook_path.read_text() if rulebook_path.is_file() else "",
    )
