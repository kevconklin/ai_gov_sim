"""A review: a committee of targeted advisers considers an agenda a person set, and recommends.

This is the product. A person convenes it and chooses what it takes. Members record sealed
positions on items for decision and sealed perspectives on advisory ones, debate, and vote by
secret ballot. What comes out is a recommendation with its dissent, and a synthesis for anything
advisory. Nothing is applied here: `govern.attestation` is where a named person makes it real.

The simulation's monthly meeting is a subclass (`sim.meeting.Meeting`) that adds what only a
simulation needs: members proposing their own agenda, standing items, and outcomes that apply
with no person in the loop.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date
from typing import Sequence

from govern import ids, prompts
from govern.advisory import perspectives_for, synthesize
from govern.agents.memory import save_memory
from govern.agents.runner import run_turn
from govern.calendar import long_date
from govern.context import Agent, ReviewContext, display_id
from govern.decisions import Decision, minutes_text, record_decisions, results_text
from govern.intake import KIND_LABELS, mark_items
from govern.packet import AgendaItem, agenda_text, build_packet
from govern.tools import ToolSession

log = logging.getLogger(__name__)

DECISION_KINDS = frozenset({"use_case", "policy_edit", "status_change", "item"})
ADVISORY = "advisory"


def next_meeting_id(db, run_id: str, month: str) -> str:
    """Keep the established id for a month's first meeting; number the rest, so a person can convene again."""
    held = db.fetch_one("SELECT COUNT(*) AS n FROM meetings WHERE run_id = ? AND sim_month = ?", (run_id, month))["n"]
    return ids.scoped(run_id, "meeting", month) if not held else ids.scoped(run_id, "meeting", month, held + 1)


def open_items(db, run_id: str) -> list[AgendaItem]:
    """Everything undecided, as agenda items: what came through intake, and what members proposed."""
    items = [AgendaItem(display_id(r["item_id"]), ADVISORY if r["kind"] == "question" else "item",
                        r["title"] if r["kind"] == "question" else f"{KIND_LABELS[r['kind']]}: {r['title']}", r["item_id"])
             for r in db.fetch_all("SELECT item_id, kind, title FROM items WHERE run_id = ? AND status = 'submitted' "
                                   "ORDER BY item_id", (run_id,))]
    items += [AgendaItem(display_id(r["use_case_id"]), "use_case", f"New AI initiative: {r['title']}", r["use_case_id"])
              for r in db.fetch_all("SELECT use_case_id, title FROM use_cases WHERE run_id = ? AND status = 'proposed' "
                                    "ORDER BY use_case_id", (run_id,))]
    items += [AgendaItem(display_id(r["edit_id"]), "policy_edit", f"Policy language: {r['section']}", r["edit_id"])
              for r in db.fetch_all("SELECT edit_id, section FROM policy_edits WHERE run_id = ? AND status = 'proposed' "
                                    "ORDER BY edit_id", (run_id,))]
    items += [AgendaItem(display_id(r["change_id"]), "status_change",
                         f"Change {display_id(r['use_case_id'])} to {r['new_status']}", r["change_id"])
              for r in db.fetch_all("SELECT change_id, use_case_id, new_status FROM status_changes WHERE run_id = ? "
                                    "AND status = 'proposed' ORDER BY change_id", (run_id,))]
    return items


@dataclass(frozen=True)
class MeetingResult:
    meeting_id: str
    meeting_date: date
    decisions: tuple[Decision, ...]
    minutes_text: str


