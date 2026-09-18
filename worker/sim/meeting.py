"""The simulation's monthly committee meeting (SPEC 5 steps 3-7, 9).

A `govern.review.Review` with what only a simulation needs: members circulate their own
proposals, the agenda is derived from whatever is open, standing items lead it, and outcomes
apply with no person in the loop. Pass an agenda and it behaves as a plain review on the
simulated calendar, which is how a called meeting works inside a run.
"""

from __future__ import annotations

import logging
from typing import Sequence

from govern import prompts
from govern.agents.runner import run_turn
from govern.calendar import long_date, meeting_date as meeting_date_for
from govern.decisions import Decision, apply_decisions
from govern.packet import AgendaItem, build_packet
from govern.review import ADVISORY, DECISION_KINDS, MeetingResult, Review, next_meeting_id  # noqa: F401
from sim.context import RunContext

log = logging.getLogger(__name__)

STANDING_ITEMS = (
    AgendaItem("A-1", "discussion", "Board direction, correspondence, and last month's AI portfolio report"),
    AgendaItem("A-2", "discussion", "AI strategy, pipeline, and policy"),
)


class Meeting(Review):
    def __init__(self, ctx: RunContext, month: str, *, agenda: Sequence[AgendaItem] | None = None) -> None:
        super().__init__(ctx, agenda or (), on=meeting_date_for(month), month=month)
        self.derived = agenda is None

    @property
    def convened(self) -> bool:          # type: ignore[override]
        return not self.derived

    def decision_items(self) -> list[AgendaItem]:
        return self._pending_items() if self.derived else super().decision_items()

    def full_agenda(self, decision_items: Sequence[AgendaItem]) -> list[AgendaItem]:
        return [*STANDING_ITEMS, *decision_items] if self.derived else super().full_agenda(decision_items)

    def decision_items_after_debate(self, before: Sequence[AgendaItem]) -> list[AgendaItem]:
        """A derived agenda also takes what members raised during the debate."""
        return self._pending_items() if self.derived else super().decision_items_after_debate(before)

    def prepare(self) -> None:
        if self.derived:
            self._circulate()

    def conclude(self, decisions: Sequence[Decision]) -> None:
        if not self.derived:
            return super().conclude(decisions)
        problems = apply_decisions(self.ctx, decisions, month=self.month, meeting_date=self.date)
        if problems:
            log.warning("policy edits not applied: %s", problems)

    def _circulate(self) -> None:
        packet = build_packet(self.ctx, month=self.month, meeting_date=self.date, agenda=self.full_agenda([]))
        instruction = prompts.render("committee/phase_circulate.md", date=long_date(self.date))
        for agent in self.members:
            turn = run_turn(self.ctx, self._session(agent, "circulate"), instruction=instruction, packet=packet,
                            purpose="committee_circulate", max_tokens=self._tokens("circulate"))
            if turn.text:
                self._message(agent, "circulate", turn.text)
