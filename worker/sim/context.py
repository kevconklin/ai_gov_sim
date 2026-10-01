"""The simulation's context: a review context whose organisation is a fictional bank."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from govern.context import Agent, OrgProfile, ReviewContext, display_id, load_org_profile, next_display_id  # noqa: F401
from sim.engine.rng import RNG
from sim.world import Bank, World, load_persona


def bank_facts(name: str, facts: Any) -> str:
    if not facts:
        return f"{name} is a state-chartered commercial bank and Federal Reserve member headquartered in the Midwest."
    keys = [("legal_name", "Legal name"), ("hq_address", "Headquarters"), ("total_assets_usd", "Total assets"),
            ("employees", "Employees"), ("branches", "Branches"), ("customers", "Customers")]
    lines = []
    for key, label in keys:
        if key in facts:
            value = facts[key]
            lines.append(f"- {label}: ${value:,.0f}" if key == "total_assets_usd" and isinstance(value, (int, float))
                         else f"- {label}: {value:,}" if isinstance(value, int) else f"- {label}: {value}")
    return "\n".join(lines)


@dataclass(frozen=True)
class RunContext(ReviewContext):
    world: World | None = None

    @property
    def bank(self) -> Bank:
        return self.world.banks[self.run["bank_id"]]

    @property
    def rng(self) -> RNG:
        return RNG(self.db, self.run_id, int(self.run["seed"]))

    @property
    def org(self) -> OrgProfile:
        """A stored profile wins; otherwise the fictional bank stands in, undisclosed (SPEC 7)."""
        stored = load_org_profile(self.db, self.run_id)
        if stored is not None:
            return stored
        bank = self.bank
        return OrgProfile(name=bank.name, risk_appetite=bank.risk_appetite,
                          facts=bank_facts(bank.name, self.world.bank_universe(self.run["bank_id"])),
                          seats=tuple(self.world.seats), chair_seat=self.world.chair_seat, disclosed=False)

    def persona_body(self, agent: Agent) -> str:
        if agent.persona_text:
            return agent.persona_text
        return load_persona(self.world.config_dir, agent.persona_file).body
