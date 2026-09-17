"""One monthly committee meeting (SPEC 5 steps 3-7, 9)."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date
from typing import Sequence

from sim import ids, prompts
from sim.agents.memory import save_memory
from sim.agents.runner import run_turn
from sim.calendar import long_date, meeting_date as meeting_date_for
from sim.context import Agent, RunContext, display_id
from sim.decisions import Decision, apply_decisions, minutes_text, record_decisions, results_text
from sim.packet import AgendaItem, agenda_text, build_packet
from sim.tools import ToolSession

log = logging.getLogger(__name__)

STANDING_ITEMS = (
    AgendaItem("A-1", "discussion", "Board direction, correspondence, and last month's AI portfolio report"),
    AgendaItem("A-2", "discussion", "AI strategy, pipeline, and policy"),
)


@dataclass(frozen=True)
class MeetingResult:
    meeting_id: str
    meeting_date: date
    decisions: tuple[Decision, ...]
    minutes_text: str


class Meeting:
    def __init__(self, ctx: RunContext, month: str) -> None:
        self.ctx = ctx
        self.month = month
        self.date = meeting_date_for(month)
        self.meeting_id = ids.scoped(ctx.run_id, "meeting", month)
        self.members = ctx.active_agents()
        self.chair = ctx.chair()
        self._seq = 0

    # ---- helpers --------------------------------------------------------

    def _tokens(self, name: str) -> int:
        return int(self.ctx.budget("max_tokens", name))

    def _session(self, agent: Agent, phase: str, decision_items: Sequence[AgendaItem] = ()) -> ToolSession:
        return ToolSession(ctx=self.ctx, agent=agent, phase=phase, month=self.month, meeting_id=self.meeting_id,
                           meeting_date=self.date, decision_items={i.item_id: i.title for i in decision_items})

    def _message(self, agent: Agent | None, phase: str, text: str, *, round_no: int | None = None, tags: dict | None = None) -> None:
        self._seq += 1
        self.ctx.db.insert("messages", {
            "msg_id": ids.scoped(self.ctx.run_id, "msg", self.month, f"{self._seq:04d}"), "run_id": self.ctx.run_id,
            "meeting_id": self.meeting_id, "agent_id": agent.agent_id if agent else None, "sim_month": self.month,
            "phase": phase, "round": round_no, "seq": self._seq, "text": text, "tags": tags or {},
        })

    def _pending_items(self) -> list[AgendaItem]:
        db, run_id = self.ctx.db, self.ctx.run_id
        items = [AgendaItem(display_id(r["use_case_id"]), "use_case", f"New AI initiative: {r['title']}", r["use_case_id"])
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

    def _agenda(self, decision_items: Sequence[AgendaItem]) -> list[AgendaItem]:
        return [*STANDING_ITEMS, *decision_items]

    # ---- phases ---------------------------------------------------------

    def _circulate(self) -> None:
        packet = build_packet(self.ctx, month=self.month, meeting_date=self.date, agenda=self._agenda([]))
        instruction = prompts.render("committee/phase_circulate.md", date=long_date(self.date))
        for agent in self.members:
            turn = run_turn(self.ctx, self._session(agent, "circulate"), instruction=instruction, packet=packet,
                            purpose="committee_circulate", max_tokens=self._tokens("circulate"))
            if turn.text:
                self._message(agent, "circulate", turn.text)

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

    def _debate(self, packet: str) -> list[AgendaItem]:
        cues = prompts.load_yaml("committee/cues.yaml")
        transcript: list[str] = []
        new_items: list[AgendaItem] = []
        max_rounds = int(self.ctx.budget("debate", "max_rounds"))
        max_speakers = int(self.ctx.budget("debate", "max_speakers"))
        others = [a for a in self.members if a.agent_id != self.chair.agent_id][: max(0, max_speakers - 1)]

        def speak(agent: Agent, cue: str, round_no: int) -> bool:
            agenda = agenda_text(self._agenda(self._pending_items()))
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
        text = minutes_text(bank_name=self.ctx.bank.name, meeting_date=self.date,
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
                            purpose="memory_rewrite", max_tokens=self._tokens("memory_rewrite"))
            if turn.text:
                save_memory(self.ctx.db, self.ctx.llm, run_id=self.ctx.run_id, agent_id=agent.agent_id, month=self.month,
                            text=turn.text, max_tokens=int(self.ctx.budget("memory", "max_tokens")),
                            compression_max_tokens=self._tokens("compression"))
                self._message(agent, "memory", turn.text)

    # ---- entry point ----------------------------------------------------

    def hold(self) -> MeetingResult:
        self.ctx.db.insert("meetings", {"meeting_id": self.meeting_id, "run_id": self.ctx.run_id,
                                        "bank_id": self.ctx.run["bank_id"], "sim_month": self.month,
                                        "meeting_date": self.date.isoformat(), "agenda": [], "status": "open"})
        self._circulate()
        circulated = self._pending_items()
        packet = build_packet(self.ctx, month=self.month, meeting_date=self.date, agenda=self._agenda(circulated))
        if circulated:
            self._positions(circulated, packet)
        self._debate(packet)
        to_decide = self._pending_items()
        self.ctx.db.update("meetings", {"agenda": [i.to_json() for i in self._agenda(to_decide)]},
                           where={"meeting_id": self.meeting_id})
        final_packet = build_packet(self.ctx, month=self.month, meeting_date=self.date, agenda=self._agenda(to_decide))
        if to_decide:
            self._vote(to_decide, final_packet)
        decisions = record_decisions(self.ctx, meeting_id=self.meeting_id, month=self.month, items=to_decide,
                                     chair_agent_id=self.chair.agent_id)
        problems = apply_decisions(self.ctx, decisions, month=self.month, meeting_date=self.date)
        if problems:
            log.warning("policy edits not applied: %s", problems)
        text = self._minutes(decisions, final_packet)
        self._memories(decisions, final_packet)
        self.ctx.db.update("meetings", {"status": "closed"}, where={"meeting_id": self.meeting_id})
        return MeetingResult(self.meeting_id, self.date, tuple(decisions), text)
