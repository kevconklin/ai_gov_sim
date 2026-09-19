"""Shared handles for one workspace, plus the small typed reads a review needs.

A review needs to know whose committee it is: the organisation's name, what its board has said
about risk, a few facts, which seats exist and who chairs. It does not need to know whether that
organisation is real. `OrgProfile` is that seam. A customer workspace stores one; the simulation
builds one from its fictional bank and hands it over through the same door.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Mapping

from govern.config import Config
from govern.db import Database
from govern.llm import LLMClient
from govern.policy import PolicyRepo


@dataclass(frozen=True)
class Agent:
    agent_id: str
    seat: str
    name: str
    title: str
    persona_file: str
    stance_baseline: float
    active_from: str
    persona_text: str | None = None      # set when the committee is data rather than files

    @classmethod
    def from_row(cls, row: Mapping[str, Any]) -> "Agent":
        text = row["persona_text"] if "persona_text" in row.keys() else None
        return cls(row["agent_id"], row["seat"], row["name"], row["title"], row["persona_file"],
                   float(row["stance_baseline"]), row["active_from"], text)


@dataclass(frozen=True)
class OrgProfile:
    """What a committee member is told about the organisation they serve."""

    name: str
    risk_appetite: str
    facts: str
    seats: tuple[str, ...]              # display and speaking order
    chair_seat: str
    disclosed: bool = True              # members are told they are AI advisers; the simulation says otherwise


class NoOrgProfile(LookupError):
    """The workspace has no organisation profile and nothing else can supply one."""


@dataclass(frozen=True)
class ReviewContext:
    db: Database
    llm: LLMClient
    config: Config
    run: Mapping[str, Any]
    data_dir: Path
    budget_ok: Callable[[str], bool] = field(default=lambda month: True)

    @property
    def run_id(self) -> str:
        return self.run["run_id"]

    @property
    def org(self) -> OrgProfile:
        profile = load_org_profile(self.db, self.run_id)
        if profile is None:
            raise NoOrgProfile(f"workspace {self.run_id} has no organisation profile")
        return profile

    def persona_body(self, agent: Agent) -> str:
        if not agent.persona_text:
            raise NoOrgProfile(f"{agent.agent_id} has no persona text")
        return agent.persona_text

    @property
    def policy_repo(self) -> PolicyRepo:
        return PolicyRepo(self.data_dir / "policies" / self.run_id / self.run["bank_id"])

    def budget(self, *path: str) -> Any:
        node: Any = self.config.budget.raw
        for key in path:
            node = node[key]
        return node

    def active_agents(self) -> list[Agent]:
        order = list(self.org.seats)
        rows = self.db.fetch_all("SELECT * FROM agents WHERE run_id = ? AND active_to IS NULL", (self.run_id,))
        return sorted((Agent.from_row(r) for r in rows), key=lambda a: order.index(a.seat))

    def chair(self) -> Agent:
        chair_seat = self.org.chair_seat
        return next(a for a in self.active_agents() if a.seat == chair_seat)


def load_org_profile(db: Database, run_id: str) -> OrgProfile | None:
    row = db.fetch_one("SELECT * FROM org_profiles WHERE run_id = ?", (run_id,))
    if row is None:
        return None
    return OrgProfile(name=row["name"], risk_appetite=row["risk_appetite"], facts=_about(row),
                      seats=tuple(json.loads(row["seats"])), chair_seat=row["chair_seat"], disclosed=True)


def _about(row: Mapping[str, Any]) -> str:
    """Everything the organisation has said about itself, as the committee reads it."""
    from govern.settings import FRAMEWORKS
    keys = row.keys()
    get = lambda k: (row[k] if k in keys else None) or ""      # noqa: E731 - columns added by a later migration
    parts = [row["facts"]]
    if get("framework") and get("framework") != "none":
        parts.append(f"Control framework: {FRAMEWORKS.get(get('framework'), get('framework'))}. "
                     "Tie concerns and conditions to it where you can.")
    for key, label in (("business_goals", "Business goals"), ("ai_tools", "AI already in use"),
                       ("ai_landscape", "What is happening around the organisation")):
        if get(key):
            parts.append(f"{label}: {get(key)}")
    return "\n\n".join(parts)


def display_id(scoped_id: str) -> str:
    return scoped_id.rsplit("/", 1)[-1]


def next_display_id(db: Database, run_id: str, table: str, id_column: str, prefix: str) -> str:
    row = db.fetch_one(f"SELECT COUNT(*) AS n FROM {table} WHERE run_id = ?", (run_id,))
    return f"{prefix}-{row['n'] + 1:03d}"
