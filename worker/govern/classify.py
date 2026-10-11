"""Gates: typed decisions before expensive steps.

A review's debate is most of its cost and nearly all of its minutes, and when the sealed positions
already agree it adds neither information nor dissent. A gate asks one typed question, "will the
vote change after debate?", gets a probability back, and above a threshold a person set, the
review goes straight to the ballot. The gate routes; it never decides a matter. Every call is
logged with its probability, the trail says when a step was skipped and at what confidence, and
a failure of the gate means the step runs as it always has.

Three providers share one shape: a reading of the structured positions already recorded (free,
deterministic, the default), a calibrated classifier service, and a fixed answer for tests.
"""

from __future__ import annotations

import json
import os
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Protocol, Sequence

import yaml

from govern import ids
from govern.config import ConfigError
from govern.db import Database, utc_now_iso

DEBATE_OUTCOME = "debate_outcome"
UNANIMOUS, CONTESTED = "unanimous", "contested"


@dataclass(frozen=True)
class GateDecision:
    label: str
    probability: float            # of `label`
    provider: str
    latency_ms: int
    cost_usd: float = 0.0
    detail: Mapping[str, Any] | None = None


@dataclass(frozen=True)
class Position:
    agent_id: str
    item_id: str
    support: int                  # 1 strongly oppose .. 5 strongly support


class Classifier(Protocol):
    name: str

    def debate_outcome(self, positions: Sequence[Position]) -> GateDecision: ...


class GateUnavailable(RuntimeError):
    """The classifier could not answer. The step it would have skipped runs as usual."""


# ---- providers -------------------------------------------------------------------------------

class PositionsClassifier:
    """Reads the structured positions. No model: a seat at 4 or 5 is for, at 1 or 2 against, 3 is undecided.

    p(unanimous) for one item is the share of decided seats on the majority side, discounted by the
    undecided; across items it is the lowest, since one contested item means a debate.
    """

    name = "positions"

    def debate_outcome(self, positions: Sequence[Position]) -> GateDecision:
        started = time.monotonic()
        by_item: dict[str, list[int]] = {}
        for p in positions:
            by_item.setdefault(p.item_id, []).append(int(p.support))
        if not by_item:
            return GateDecision(CONTESTED, 1.0, self.name, 0, detail={"reason": "no positions"})
        lows = []
        detail: dict[str, Any] = {}
        for item, scores in by_item.items():
            for_ = sum(s >= 4 for s in scores)
            against = sum(s <= 2 for s in scores)
            undecided = len(scores) - for_ - against
            decided = for_ + against
            majority = max(for_, against)
            p = (majority / decided if decided else 0.0) * (decided / len(scores))
            lows.append(p)
            detail[item] = {"for": for_, "against": against, "undecided": undecided, "p_unanimous": round(p, 3)}
        p_unanimous = min(lows)
        label = UNANIMOUS if p_unanimous > 0.5 else CONTESTED          # an even split is contested
        return GateDecision(label, p_unanimous if label == UNANIMOUS else 1 - p_unanimous, self.name,
                            int((time.monotonic() - started) * 1000), detail=detail)


class ScriptedClassifier:
    """A fixed answer, for tests and demos."""

    name = "scripted"

    def __init__(self, p_unanimous: float) -> None:
        self.p_unanimous = p_unanimous

    def debate_outcome(self, positions: Sequence[Position]) -> GateDecision:
        label = UNANIMOUS if self.p_unanimous >= 0.5 else CONTESTED
        return GateDecision(label, self.p_unanimous if label == UNANIMOUS else 1 - self.p_unanimous, self.name, 0)


class JevClassifier:
    """A calibrated classifier service. The request and response shapes here are a placeholder until
    checked against the vendor's documentation; the key never leaves the environment."""

    name = "jev"

    def __init__(self, endpoint: str, key_env: str, timeout: float) -> None:
        self.endpoint, self.key_env, self.timeout = endpoint, key_env, timeout

    def debate_outcome(self, positions: Sequence[Position]) -> GateDecision:
        key = os.environ.get(self.key_env)
        if not key:
            raise GateUnavailable(f"{self.key_env} is not set")
        body = json.dumps({
            "question": "After a committee debate, will the vote on each item be unanimous or contested?",
            "choices": [UNANIMOUS, CONTESTED],
            "state": {"positions": [{"item": p.item_id, "seat": p.agent_id.rsplit("/", 1)[-1], "support": p.support} for p in positions]},
        }).encode()
        req = urllib.request.Request(self.endpoint, data=body, method="POST",
                                     headers={"content-type": "application/json", "authorization": f"Bearer {key}"})
        started = time.monotonic()
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                data = json.loads(resp.read().decode())
        except Exception as error:  # noqa: BLE001 - any failure means the debate runs
            raise GateUnavailable(f"classifier call failed: {type(error).__name__}: {error}") from None
        label = str(data.get("label") or data.get("decision") or "")
        probability = float(data.get("probability") or data.get("confidence") or 0.0)
        if label not in (UNANIMOUS, CONTESTED) or not 0.0 <= probability <= 1.0:
            raise GateUnavailable(f"classifier returned an unusable answer: {data!r}"[:200])
        return GateDecision(label, probability, self.name, int((time.monotonic() - started) * 1000),
                            cost_usd=float(data.get("cost_usd") or 0.0))


# ---- config and the gate itself ----------------------------------------------------------------

@dataclass(frozen=True)
class GateConfig:
    provider: str
    debate_skip_enabled: bool
    debate_skip_threshold: float
    jev_endpoint: str
    jev_key_env: str
    jev_timeout: float


