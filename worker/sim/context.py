"""Shared handles for one run, plus small typed reads used across the monthly cycle."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Mapping

from sim.config import Config
from sim.db import Database
from sim.engine.rng import RNG
from sim.llm import LLMClient
from sim.policy import PolicyRepo
from sim.world import Bank, World


@dataclass(frozen=True)
class Agent:
    agent_id: str
    seat: str
    name: str
    title: str
    persona_file: str
    stance_baseline: float
    active_from: str

    @classmethod
    def from_row(cls, row: Mapping[str, Any]) -> "Agent":
        return cls(row["agent_id"], row["seat"], row["name"], row["title"], row["persona_file"],
                   float(row["stance_baseline"]), row["active_from"])


@dataclass(frozen=True)
class RunContext:
    db: Database
    llm: LLMClient
    world: World
    config: Config
    run: Mapping[str, Any]
    data_dir: Path
    budget_ok: Callable[[str], bool] = field(default=lambda month: True)

    @property
    def run_id(self) -> str:
        return self.run["run_id"]

    @property
    def bank(self) -> Bank:
        return self.world.banks[self.run["bank_id"]]

    @property
    def rng(self) -> RNG:
        return RNG(self.db, self.run_id, int(self.run["seed"]))

    @property
    def policy_repo(self) -> PolicyRepo:
        return PolicyRepo(self.data_dir / "policies" / self.run_id / self.run["bank_id"])

    def budget(self, *path: str) -> Any:
        node: Any = self.config.budget.raw
        for key in path:
            node = node[key]
        return node

    def active_agents(self) -> list[Agent]:
        order = list(self.world.seats)
        rows = self.db.fetch_all("SELECT * FROM agents WHERE run_id = ? AND active_to IS NULL", (self.run_id,))
        return sorted((Agent.from_row(r) for r in rows), key=lambda a: order.index(a.seat))

    def chair(self) -> Agent:
        chair_seat = self.world.chair_seat
        return next(a for a in self.active_agents() if a.seat == chair_seat)


def display_id(scoped_id: str) -> str:
    return scoped_id.rsplit("/", 1)[-1]


def next_display_id(db: Database, run_id: str, table: str, id_column: str, prefix: str) -> str:
    row = db.fetch_one(f"SELECT COUNT(*) AS n FROM {table} WHERE run_id = ?", (run_id,))
    return f"{prefix}-{row['n'] + 1:03d}"
