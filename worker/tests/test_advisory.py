"""Advisory items: one perspective per seat plus a synthesis, and no vote."""

from __future__ import annotations

from datetime import date

import pytest

from conftest import REPO_ROOT
from sim.advisory import Perspective, analyse, perspectives_for, record_perspective, synthesis_for, synthesize
from sim.config import load_advisory
from sim.context import RunContext
from sim.tools import ToolSession, execute
from sim.world import load_world

MONTH = "2027-01"
ITEM = "ADV-001"
SEATS = ("coo_chair", "ciso", "cfo")


@pytest.fixture
def advisory_config():
    return load_advisory(REPO_ROOT / "config")


@pytest.fixture
def ctx(db, run_id, tmp_path, config):
    world = load_world(REPO_ROOT / "config")
    run = dict(db.fetch_one("SELECT * FROM runs WHERE run_id = ?", (run_id,)))
    for seat in SEATS:
        p = world.persona("calder_ridge", seat)
        db.insert("agents", {"agent_id": f"{run_id}/agent/{seat}", "run_id": run_id, "bank_id": "calder_ridge",
                             "seat": seat, "name": p.name, "title": p.title, "persona_file": p.path,
                             "active_from": MONTH, "active_to": None, "stance_baseline": p.stance_baseline})
    db.insert("meetings", {"meeting_id": f"{run_id}/meeting/{MONTH}", "run_id": run_id, "bank_id": "calder_ridge",
                           "sim_month": MONTH, "meeting_date": "2027-01-12", "agenda": [], "status": "open"})
    return RunContext(db=db, llm=None, world=world, config=config, run=run, data_dir=tmp_path)


def meeting_id(ctx) -> str:
    return f"{ctx.run_id}/meeting/{MONTH}"


def add(ctx, seat, stance, *, concern="Fair lending exposure is unquantified.",
        changes="A disparate impact test on twelve months of decisions."):
    return record_perspective(
        ctx.db, ctx.run_id, meeting_id=meeting_id(ctx), agent_id=f"{ctx.run_id}/agent/{seat}", item_id=ITEM,
        stance=stance, position=f"{seat} view", key_concern=concern, would_change_my_mind=changes)


def perspectives(*stances) -> tuple[Perspective, ...]:
    return tuple(Perspective(agent_id=f"a/{i}", seat=seat, item_id=ITEM, stance=stance, position="p",
                             key_concern="c", would_change_my_mind="w")
                 for i, (seat, stance) in enumerate(zip(SEATS, stances)))


# ---- recording ------------------------------------------------------------


def test_perspective_round_trips(ctx):
    add(ctx, "ciso", 2)
    stored = perspectives_for(ctx.db, meeting_id(ctx), ITEM)
    assert len(stored) == 1
    assert stored[0].seat == "ciso"
    assert stored[0].stance == 2
    assert stored[0].would_change_my_mind.startswith("A disparate impact test")


def test_resubmitting_replaces_the_earlier_perspective(ctx):
    add(ctx, "ciso", 2)
    add(ctx, "ciso", 4)
    stored = perspectives_for(ctx.db, meeting_id(ctx), ITEM)
    assert [p.stance for p in stored] == [4]


def test_perspectives_come_back_in_seat_order(ctx):
    for seat in ("cfo", "ciso", "coo_chair"):
        add(ctx, seat, 3)
    assert [p.seat for p in perspectives_for(ctx.db, meeting_id(ctx), ITEM)] == ["cfo", "ciso", "coo_chair"]


def test_stance_outside_the_scale_is_refused(ctx):
    with pytest.raises(ValueError, match="stance"):
        add(ctx, "ciso", 9)


# ---- deterministic analysis ----------------------------------------------


def test_agreement_has_no_spread(advisory_config):
    result = analyse(perspectives(4, 4, 4), config=advisory_config)
    assert result.spread == 0
    assert result.split is False


def test_opposed_seats_register_as_split(advisory_config):
    result = analyse(perspectives(1, 3, 5), config=advisory_config)
    assert result.spread == 4
    assert result.split is True


def test_split_threshold_is_configured(advisory_config):
    just_under = analyse(perspectives(3, 3, 3 + advisory_config.split_at - 1), config=advisory_config)
    at_threshold = analyse(perspectives(3, 3, 3 + advisory_config.split_at), config=advisory_config)
    assert just_under.split is False
    assert at_threshold.split is True