def load_classify(config_dir: Path) -> GateConfig:
    path = Path(config_dir) / "classify.yaml"
    if not path.is_file():
        raise ConfigError(f"missing config file: classify.yaml (looked in {config_dir})")
    data = yaml.safe_load(path.read_text()) or {}
    provider = str(data.get("provider") or "positions")
    if provider not in ("positions", "jev", "scripted"):
        raise ConfigError("classify.yaml: provider must be positions, jev, or scripted")
    skip = data.get("debate_skip") or {}
    threshold = float(skip.get("threshold", 0.9))
    if not 0.5 <= threshold <= 1.0:
        raise ConfigError("classify.yaml: debate_skip.threshold must be between 0.5 and 1.0")
    jev = data.get("jev") or {}
    return GateConfig(provider=provider, debate_skip_enabled=bool(skip.get("enabled", False)), debate_skip_threshold=threshold,
                      jev_endpoint=str(jev.get("endpoint") or ""), jev_key_env=str(jev.get("key_env") or "JEV_API_KEY"),
                      jev_timeout=float(jev.get("timeout_seconds", 3)))


def build_classifier(config: GateConfig) -> Classifier:
    if config.provider == "jev":
        return JevClassifier(config.jev_endpoint, config.jev_key_env, config.jev_timeout)
    if config.provider == "scripted":
        return ScriptedClassifier(0.95)
    return PositionsClassifier()


def positions_for(db: Database, meeting_id: str) -> tuple[Position, ...]:
    rows = db.fetch_all("SELECT agent_id, item_id, support FROM positions WHERE meeting_id = ?", (meeting_id,))
    return tuple(Position(r["agent_id"], r["item_id"], int(r["support"])) for r in rows)


def record(db: Database, run_id: str, *, meeting_id: str | None, purpose: str, decision: GateDecision, acted: bool,
           inputs: Mapping[str, Any]) -> str:
    call_id = ids.unique(run_id, "gate")
    db.insert("classifier_calls", {"call_id": call_id, "run_id": run_id, "meeting_id": meeting_id, "purpose": purpose,
                                   "provider": decision.provider, "label": decision.label, "probability": decision.probability,
                                   "acted": acted, "inputs": dict(inputs), "latency_ms": decision.latency_ms,
                                   "cost_usd": decision.cost_usd, "created_at": utc_now_iso()})
    return call_id


def should_skip_debate(db: Database, run_id: str, meeting_id: str, *, classifier: Classifier, config: GateConfig) -> tuple[bool, float | None]:
    """Ask the gate. Returns (skip, p_unanimous); any failure is (False, None) and the debate runs."""
    if not config.debate_skip_enabled:
        return False, None
    positions = positions_for(db, meeting_id)
    if not positions:
        return False, None
    try:
        decision = classifier.debate_outcome(positions)
    except GateUnavailable as error:
        record(db, run_id, meeting_id=meeting_id, purpose=DEBATE_OUTCOME,
               decision=GateDecision("unavailable", 0.0, getattr(classifier, "name", "?"), 0, detail={"error": str(error)}),
               acted=False, inputs={"positions": len(positions), "error": str(error)[:200]})
        return False, None
    p_unanimous = decision.probability if decision.label == UNANIMOUS else 1 - decision.probability
    skip = decision.label == UNANIMOUS and decision.probability >= config.debate_skip_threshold
    record(db, run_id, meeting_id=meeting_id, purpose=DEBATE_OUTCOME, decision=decision, acted=skip,
           inputs={"positions": len(positions), "items": len({p.item_id for p in positions}),
                   "threshold": config.debate_skip_threshold, **({"detail": dict(decision.detail)} if decision.detail else {})})
    return skip, round(p_unanimous, 3)


# ---- replay: what the gate would have done on reviews already held -------------------------------

@dataclass(frozen=True)
class Replay:
    meeting_id: str
    meeting_date: str
    p_unanimous: float
    would_skip: bool
    was_unanimous: bool          # every ballot on every item went the same way
    debate_moved_a_vote: bool    # a seat's ballot went against its own sealed position


def replay_debate_gate(db: Database, run_id: str, *, classifier: Classifier, threshold: float) -> list[Replay]:
    """Run the gate over every closed review with positions and ballots, and say where it would have been wrong.

    The dangerous case is a skip on a review where the debate moved a vote: that is the number to drive
    to zero before trusting a threshold. The record is the evaluation set.
    """
    out = []
    for m in db.fetch_all("SELECT meeting_id, meeting_date FROM meetings WHERE run_id = ? AND status = 'closed' ORDER BY meeting_date, meeting_id", (run_id,)):
        positions = positions_for(db, m["meeting_id"])
        votes = db.fetch_all("SELECT agent_id, item_id, vote FROM votes WHERE meeting_id = ?", (m["meeting_id"],))
        if not positions or not votes:
            continue
        try:
            decision = classifier.debate_outcome(positions)
        except GateUnavailable:
            continue
        p = decision.probability if decision.label == UNANIMOUS else 1 - decision.probability
        by_item: dict[str, set[str]] = {}
        for v in votes:
            by_item.setdefault(v["item_id"], set()).add(v["vote"])
        was_unanimous = all(len(s - {"abstain"}) <= 1 for s in by_item.values())
        stance = {(x.agent_id, x.item_id): x.support for x in positions}
        moved = any((stance.get((v["agent_id"], v["item_id"])) or 3) >= 4 and v["vote"] == "no"
                    or (stance.get((v["agent_id"], v["item_id"])) or 3) <= 2 and v["vote"] == "yes" for v in votes)
        out.append(Replay(m["meeting_id"], str(m["meeting_date"]), round(p, 3), p >= threshold and decision.label == UNANIMOUS, was_unanimous, moved))
    return out
