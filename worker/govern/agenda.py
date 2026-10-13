"""Agenda candidates and their suggested priority.

A human convenes the committee and sets its agenda. This module only ranks the candidate
list they choose from: selecting a candidate is what creates an `AgendaItem`.

Priority is computed deterministically from logged state, never by an LLM, so "why is this
at the top of my agenda" is answerable without a model call. It is also never shown to
agents, which would anchor their positions before they had read the item.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Sequence

from govern import ids
from govern.config import AgendaPriorityConfig
from govern.context import display_id
from govern.db import Database
from govern.intake import KIND_LABELS

UNCLASSIFIED_TIER = "medium"


@dataclass(frozen=True)
class CandidateFacts:
    """The five priority signals, read from logged state."""

    age_days: int
    risk_tier: str | None
    control_gap: bool
    blocking: bool
    deferral_count: int


@dataclass(frozen=True)
class Score:
    priority: int
    reasons: tuple[str, ...]
    escalated: bool


@dataclass(frozen=True)
class AgendaCandidate:
    kind: str          # use_case | policy_edit | status_change | advisory
    ref_id: str
    title: str
    priority: int
    reasons: tuple[str, ...]
    deferral_count: int
    escalated: bool


# ---- scoring --------------------------------------------------------------


def _fraction(value: float, full_at: float) -> float:
    return min(value / full_at, 1.0) if full_at > 0 else 0.0


def score(facts: CandidateFacts, config: AgendaPriorityConfig) -> Score:
    """Rank one candidate 0-100, with the reasons that put it there."""
    weights = config.weights
    tier = facts.risk_tier or UNCLASSIFIED_TIER
    parts = (
        (_fraction(facts.age_days, config.age_days_full_at), weights["age_days"],
         f"open {facts.age_days} days"),
        (config.risk_tier_factors.get(tier, config.risk_tier_factors.get(UNCLASSIFIED_TIER, 0.5)), weights["risk_tier"],
         f"risk tier {tier}" if facts.risk_tier else "risk tier unclassified"),
        (1.0 if facts.control_gap else 0.0, weights["control_gap"], "unmet control in framework"),
        (1.0 if facts.blocking else 0.0, weights["blocking"], "blocking downstream work"),
        (_fraction(facts.deferral_count, config.escalate_after), weights["deferral"],
         f"deferred {facts.deferral_count}x"),
    )
    reasons = tuple(reason for fraction, weight, reason in parts if fraction > 0 and weight > 0)
    total = min(round(sum(fraction * weight for fraction, weight, _ in parts)), 100)

    escalated = facts.deferral_count >= config.escalate_after
    return Score(priority=100 if escalated else total, reasons=reasons, escalated=escalated)


# ---- deferrals ------------------------------------------------------------


def record_deferral(db: Database, run_id: str, *, ref_id: str, meeting_id: str, sim_month: str, reason: str) -> str:
    """Record that an item which reached the agenda was tabled.

    Only active deferrals belong here. A candidate the human never selected is a passive
    skip, not a deferral; counting those would make every low-priority item escalate on
    age alone. Passive skips register through the age signal instead.
    """
    deferral_id = ids.scoped(run_id, "deferral", ref_id, meeting_id)
    db.insert("agenda_deferrals", {
        "deferral_id": deferral_id, "run_id": run_id, "ref_id": ref_id, "meeting_id": meeting_id,
        "sim_month": sim_month, "reason": reason,
    })
    return deferral_id


def deferral_count(db: Database, run_id: str, ref_id: str) -> int:
    """Cumulative deferrals for one item. The count never resets."""
    row = db.fetch_one("SELECT COUNT(*) AS n FROM agenda_deferrals WHERE run_id = ? AND ref_id = ?", (run_id, ref_id))
    return int(row["n"]) if row else 0


# ---- candidates -----------------------------------------------------------


def _opened(when: str) -> date:
    """A full date for intake items; the first of the month for items proposed inside a meeting."""
    return date.fromisoformat(when if len(when) > 7 else f"{when}-01")


def _age_days(when: str, today: date) -> int:
    return max((today - _opened(when)).days, 0)


def _rows(db: Database, run_id: str) -> list[tuple[str, str, str, str, str | None]]:
    """(kind, ref_id, title, proposed_month, risk_tier) for every undecided item."""
    out: list[tuple[str, str, str, str, str | None]] = []
    out += [("advisory" if r["kind"] == "question" else "item", r["item_id"],
             r["title"] if r["kind"] == "question" else f"{KIND_LABELS[r['kind']]}: {r['title']}",
             r["submitted_on"], r["risk_tier"])
            for r in db.fetch_all("SELECT item_id, kind, title, submitted_on, risk_tier FROM items "
                                  "WHERE run_id = ? AND status = 'submitted' ORDER BY item_id", (run_id,))]
    out += [("use_case", r["use_case_id"], r["title"], r["proposed_month"], r["risk_tier"])
            for r in db.fetch_all("SELECT use_case_id, title, proposed_month, risk_tier FROM use_cases "
                                  "WHERE run_id = ? AND status = 'proposed' ORDER BY use_case_id", (run_id,))]
    out += [("policy_edit", r["edit_id"], f"Policy language: {r['section']}", r["sim_month"], None)
            for r in db.fetch_all("SELECT edit_id, section, sim_month FROM policy_edits "
                                  "WHERE run_id = ? AND status = 'proposed' ORDER BY edit_id", (run_id,))]
    out += [("status_change", r["change_id"], f"Change {display_id(r['use_case_id'])} to {r['new_status']}",
             r["sim_month"], None)
            for r in db.fetch_all("SELECT change_id, use_case_id, new_status, sim_month FROM status_changes "
                                  "WHERE run_id = ? AND status = 'proposed' ORDER BY change_id", (run_id,))]
    return out


def candidates(db: Database, run_id: str, config: AgendaPriorityConfig, *,
               today: str | date) -> Sequence[AgendaCandidate]:
    """Every undecided item, ranked highest first, for a human to build an agenda from.

    `control_gap` and `blocking` are always False until the framework-mapping and
    dependency subsystems land; their weights are inert rather than wrong.
    """
    now = today if isinstance(today, date) else date.fromisoformat(today)
    ranked = []
    for kind, ref_id, title, month, risk_tier in _rows(db, run_id):
        deferrals = deferral_count(db, run_id, ref_id)
        result = score(CandidateFacts(age_days=_age_days(month, now), risk_tier=risk_tier, control_gap=False,
                                      blocking=False, deferral_count=deferrals), config)
        ranked.append(AgendaCandidate(kind=kind, ref_id=ref_id, title=title, priority=result.priority,
                                      reasons=result.reasons, deferral_count=deferrals, escalated=result.escalated))
    return tuple(sorted(ranked, key=lambda c: (-c.priority, c.ref_id)))