def test_seats_are_sorted_for_against_and_undecided(advisory_config):
    result = analyse(perspectives(5, 1, 3), config=advisory_config)
    assert result.for_seats == ("coo_chair",)
    assert result.against_seats == ("ciso",)
    assert result.undecided_seats == ("cfo",)


def test_analysing_nothing_is_refused(advisory_config):
    with pytest.raises(ValueError, match="no perspectives"):
        analyse((), config=advisory_config)


# ---- synthesis ------------------------------------------------------------


def test_synthesis_lists_what_would_change_each_mind(ctx, advisory_config):
    add(ctx, "ciso", 1, changes="A disparate impact test.")
    add(ctx, "cfo", 5, changes="A three-year cost model.")
    result = synthesize(ctx, meeting_id=meeting_id(ctx), item_id=ITEM, config=advisory_config)
    assert result.checks == (("cfo", "A three-year cost model."), ("ciso", "A disparate impact test."))


def test_synthesis_records_the_split_and_reads_back(ctx, advisory_config):
    add(ctx, "ciso", 1)
    add(ctx, "cfo", 5)
    synthesize(ctx, meeting_id=meeting_id(ctx), item_id=ITEM, config=advisory_config)
    stored = synthesis_for(ctx.db, meeting_id(ctx), ITEM)
    assert stored.split is True
    assert stored.spread == 4


def test_synthesis_makes_no_recommendation_and_no_decision(ctx, advisory_config):
    add(ctx, "ciso", 1)
    add(ctx, "cfo", 5)
    result = synthesize(ctx, meeting_id=meeting_id(ctx), item_id=ITEM, config=advisory_config)
    assert not hasattr(result, "recommendation")
    assert ctx.db.fetch_all("SELECT decision_id FROM decisions WHERE run_id = ?", (ctx.run_id,)) == []


def test_narrative_is_optional_and_stored_when_given(ctx, advisory_config):
    add(ctx, "ciso", 1)
    plain = synthesize(ctx, meeting_id=meeting_id(ctx), item_id=ITEM, config=advisory_config)
    assert plain.narrative is None
    told = synthesize(ctx, meeting_id=meeting_id(ctx), item_id=ITEM, config=advisory_config,
                      narrative="The committee divides on evidence, not on appetite.")
    assert told.narrative.startswith("The committee divides")


def test_advisory_tables_travel_with_a_fork():
    from sim.checkpoint import RUN_TABLES
    assert {"perspectives", "syntheses"} <= set(RUN_TABLES)


# ---- the tool -------------------------------------------------------------


def session(ctx, seat="ciso", phase="perspective"):
    agent = next(a for a in ctx.active_agents() if a.seat == seat)
    return ToolSession(ctx=ctx, agent=agent, phase=phase, month=MONTH, meeting_id=meeting_id(ctx),
                       meeting_date=date(2027, 1, 12), advisory_items={ITEM: "Where should model risk sit?"})


def test_submit_perspective_records_one(ctx):
    s = session(ctx)
    text, is_error = execute(s, "submit_perspective", {
        "item_id": ITEM, "stance": 2, "position": "Too early.", "key_concern": "No inventory.",
        "would_change_my_mind": "A complete model inventory."})
    assert is_error is False
    assert perspectives_for(ctx.db, meeting_id(ctx), ITEM)[0].stance == 2
    assert ITEM in text


def test_submit_perspective_rejects_an_unknown_item(ctx):
    text, is_error = execute(session(ctx), "submit_perspective", {
        "item_id": "ADV-999", "stance": 2, "position": "p", "key_concern": "c", "would_change_my_mind": "w"})
    assert is_error is False
    assert "not an advisory item" in text.lower()


def test_submit_perspective_rejects_a_stance_off_the_scale(ctx):
    text, _ = execute(session(ctx), "submit_perspective", {
        "item_id": ITEM, "stance": 0, "position": "p", "key_concern": "c", "would_change_my_mind": "w"})
    assert "between 1 and 5" in text


def test_submit_perspective_is_unavailable_during_voting(ctx):
    text, is_error = execute(session(ctx, phase="vote"), "submit_perspective", {
        "item_id": ITEM, "stance": 2, "position": "p", "key_concern": "c", "would_change_my_mind": "w"})
    assert is_error is True
    assert "not available" in text.lower()


def test_no_synthesis_yet_reads_back_as_nothing(ctx):
    assert synthesis_for(ctx.db, meeting_id(ctx), ITEM) is None
