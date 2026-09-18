"""Convening a review. The one entry point, whoever asks: command line, queue, or the simulation."""

from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

from govern.config import Config
from govern.context import ReviewContext
from govern.db import Database
from govern.intake import get_item
from govern.llm import LLMClient
from govern.locks import run_lock
from govern.packet import AgendaItem
from govern.panels import panel_for
from govern.review import MeetingResult, Review


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
            seats = set(self.panel(ctx, agenda))
            members = [a for a in ctx.active_agents() if a.seat in seats]
            return Review(ctx, agenda, on=on or date.today(), month=month, members=members).hold()
