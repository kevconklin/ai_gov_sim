"""The debate gate: skip the debate when the sealed positions already agree, and only for an organization."""

from __future__ import annotations

from datetime import date

import pytest

from conftest import REPO_ROOT
from govern import classify
from govern.classify import Position, PositionsClassifier, ScriptedClassifier, load_classify
from govern.config import load_config
from govern.context import ReviewContext
from govern.db import Database
from govern.intake import submit_item
from govern.llm import LLMClient
from govern.packet import AgendaItem
from govern.panels import load_panels
from govern.service import ReviewService
from govern.workspace import create_workspace
from sim.demo_llm import DemoAnthropic

CONFIG = REPO_ROOT / "config"
TODAY = date(2026, 10, 11)


def pos(*scores, item="IT-001"):
    return [Position(f"r/agent/s{i}", item, s) for i, s in enumerate(scores)]


def test_the_positions_reading_is_high_when_everyone_agrees_and_low_when_split():
    c = PositionsClassifier()
    assert c.debate_outcome(pos(5, 4, 5, 4)).label == "unanimous"
    assert c.debate_outcome(pos(5, 4, 5, 4)).probability == 1.0
    assert c.debate_outcome(pos(1, 2, 1, 2)).probability == 1.0          # unanimous against is still unanimous
    split = c.debate_outcome(pos(5, 4, 2, 1))
    assert split.label == "contested" and split.probability == 0.5
    undecided = c.debate_outcome(pos(5, 5, 5, 3))                        # one seat on the fence costs confidence
    assert undecided.label == "unanimous" and undecided.probability == 0.75
    two_items = c.debate_outcome(pos(5, 5, 5) + pos(5, 1, 1, item="IT-002"))   # the lowest item decides
    assert two_items.label == "unanimous" and round(two_items.probability, 3) == 0.667 < load_classify(CONFIG).debate_skip_threshold
    assert c.debate_outcome([]).label == "contested"


def test_the_config_loads_and_bounds_the_threshold():
    cfg = load_classify(CONFIG)
    assert cfg.provider in ("positions", "jev") and 0.5 <= cfg.debate_skip_threshold <= 1.0


@pytest.fixture
def org(tmp_path):
    db = Database.connect_sqlite(tmp_path / "g.sqlite")
    db.migrate(REPO_ROOT / "db" / "migrations")
    config = load_config(CONFIG)
    run_id = create_workspace(db, config, config_dir=CONFIG, data_dir=tmp_path, name="Harbor Health",
                              risk_appetite="Use AI to cut clinician admin time. Never let it make a clinical decision.", today=TODAY,
                              actor="dana@harbor.example", source="test")
    llm = LLMClient(db=db, config=config, client=DemoAnthropic(), sleep=lambda s: None)
    item = submit_item(db, run_id, kind="tool", title="Otter.ai", description="Meeting notes for the clinic.", submitted_by="ops@harbor.example", today=TODAY)
    return db, config, llm, run_id, item, tmp_path


def review(db, config, llm, run_id, item, data_dir, classifier):
    service = ReviewService(db=db, config=config, llm=llm, data_dir=data_dir, panel_rules=load_panels(CONFIG))
    # go through the service so the lock, panel, and date are the real ones; hand it the classifier via the context
    service.context = lambda rid, _orig=service.context: ReviewContext(**{**_orig(rid).__dict__, "classifier": classifier})  # type: ignore[method-assign]
    return service.convene(run_id, [AgendaItem("IT-001", "item", "AI tool: Otter.ai", item)], on=TODAY)


def test_a_confident_gate_skips_the_debate_and_the_record_says_so(org):
    db, config, llm, run_id, item, data_dir = org
    result = review(db, config, llm, run_id, item, data_dir, ScriptedClassifier(0.97))
    meeting = db.fetch_one("SELECT debate_skipped, debate_skip_p FROM meetings WHERE meeting_id = ?", (result.meeting_id,))
    assert bool(meeting["debate_skipped"]) and meeting["debate_skip_p"] == 0.97
    assert db.fetch_one("SELECT COUNT(*) AS n FROM messages WHERE meeting_id = ? AND phase = 'debate'", (result.meeting_id,))["n"] == 0
    assert db.fetch_one("SELECT COUNT(*) AS n FROM votes WHERE meeting_id = ?", (result.meeting_id,))["n"] > 0     # it still voted
    gate = db.fetch_one("SELECT purpose, provider, label, probability, acted FROM classifier_calls WHERE meeting_id = ?", (result.meeting_id,))
    assert (gate["purpose"], gate["provider"], gate["label"], gate["probability"], bool(gate["acted"])) == ("debate_outcome", "scripted", "unanimous", 0.97, True)
    assert result.decisions                                                                                      # and recommended


def test_an_unsure_gate_lets_the_debate_run_and_is_still_logged(org):
    db, config, llm, run_id, item, data_dir = org
    result = review(db, config, llm, run_id, item, data_dir, ScriptedClassifier(0.4))
    meeting = db.fetch_one("SELECT debate_skipped FROM meetings WHERE meeting_id = ?", (result.meeting_id,))
    assert not meeting["debate_skipped"]
    assert db.fetch_one("SELECT COUNT(*) AS n FROM messages WHERE meeting_id = ? AND phase = 'debate'", (result.meeting_id,))["n"] > 0
    gate = db.fetch_one("SELECT acted, label FROM classifier_calls WHERE meeting_id = ?", (result.meeting_id,))
    assert not gate["acted"] and gate["label"] == "contested"


def test_a_failing_gate_never_stops_a_review(org):
    db, config, llm, run_id, item, data_dir = org

    class Broken:
        name = "broken"
        def debate_outcome(self, positions):
            raise classify.GateUnavailable("the service is down")

    result = review(db, config, llm, run_id, item, data_dir, Broken())
    assert db.fetch_one("SELECT COUNT(*) AS n FROM messages WHERE meeting_id = ? AND phase = 'debate'", (result.meeting_id,))["n"] > 0
    gate = db.fetch_one("SELECT label, acted FROM classifier_calls WHERE meeting_id = ?", (result.meeting_id,))
    assert gate["label"] == "unavailable" and not gate["acted"]


def test_the_simulation_always_debates(tmp_path):
    """The study was registered with a debate in every meeting; the gate is for organizations only."""
    from govern.review import Review
    from govern.workspace import is_workspace
    assert not is_workspace({"condition": "baseline"})
    assert "is_workspace" in Review._skip_debate.__code__.co_names


def test_gate_calls_travel_with_the_workspace():
    from sim.checkpoint import RUN_TABLES
    assert "classifier_calls" in RUN_TABLES


def test_replay_says_where_a_skip_would_have_been_wrong(org):
    db, config, llm, run_id, item, data_dir = org
    result = review(db, config, llm, run_id, item, data_dir, ScriptedClassifier(0.4))      # a real debate and ballot on the record
    rows = classify.replay_debate_gate(db, run_id, classifier=ScriptedClassifier(0.99), threshold=0.9)
    assert [r.meeting_id for r in rows] == [result.meeting_id]
    assert rows[0].would_skip is True and rows[0].p_unanimous == 0.99
    # whether that skip was wrong depends on whether a seat's ballot crossed its sealed position; both fields are read from the record
    assert isinstance(rows[0].debate_moved_a_vote, bool) and isinstance(rows[0].was_unanimous, bool)
    assert classify.replay_debate_gate(db, run_id, classifier=PositionsClassifier(), threshold=0.9)[0].p_unanimous <= 1.0