class Review:
    convened = True          # a person set this agenda, so nothing applies without an attestation

    def __init__(self, ctx: ReviewContext, agenda: Sequence[AgendaItem], *, on: date, month: str | None = None,
                 members: Sequence[Agent] | None = None) -> None:
        self.ctx = ctx
        self.given = tuple(agenda)
        self.date = on
        self.month = month or on.isoformat()[:7]
        self.meeting_id = next_meeting_id(ctx.db, ctx.run_id, self.month)
        self._slug = self.meeting_id.rsplit("/", 1)[-1]   # "2027-01" or "2027-01-2": keeps msg ids unique
        self.chair = ctx.chair()
        # A panel is a subset of the committee chosen for this agenda. The chair always sits: it
        # opens and closes discussion, breaks ties, and writes the minutes.
        seated = list(members) if members is not None else ctx.active_agents()
        self.members = seated if any(a.agent_id == self.chair.agent_id for a in seated) else [self.chair, *seated]
        self._seq = 0

    # ---- helpers --------------------------------------------------------

    def _tokens(self, name: str) -> int:
        return int(self.ctx.budget("max_tokens", name))

    def _session(self, agent: Agent, phase: str, decision_items: Sequence[AgendaItem] = (),
                 advisory_items: Sequence[AgendaItem] = ()) -> ToolSession:
        return ToolSession(ctx=self.ctx, agent=agent, phase=phase, month=self.month, meeting_id=self.meeting_id,
                           meeting_date=self.date, decision_items={i.item_id: i.title for i in decision_items},
                           advisory_items={i.item_id: i.title for i in advisory_items})

    def _message(self, agent: Agent | None, phase: str, text: str, *, round_no: int | None = None, tags: dict | None = None) -> None:
        self._seq += 1
        self.ctx.db.insert("messages", {
            "msg_id": ids.scoped(self.ctx.run_id, "msg", self._slug, f"{self._seq:04d}"), "run_id": self.ctx.run_id,
            "meeting_id": self.meeting_id, "agent_id": agent.agent_id if agent else None, "sim_month": self.month,
            "phase": phase, "round": round_no, "seq": self._seq, "text": text, "tags": tags or {},
        })

    def _pending_items(self) -> list[AgendaItem]:
        return open_items(self.ctx.db, self.ctx.run_id)

    # ---- what this review takes ------------------------------------------

    def decision_items(self) -> list[AgendaItem]:
        """The given items still open, in the order given. One decided since the agenda was built drops out."""
        open_now = {i.ref_id: i for i in self._pending_items()}
        return [open_now[i.ref_id] for i in self.given if i.kind in DECISION_KINDS and i.ref_id in open_now]

    def advisory_items(self) -> list[AgendaItem]:
        return [i for i in self.given if i.kind == ADVISORY]

    def full_agenda(self, decision_items: Sequence[AgendaItem]) -> list[AgendaItem]:
        return [*decision_items, *self.advisory_items()]

    def agenda(self) -> list[AgendaItem]:
        return self.full_agenda(self.decision_items())

    def prepare(self) -> None:
        """Before positions. A person set this agenda, so it is not open to additions."""

    def conclude(self, decisions: Sequence[Decision]) -> None:
        """After the ballot. A review recommends; `govern.attestation.apply_attested` is what applies."""
        log.info("%s recorded %d recommendation(s); nothing applies until a person attests",
                 self.meeting_id, len(decisions))

    # ---- phases ---------------------------------------------------------

    def _scaled_tokens(self, name: str, items: int) -> int:
        return self._tokens(name) + items * self._tokens(f"{name}_per_item")

    def _positions(self, items: Sequence[AgendaItem], packet: str) -> None:
        for agent in self.members:
            session = self._session(agent, "position", items)
            remaining = list(items)
            for _ in range(2):          # a second pass covers items dropped by a truncated turn
                listing = "\n".join(f"- {i.item_id}: {i.title}" for i in remaining)
                instruction = prompts.render("committee/phase_position.md", date=long_date(self.date), items=listing)
                turn = run_turn(self.ctx, session, instruction=instruction, packet=packet, purpose="committee_position",
                                max_tokens=self._scaled_tokens("position", len(remaining)),
                                until=lambda: all(i.item_id in session.positions for i in items),
                                required_tool="submit_position", free_steps=3, max_steps=3 + len(remaining) + 2)
                for call in turn.tool_calls:
                    if call["name"] == "submit_position" and not call["error"]:
                        self._message(agent, "position", call["input"].get("summary", ""),
                                      tags={"item_id": str(call["input"].get("item_id", "")).upper(),
                                            "support": call["input"].get("support")})
                remaining = [i for i in items if i.item_id not in session.positions]
                if not remaining:
                    break
            if remaining:
                log.warning("%s recorded no position on %s", agent.agent_id, [i.item_id for i in remaining])

    def _perspectives(self, items: Sequence[AgendaItem], packet: str) -> None:
        """Advisory items take no ballot. Each seat files a view, sealed until every member has."""
        for agent in self.members:
            session = self._session(agent, "perspective", (), items)
            remaining = list(items)
            for _ in range(2):          # a second pass covers items dropped by a truncated turn
                listing = "\n".join(f"- {i.item_id}: {i.title}" for i in remaining)
                instruction = prompts.render("committee/phase_perspective.md", date=long_date(self.date), items=listing)
                turn = run_turn(self.ctx, session, instruction=instruction, packet=packet,
                                purpose="committee_perspective",
                                max_tokens=self._scaled_tokens("position", len(remaining)),
                                until=lambda: all(i.item_id in session.perspectives for i in items),
                                required_tool="submit_perspective", free_steps=3, max_steps=3 + len(remaining) + 2)
                for call in turn.tool_calls:
                    if call["name"] == "submit_perspective" and not call["error"]:
                        self._message(agent, "perspective", call["input"].get("position", ""),
                                      tags={"item_id": str(call["input"].get("item_id", "")).upper(),
                                            "stance": call["input"].get("stance")})
                remaining = [i for i in items if i.item_id not in session.perspectives]
                if not remaining:
                    break
            if remaining:
                log.warning("%s filed no perspective on %s", agent.agent_id, [i.item_id for i in remaining])

    def _debate(self, packet: str) -> list[AgendaItem]:
        cues = prompts.load_yaml("committee/cues.yaml")
        transcript: list[str] = []
        new_items: list[AgendaItem] = []
        max_rounds = int(self.ctx.budget("debate", "max_rounds"))
        max_speakers = int(self.ctx.budget("debate", "max_speakers"))
        others = [a for a in self.members if a.agent_id != self.chair.agent_id][: max(0, max_speakers - 1)]

        def speak(agent: Agent, cue: str, round_no: int) -> bool:
            agenda = agenda_text(self.full_agenda(self.decision_items()))
            instruction = prompts.render("committee/phase_debate.md", date=long_date(self.date), agenda=agenda,
                                         transcript="\n\n".join(transcript) or "(The meeting has just opened.)", cue=cue)
            session = self._session(agent, "debate")
            turn = run_turn(self.ctx, session, instruction=instruction, packet=packet, purpose="committee_turn",
                            max_tokens=self._tokens("committee_turn"))
            spoke = bool(turn.text) and not (session.passed and len(turn.text) < 40)
            if spoke:
                self._message(agent, "debate", turn.text, round_no=round_no)
                transcript.append(f"{agent.name} ({agent.title}): {turn.text}")
            for item_id in session.created_items:
                transcript.append(f"[Secretary: {agent.name} submitted {item_id} for decision today.]")
            new_items.extend(i for i in self._pending_items() if i.item_id in session.created_items)
            return spoke or bool(session.created_items)

        speak(self.chair, cues["chair_open"], 1)
        for round_no in range(1, max_rounds + 1):
            active = [speak(agent, cues["member"], round_no) for agent in others]
            if not any(active):
                break
        speak(self.chair, cues["chair_close"], max_rounds + 1)
        return new_items

    def _vote(self, items: Sequence[AgendaItem], packet: str) -> None:
        for agent in self.members:
            session = self._session(agent, "vote", items)
            remaining = list(items)
            for _ in range(2):
                listing = "\n".join(f"- {i.item_id}: {i.title}" for i in remaining)
                run_turn(self.ctx, session, instruction=prompts.render("committee/phase_vote.md", items=listing),
                         packet=packet, purpose="committee_vote", max_tokens=self._scaled_tokens("vote", len(remaining)),
                         until=lambda: all(i.item_id in session.votes for i in items),
                         required_tool="cast_vote", free_steps=0, max_steps=len(remaining) + 2)
                remaining = [i for i in items if i.item_id not in session.votes]
                if not remaining:
                    break
            if remaining:
                log.warning("%s cast no ballot on %s", agent.agent_id, [i.item_id for i in remaining])

    def _minutes(self, decisions: Sequence[Decision], packet: str) -> str:
        rows = self.ctx.db.fetch_all("SELECT m.text, a.name, a.title FROM messages m JOIN agents a ON a.agent_id = m.agent_id "
                                     "WHERE m.meeting_id = ? AND m.phase = 'debate' ORDER BY m.seq", (self.meeting_id,))
        transcript = "\n\n".join(f"{r['name']} ({r['title']}): {r['text']}" for r in rows)
        instruction = prompts.render("committee/phase_minutes.md", results=results_text(decisions),
                                     transcript=transcript or "(No discussion was recorded.)")
        session = self._session(self.chair, "minutes")
        run_turn(self.ctx, session, instruction=instruction, packet=packet, purpose="committee_minutes",
                 max_tokens=self._tokens("minutes"), until=lambda: session.minutes is not None,
                 required_tool="record_minutes", free_steps=1, max_steps=3)
        text = minutes_text(bank_name=self.ctx.org.name, meeting_date=self.date,
                            present=[f"{a.name} ({a.title})" for a in self.members], minutes=session.minutes,
                            decisions=decisions)
        self.ctx.db.update("meetings", {"minutes_json": {"recorded": session.minutes, "decisions": [
            {"item_id": d.item.item_id, "outcome": d.outcome, "yes": d.tally.yes, "no": d.tally.no,
             "abstain": d.tally.abstain, "tie_broken": d.tally.tie_broken} for d in decisions]},
            "minutes_text": text}, where={"meeting_id": self.meeting_id})
        self._message(self.chair, "minutes", text)
        return text

    def _memories(self, decisions: Sequence[Decision], packet: str) -> None:
        instruction = prompts.render("committee/phase_memory.md", date=long_date(self.date), results=results_text(decisions))
        for agent in self.members:
            turn = run_turn(self.ctx, self._session(agent, "memory"), instruction=instruction, packet=packet,
                            purpose="memory_rewrite", max_tokens=self._tokens("memory_rewrite"), tools_enabled=False)
            if turn.text:
                save_memory(self.ctx.db, self.ctx.llm, run_id=self.ctx.run_id, agent_id=agent.agent_id, month=self.month,
                            text=turn.text, max_tokens=int(self.ctx.budget("memory", "max_tokens")),
                            compression_max_tokens=self._tokens("compression"))
                self._message(agent, "memory", turn.text)

    # ---- entry point ----------------------------------------------------

    def hold(self) -> MeetingResult:
        self.ctx.db.insert("meetings", {"meeting_id": self.meeting_id, "run_id": self.ctx.run_id,
                                        "bank_id": self.ctx.run["bank_id"], "sim_month": self.month,
                                        "meeting_date": self.date.isoformat(), "agenda": [], "status": "open",
                                        "convened": self.convened})
        self.prepare()
        circulated, advisory = self.decision_items(), self.advisory_items()
        mark_items(self.ctx.db, [i.ref_id for i in (*circulated, *advisory)], "in_review")
        packet = build_packet(self.ctx, month=self.month, meeting_date=self.date, agenda=self.full_agenda(circulated))
        if circulated:
            self._positions(circulated, packet)
        if advisory:
            self._perspectives(advisory, packet)
        self._debate(packet)
        to_decide = [i for i in self.decision_items_after_debate(circulated)]
        self.ctx.db.update("meetings", {"agenda": [i.to_json() for i in self.full_agenda(to_decide)]},
                           where={"meeting_id": self.meeting_id})
        final_packet = build_packet(self.ctx, month=self.month, meeting_date=self.date,
                                    agenda=self.full_agenda(to_decide))
        if to_decide:
            self._vote(to_decide, final_packet)
        decisions = record_decisions(self.ctx, meeting_id=self.meeting_id, month=self.month, items=to_decide,
                                     chair_agent_id=self.chair.agent_id)
        mark_items(self.ctx.db, [d.item.ref_id for d in decisions], "recommended")
        self.conclude(decisions)
        for item in advisory:
            if perspectives_for(self.ctx.db, self.meeting_id, item.item_id):
                synthesize(self.ctx, meeting_id=self.meeting_id, item_id=item.item_id,
                           config=self.ctx.config.advisory)
                mark_items(self.ctx.db, [item.ref_id], "advised", decided_on=self.date)
        text = self._minutes(decisions, final_packet)
        self._memories(decisions, final_packet)
        self.ctx.db.update("meetings", {"status": "closed"}, where={"meeting_id": self.meeting_id})
        return MeetingResult(self.meeting_id, self.date, tuple(decisions), text)

    def decision_items_after_debate(self, before: Sequence[AgendaItem]) -> list[AgendaItem]:
        """What goes to the ballot. For a review, exactly what was given: items raised in debate wait."""
        return list(before)
