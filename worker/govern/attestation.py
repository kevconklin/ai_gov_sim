"""The human attestation gate.

The committee produces a recommendation and a dissent record. It does not decide. A named
person attests before anything applies, and `apply_attested` refuses a decision that has no
attestation behind it.

Two rules hold the accountability in place:

- The attester's rationale is their own words. Nothing here drafts it. A machine-authored
  attestation is discoverable evidence that the oversight was a formality.
- On the risk tiers named in `config/attestation.yaml`, the attester must answer every
  dissenting vote before the item can apply, so approval cannot be one click.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, replace
from datetime import date
from typing import Any, Mapping, Sequence

from govern import ids
from govern.agenda import record_deferral
from govern.config import AttestationConfig
from govern.context import ReviewContext
from govern.db import Database, utc_now_iso
from govern.decisions import Decision, apply_decisions, decisions_for_meeting

DEFERRED = "deferred"
TABLED = "tabled"


class AttestationRequired(RuntimeError):
    """Raised when a decision would apply with no human on record for it."""


class AttestationInvalid(ValueError):
    """Raised when an attestation would not amount to effective oversight."""


@dataclass(frozen=True)
class Dissent:
    agent_id: str
    vote: str
    rationale: str | None


@dataclass(frozen=True)
class Attestation:
    attestation_id: str
    decision_id: str
    actor: str
    outcome: str
    rationale: str
    responded_to: tuple[str, ...]
    created_at: str
    source: str = "unknown"

    def overrides(self, decision: Decision) -> bool:
        """True when the human landed somewhere other than the committee's recommendation."""
        recommended = "approved" if decision.tally.approved else "rejected"
        return self.outcome != recommended


# ---- dissent --------------------------------------------------------------


def _decision_row(db: Database, decision_id: str) -> Mapping[str, Any]:
    row = db.fetch_one("SELECT * FROM decisions WHERE decision_id = ?", (decision_id,))
    if row is None:
        raise AttestationInvalid(f"no decision {decision_id!r} to attest to")
    return row


def _dissents_for_row(db: Database, row: Mapping[str, Any]) -> tuple[Dissent, ...]:
    opposing = "no" if row["outcome"] == "approved" else "yes"
    votes = db.fetch_all(
        "SELECT agent_id, vote, rationale FROM votes WHERE meeting_id = ? AND item_id = ? AND vote = ? "
        "ORDER BY agent_id", (row["meeting_id"], row["item_id"], opposing))
    return tuple(Dissent(v["agent_id"], v["vote"], v["rationale"]) for v in votes)


def dissents(db: Database, decision: Decision) -> tuple[Dissent, ...]:
    """Members who voted against the way the item carried. Abstentions are not dissent."""
    return _dissents_for_row(db, _decision_row(db, decision.decision_id))


def _risk_tier(db: Database, row: Mapping[str, Any]) -> str | None:
    if row["kind"] == "use_case":
        found = db.fetch_one("SELECT risk_tier FROM use_cases WHERE use_case_id = ?", (row["ref_id"],))
    elif row["kind"] == "status_change":
        found = db.fetch_one(
            "SELECT u.risk_tier AS risk_tier FROM status_changes s JOIN use_cases u ON u.use_case_id = s.use_case_id "
            "WHERE s.change_id = ?", (row["ref_id"],))
    else:
        return None
    return found["risk_tier"] if found else None


# ---- recording ------------------------------------------------------------


def record_attestation(db: Database, run_id: str, *, decision_id: str, actor: str, outcome: str, rationale: str,
                       config: AttestationConfig, responded_to: Sequence[str] = (),
                       source: str = "unknown") -> Attestation:
    row = _decision_row(db, decision_id)
    if outcome not in config.outcomes:
        raise AttestationInvalid(f"outcome {outcome!r} is not one of {', '.join(config.outcomes)}")
    if len(rationale.strip()) < config.min_rationale_chars:
        raise AttestationInvalid(
            f"rationale must be at least {config.min_rationale_chars} characters of the attester's own reasoning")

    answered = tuple(responded_to)
    if _risk_tier(db, row) in config.require_dissent_response_for_tiers:
        unanswered = [d.agent_id for d in _dissents_for_row(db, row) if d.agent_id not in answered]
        if unanswered:
            raise AttestationInvalid(
                "this risk tier requires a response to every dissent; unanswered: " + ", ".join(unanswered))

    attestation = Attestation(
        attestation_id=ids.scoped(run_id, "attestation", decision_id), decision_id=decision_id, actor=actor,
        outcome=outcome, rationale=rationale.strip(), responded_to=answered, created_at=utc_now_iso(),
        source=source)
    db.insert("attestations", {
        "attestation_id": attestation.attestation_id, "run_id": run_id, "decision_id": decision_id, "actor": actor,
        "outcome": outcome, "rationale": attestation.rationale, "responded_to": list(answered),
        "created_at": attestation.created_at, "source": source,
    })
    return attestation


def attestation_for(db: Database, decision_id: str) -> Attestation | None:
    row = db.fetch_one("SELECT * FROM attestations WHERE decision_id = ?", (decision_id,))
    if row is None:
        return None
    return Attestation(
        attestation_id=row["attestation_id"], decision_id=row["decision_id"], actor=row["actor"],
        outcome=row["outcome"], rationale=row["rationale"],
        responded_to=tuple(json.loads(row["responded_to"] or "[]")), created_at=row["created_at"],
        source=row["source"])


# ---- the gate -------------------------------------------------------------


def apply_attested(ctx: ReviewContext, decisions: Sequence[Decision], *, month: str,
                   meeting_date: date) -> list[str]:
    """Apply only what a human attested to, using the human's outcome rather than the tally.

    Raises `AttestationRequired` before touching anything if any decision is unattested, so a
    partial apply cannot leave some items live and others waiting on oversight.
    """
    attestations = {d.decision_id: attestation_for(ctx.db, d.decision_id) for d in decisions}
    missing = [d.item.item_id for d in decisions if attestations[d.decision_id] is None]
    if missing:
        raise AttestationRequired("no human attestation for: " + ", ".join(missing))

    applying = []
    for decision in decisions:
        attested = attestations[decision.decision_id]
        if attested.outcome == DEFERRED:
            record_deferral(ctx.db, ctx.run_id, ref_id=decision.item.ref_id,
                            meeting_id=_decision_row(ctx.db, decision.decision_id)["meeting_id"],
                            sim_month=month, reason=TABLED)
            continue
        applying.append(replace(decision, attested_outcome=attested.outcome))
    return apply_decisions(ctx, applying, month=month, meeting_date=meeting_date)


def apply_meeting(ctx: ReviewContext, meeting_id: str, *, month: str, meeting_date: date) -> list[str]:
    """Apply one meeting's decisions once a human has attested to all of them."""
    return apply_attested(ctx, decisions_for_meeting(ctx, meeting_id), month=month, meeting_date=meeting_date)
