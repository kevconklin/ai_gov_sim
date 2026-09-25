"""Advisory items: one perspective per seat, then a synthesis. No vote.

A decision item ends in a ballot the human attests to. An advisory item ends in a reading of
where the committee stands, which is what makes this a consultation tool rather than an
approval queue.

Perspectives are sealed before debate, for the same reason positions are on decision items:
it stops whoever speaks first setting the frame for everyone else.

The synthesis makes no recommendation. There is no decision to recommend. Its useful part is
computed, not written: the split comes from the structured stance rather than from reading
prose, and the checks are simply what each member said would change their mind, which is the
list a human can go and act on.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Sequence

from govern import ids
from govern.config import AdvisoryConfig
from govern.context import ReviewContext
from govern.db import Database

STANCE_MIN, STANCE_MAX = 1, 5


@dataclass(frozen=True)
class Perspective:
    agent_id: str
    seat: str
    item_id: str
    stance: int
    position: str
    key_concern: str
    would_change_my_mind: str


@dataclass(frozen=True)
class Split:
    spread: int
    split: bool
    for_seats: tuple[str, ...]
    against_seats: tuple[str, ...]
    undecided_seats: tuple[str, ...]


@dataclass(frozen=True)
class Synthesis:
    synthesis_id: str
    item_id: str
    spread: int
    split: bool
    for_seats: tuple[str, ...]
    against_seats: tuple[str, ...]
    undecided_seats: tuple[str, ...]
    checks: tuple[tuple[str, str], ...]   # (seat, what would change that seat's mind)
    narrative: str | None = None


# ---- recording ------------------------------------------------------------


def record_perspective(db: Database, run_id: str, *, meeting_id: str, agent_id: str, item_id: str, stance: int,
                       position: str, key_concern: str, would_change_my_mind: str,
                       scale: tuple[int, int] = (STANCE_MIN, STANCE_MAX)) -> None:
    low, high = scale
    if not low <= stance <= high:
        raise ValueError(f"stance must be between {low} and {high}")
    db.execute("DELETE FROM perspectives WHERE meeting_id = ? AND agent_id = ? AND item_id = ?",
               (meeting_id, agent_id, item_id))
    db.insert("perspectives", {
        "run_id": run_id, "meeting_id": meeting_id, "agent_id": agent_id, "item_id": item_id, "stance": stance,
        "position": position, "key_concern": key_concern, "would_change_my_mind": would_change_my_mind,
    })


def perspectives_for(db: Database, meeting_id: str, item_id: str) -> tuple[Perspective, ...]:
    rows = db.fetch_all(
        "SELECT p.agent_id AS agent_id, a.seat AS seat, p.item_id AS item_id, p.stance AS stance, "
        "p.position AS position, p.key_concern AS key_concern, p.would_change_my_mind AS would_change_my_mind "
        "FROM perspectives p JOIN agents a ON a.agent_id = p.agent_id "
        "WHERE p.meeting_id = ? AND p.item_id = ? ORDER BY a.seat", (meeting_id, item_id))
    return tuple(Perspective(agent_id=r["agent_id"], seat=r["seat"], item_id=r["item_id"], stance=int(r["stance"]),
                             position=r["position"], key_concern=r["key_concern"],
                             would_change_my_mind=r["would_change_my_mind"]) for r in rows)


# ---- deterministic analysis ----------------------------------------------


def analyse(perspectives: Sequence[Perspective], *, config: AdvisoryConfig) -> Split:
    """Where the committee stands, from the structured stance alone."""
    if not perspectives:
        raise ValueError("no perspectives to analyse")
    stances = [p.stance for p in perspectives]
    spread = max(stances) - min(stances)
    return Split(
        spread=spread,
        split=spread >= config.split_at,
        for_seats=tuple(sorted(p.seat for p in perspectives if p.stance >= config.for_at_least)),
        against_seats=tuple(sorted(p.seat for p in perspectives if p.stance <= config.against_at_most)),
        undecided_seats=tuple(sorted(p.seat for p in perspectives
                                     if config.against_at_most < p.stance < config.for_at_least)),
    )


# ---- synthesis ------------------------------------------------------------


def synthesize(ctx: ReviewContext, *, meeting_id: str, item_id: str, config: AdvisoryConfig,
               narrative: str | None = None) -> Synthesis:
    """Read the sealed perspectives and record what the human needs in order to act."""
    perspectives = perspectives_for(ctx.db, meeting_id, item_id)
    result = analyse(perspectives, config=config)
    checks = tuple((p.seat, p.would_change_my_mind) for p in sorted(perspectives, key=lambda p: p.seat))
    synthesis = Synthesis(
        synthesis_id=ids.scoped(ctx.run_id, "synthesis", meeting_id, item_id), item_id=item_id, spread=result.spread,
        split=result.split, for_seats=result.for_seats, against_seats=result.against_seats,
        undecided_seats=result.undecided_seats, checks=checks, narrative=narrative)
    ctx.db.upsert("syntheses", {
        "synthesis_id": synthesis.synthesis_id, "run_id": ctx.run_id, "meeting_id": meeting_id, "item_id": item_id,
        "spread": synthesis.spread, "split": synthesis.split, "for_seats": list(synthesis.for_seats),
        "against_seats": list(synthesis.against_seats), "undecided_seats": list(synthesis.undecided_seats),
        "checks": [list(c) for c in checks], "narrative": narrative,
    }, key=("meeting_id", "item_id"))
    return synthesis


def synthesis_for(db: Database, meeting_id: str, item_id: str) -> Synthesis | None:
    row = db.fetch_one("SELECT * FROM syntheses WHERE meeting_id = ? AND item_id = ?", (meeting_id, item_id))
    if row is None:
        return None
    return Synthesis(
        synthesis_id=row["synthesis_id"], item_id=row["item_id"], spread=int(row["spread"]), split=bool(row["split"]),
        for_seats=tuple(json.loads(row["for_seats"])), against_seats=tuple(json.loads(row["against_seats"])),
        undecided_seats=tuple(json.loads(row["undecided_seats"])),
        checks=tuple(tuple(c) for c in json.loads(row["checks"])), narrative=row["narrative"])
