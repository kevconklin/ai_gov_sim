"""The tool loop: truncated replies are retried, and required tools are forced after the free steps."""

from __future__ import annotations

from datetime import date

import pytest

from conftest import REPO_ROOT
from fakes import FakeClient, make_message
from sim.agents.runner import run_turn
from sim.config import load_config
from sim.context import RunContext
from sim.llm import LLMClient
from sim.tools import ToolSession
from sim.world import load_world


@pytest.fixture
def session(db, run_id, tmp_path):
    world, config = load_world(REPO_ROOT / "config"), load_config(REPO_ROOT / "config")
    run = dict(db.fetch_one("SELECT * FROM runs WHERE run_id = ?", (run_id,)))
    persona = world.persona("calder_ridge", "cfo")
    db.insert("agents", {"agent_id": f"{run_id}/agent/cfo", "run_id": run_id, "bank_id": "calder_ridge", "seat": "cfo",
                         "name": persona.name, "title": persona.title, "persona_file": persona.path,
                         "active_from": "2027-01", "active_to": None, "stance_baseline": persona.stance_baseline})
    for seat in ("coo_chair",):
        p = world.persona("calder_ridge", seat)
        db.insert("agents", {"agent_id": f"{run_id}/agent/{seat}", "run_id": run_id, "bank_id": "calder_ridge", "seat": seat,
                             "name": p.name, "title": p.title, "persona_file": p.path, "active_from": "2027-01",
                             "active_to": None, "stance_baseline": p.stance_baseline})
    ctx = RunContext(db=db, llm=None, world=world, config=config, run=run, data_dir=tmp_path)
    ctx.policy_repo.init("Calder Ridge Bank", "c@example.com", date(2026, 12, 28))
    agent = next(a for a in ctx.active_agents() if a.seat == "cfo")
    db.insert("meetings", {"meeting_id": f"{run_id}/meeting/2027-01", "run_id": run_id, "bank_id": "calder_ridge",
                           "sim_month": "2027-01", "meeting_date": "2027-01-12", "agenda": [], "status": "open"})
    return ctx, ToolSession(ctx=ctx, agent=agent, phase="vote", month="2027-01",
                            meeting_id=f"{run_id}/meeting/2027-01", meeting_date=date(2027, 1, 12),
                            decision_items={"UC-001": "An initiative"})


def _llm(db, config, fake):
    return LLMClient(db=db, config=config, client=fake, sleep=lambda s: None, price_scale=0.0)


def test_truncated_tool_call_is_retried(session, db, config):
    ctx, s = session
    fake = FakeClient()
    truncated = make_message("", extra_content=({"type": "tool_use", "id": "t1", "name": "cast_vote", "input": {}},))
    truncated = type(truncated).model_validate({**truncated.model_dump(), "stop_reason": "max_tokens"})
    good = make_message("", extra_content=({"type": "tool_use", "id": "t2", "name": "cast_vote",
                                            "input": {"item_id": "UC-001", "vote": "yes", "rationale": "ok"}},))
    fake.messages.responses.extend([truncated, good])
    ctx = RunContext(**{**ctx.__dict__, "llm": _llm(db, config, fake)})
    s.ctx = ctx
    run_turn(ctx, s, instruction="Voting is open on:\n- UC-001: An initiative", packet="packet", purpose="committee_vote",
             max_tokens=900, until=lambda: "UC-001" in s.votes, required_tool="cast_vote", max_steps=4)
    assert s.votes == {"UC-001": "yes"}
    assert "cut off" in str(fake.messages.calls[1]["messages"][-1]["content"])


def test_required_tool_is_forced_after_free_steps(session, db, config):
    ctx, s = session
    fake = FakeClient()
    fake.messages.responses.extend([
        make_message("", extra_content=({"type": "tool_use", "id": "r1", "name": "read_policy", "input": {}},)),
        make_message("", extra_content=({"type": "tool_use", "id": "v1", "name": "cast_vote",
                                         "input": {"item_id": "UC-001", "vote": "no", "rationale": "no"}},)),
    ])
    ctx = RunContext(**{**ctx.__dict__, "llm": _llm(db, config, fake)})
    s.ctx = ctx
    run_turn(ctx, s, instruction="Voting is open on:\n- UC-001: An initiative", packet="packet", purpose="committee_vote",
             max_tokens=900, until=lambda: "UC-001" in s.votes, required_tool="cast_vote", free_steps=1, max_steps=4)
    assert "tool_choice" not in fake.messages.calls[0]
    assert fake.messages.calls[1]["tool_choice"] == {"type": "tool", "name": "cast_vote"}
    assert s.votes == {"UC-001": "no"}
