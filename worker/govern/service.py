"""Convening a review. The one entry point, whoever asks: command line, queue, or the simulation."""

from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

from govern.budget import require_review_budget
from govern.config import Config
from govern.context import ReviewContext
from govern.db import Database
from govern.intake import get_item
from govern.llm import LLMClient
from govern.locks import run_lock
from govern.packet import AgendaItem
from govern.panels import panel_for
from govern.review import MeetingResult, Review
from govern.workspace import is_workspace


def recover_interrupted_reviews(db: Database, run_id: str) -> list[str]:
    """Put back anything a review that never finished was holding.

    A review that dies part-way leaves its meeting open and its matters marked as in review,
    which hides them from the queue: nobody can convene them and nobody can sign them. Called
    under the run lock, so an open review here is a dead one, not one in flight. Its unsigned
    decisions go, its matters return to the queue, and the meeting is kept, marked failed.
    """
    dead = [r["meeting_id"] for r in db.fetch_all(
        "SELECT meeting_id FROM meetings WHERE run_id = ? AND status = 'open' AND convened", (run_id,))]
    for meeting_id in dead:
        db.execute("DELETE FROM decisions WHERE meeting_id = ? AND decision_id NOT IN "
                   "(SELECT decision_id FROM attestations)", (meeting_id,))
        db.update("meetings", {"status": "failed"}, where={"meeting_id": meeting_id})
    if dead:
        db.execute("UPDATE items SET status = 'submitted' WHERE run_id = ? AND status = 'in_review'", (run_id,))
        db.execute("UPDATE items SET status = 'submitted' WHERE run_id = ? AND status = 'recommended' AND item_id NOT IN "
                   "(SELECT ref_id FROM decisions WHERE run_id = ?)", (run_id, run_id))
    return dead


class ReviewService:
    def __init__(self, *, db: Database, config: Config, llm: LLMClient, data_dir: Path,
                 panel_rules: Mapping[str, Any],
                 context_factory: Callable[[str], ReviewContext] | None = None) -> None:
        self.db, self.config, self.llm, self.data_dir = db, config, llm, Path(data_dir)
        self.panel_rules = panel_rules
        self._context_factory = context_factory

    def context(self, run_id: str) -> ReviewContext:
        if self._context_factory is not None:
            return self._context_factory(run_id)
        run = self.db.fetch_one("SELECT * FROM runs WHERE run_id = ?", (run_id,))
        if run is None:
            raise KeyError(f"unknown workspace {run_id}")
        return ReviewContext(db=self.db, llm=self.llm, config=self.config, run=dict(run), data_dir=self.data_dir)

    def panel(self, ctx: ReviewContext, agenda: Sequence[AgendaItem]) -> tuple[str, ...]:
        """The seats this agenda needs. Anything that did not come through intake gets the whole committee."""
        matters: list[tuple[str, str | None]] = []
        for entry in agenda:
            item = get_item(self.db, entry.ref_id) if entry.ref_id else None
            if item is None:
                return ctx.org.seats
            matters.append((item["kind"], item["risk_tier"]))
        return panel_for(self.db, ctx.run_id, matters, org=ctx.org, rules=self.panel_rules)

    def convene(self, run_id: str, agenda: Sequence[AgendaItem], *, on: date | None = None,
                month: str | None = None) -> MeetingResult:
        """Hold a review a person called, on the agenda they set. Nothing it recommends applies here."""
        if not agenda:
            raise ValueError("a review needs an agenda")
        with run_lock(self.data_dir, run_id, db=self.db):
            ctx = self.context(run_id)
            if is_workspace(ctx.run):
                require_review_budget(self.db, dict(ctx.run), self.config)
            recover_interrupted_reviews(self.db, run_id)
            seats = set(self.panel(ctx, agenda))
            members = [a for a in ctx.active_agents() if a.seat in seats]
            review = Review(ctx, agenda, on=on or date.today(), month=month, members=members)
            if not review.agenda():
                raise ValueError("nothing on this agenda is still waiting for a review")
            try:
                return review.hold()
            except Exception:
                recover_interrupted_reviews(self.db, run_id)
                raise
