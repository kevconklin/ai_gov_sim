"""Tool handlers, regulator exams, board turnover, commands, and CLI on a small demo run."""

from __future__ import annotations

from datetime import date

import pytest

from conftest import REPO_ROOT
from sim import commands
from sim.board import replace_member
from sim.config import load_config
from sim.db import Database
from sim.demo_llm import DemoAnthropic
from sim.llm import LLMClient
from sim.orchestrator import Orchestrator
from sim.regulator import conduct_exam, exam_due
from sim.engine.resolve import load_state
from sim.setup import create_experiment
from sim.tools import ToolSession, execute
from sim.world import load_world


@pytest.fixture
def one_month(tmp_path):
    db = Database.connect_sqlite(tmp_path / "sim.sqlite")
    db.migrate(REPO_ROOT / "db" / "migrations")
    config, world = load_config(REPO_ROOT / "config"), load_world(REPO_ROOT / "config")
    llm = LLMClient(db=db, config=config, client=DemoAnthropic(), sleep=lambda s: None, price_scale=0.0)
    orch = Orchestrator(db=db, world=world, config=config, llm=llm, data_dir=tmp_path)
    run_id = create_experiment(db, world, config, name="t", replicates=1, seed=3, data_dir=tmp_path, banks=["calder_ridge"])[0]
    orch.advance(run_id)
    return db, orch, run_id, tmp_path


def _session(orch, run_id, phase, decision_items=()):
    ctx = orch.context(run_id)
    agent = ctx.active_agents()[1]
    return ToolSession(ctx=ctx, agent=agent, phase=phase, month="2027-02", meeting_id=f"{run_id}/meeting/2027-01",
                       meeting_date=date(2027, 2, 9), decision_items={i: i for i in decision_items})


def test_read_tools_return_agent_facing_text(one_month):
    _, orch, run_id, _ = one_month
    s = _session(orch, run_id, "circulate")
    assert "Artificial Intelligence Policy" in execute(s, "read_policy", {})[0]
    assert "no section" in execute(s, "read_policy", {"section": "Nope"})[0]
    assert execute(s, "read_use_case", {"use_case_id": "UC-999"})[0].startswith("No AI initiative")
    assert execute(s, "search_decision_log", {"query": "policy"})[0]
    assert execute(s, "read_news", {"days": 60})[0]
    assert execute(s, "read_inbox", {})[0]


def test_phase_gating_and_validation(one_month):
    _, orch, run_id, _ = one_month
    s = _session(orch, run_id, "vote", decision_items=["UC-001"])
    assert execute(s, "propose_use_case", {})[1] is True
    assert "not open for voting" in execute(s, "cast_vote", {"item_id": "UC-777", "vote": "yes", "rationale": "x"})[0]
    assert "must be yes" in execute(s, "cast_vote", {"item_id": "UC-001", "vote": "maybe", "rationale": "x"})[0]
    c = _session(orch, run_id, "circulate")
    result, is_error = execute(c, "propose_use_case", {"title": "x"})
    assert is_error and "invalid" in result
    assert "needs a section" in execute(c, "propose_policy_edit", {"section": "", "text": ""})[0]
    assert "cannot be changed" in execute(c, "propose_status_change", {"use_case_id": "UC-001", "new_status": "resume", "rationale": "r"})[0] \
        or "No AI initiative" in execute(c, "propose_status_change", {"use_case_id": "UC-001", "new_status": "resume", "rationale": "r"})[0]
    p = _session(orch, run_id, "position", decision_items=["UC-001"])
    assert "not an agenda item" in execute(p, "submit_position", {"item_id": "PE-404", "support": 3, "summary": "x"})[0]
    assert "between 1 and 5" in execute(p, "submit_position", {"item_id": "UC-001", "support": 9, "summary": "x"})[0]
    m = _session(orch, run_id, "minutes")
    assert execute(m, "record_minutes", {"summary": "x", "key_points": [], "action_items": []})[0].startswith("That action")


def test_full_scope_exam_issues_letter_and_escalates_overdue_findings(one_month):
    db, orch, run_id, _ = one_month
    ctx = orch.context(run_id)
    state = load_state(ctx, "2027-01")
    db.insert("findings", {"finding_id": f"{run_id}/finding/F-old", "run_id": run_id, "bank_id": "calder_ridge",
                           "sim_month": "2027-01", "severity": "mra", "topic": "inventory", "description": "No inventory.",
                           "required_action": "Build one.", "due_month": "2027-01", "status": "open"})
    exam_id = conduct_exam(ctx, "2027-02", state, "full_scope", "annual full-scope examination")
    assert db.fetch_one("SELECT letter_text FROM exams WHERE exam_id = ?", (exam_id,))["letter_text"]
    assert db.fetch_one("SELECT status FROM findings WHERE finding_id = ?", (f"{run_id}/finding/F-old",))["status"] == "escalated"
    assert db.fetch_one("SELECT COUNT(*) AS n FROM findings WHERE severity = 'mria' AND run_id = ?", (run_id,))["n"] == 1
    assert db.fetch_one("SELECT COUNT(*) AS n FROM inbox_items WHERE subject = 'Examination results' AND run_id = ?", (run_id,))["n"] == 1
    assert exam_due(ctx, "2027-12", state, []) == ("full_scope", "annual full-scope examination")


def test_targeted_review_triggers_on_complaints(one_month):
    _, orch, run_id, _ = one_month
    ctx = orch.context(run_id)
    state = load_state(ctx, "2027-01")
    spiked = state.model_copy(update={"risk": state.risk.model_copy(update={"customer_complaint_rate": 99.0})})
    assert exam_due(ctx, "2027-02", spiked, []) == ("targeted", "customer complaint increase")
    assert exam_due(ctx, "2027-02", state, []) is None


def test_replacement_joins_with_handover_memo(one_month):
    db, orch, run_id, _ = one_month
    ctx = orch.context(run_id)
    new = replace_member(ctx, "2027-02", "ciso", "major incident", memo="Board memo text")
    assert new is not None and new.seat == "ciso"
    assert db.fetch_one("SELECT COUNT(*) AS n FROM agents WHERE run_id = ? AND seat = 'ciso' AND active_to IS NULL", (run_id,))["n"] == 1
    assert db.fetch_one("SELECT COUNT(*) AS n FROM inbox_items WHERE recipient_seat = 'ciso'")["n"] == 1
    assert db.fetch_one("SELECT COUNT(*) AS n FROM agent_memories WHERE agent_id = ?", (new.agent_id,))["n"] == 1
    assert replace_member(ctx, "2027-02", "ciso", "again", memo="x") is None      # replacement pool used up
    assert db.fetch_one("SELECT COUNT(*) AS n FROM alerts WHERE kind = 'turnover_skipped'")["n"] == 1


def test_commands_apply_and_record(one_month):
    db, orch, run_id, data_dir = one_month
    with pytest.raises(ValueError):
        commands.enqueue(db, kind="start", run_id=run_id, reason="short")
    commands.enqueue(db, kind="start", run_id=run_id, reason="begin the pilot run")
    commands.enqueue(db, kind="set_spend_cap", run_id=run_id, reason="lower the cap for the pilot", payload={"usd_per_sim_month": 2.5})
    commands.enqueue(db, kind="inject_event", run_id=run_id, reason="test injection path", payload={"event_type": "data_leak", "severity": "high"})
    commands.enqueue(db, kind="advance", run_id=run_id, reason="advance one month now", payload={"months": 1})
    commands.enqueue(db, kind="resume", run_id=run_id, reason="resume should fail when running")
    commands.process_pending(db, orch, data_dir)
    statuses = [r["status"] for r in db.fetch_all("SELECT status FROM commands ORDER BY created_at")]
    assert statuses == ["done", "done", "done", "done", "failed"]
    assert db.fetch_one("SELECT current_month FROM runs WHERE run_id = ?", (run_id,))["current_month"] == "2027-02"
    assert db.fetch_one("SELECT spend_cap_usd_per_month AS c FROM runs WHERE run_id = ?", (run_id,))["c"] == 2.5
    assert not commands.stop_requested(db, data_dir)
    commands.enqueue(db, kind="stop", run_id=run_id, reason="halt the worker for review")
    assert commands.stop_requested(db, data_dir)
    commands.process_pending(db, orch, data_dir)
    assert db.fetch_one("SELECT status FROM runs WHERE run_id = ?", (run_id,))["status"] == "stopped"
    assert db.fetch_one("SELECT COUNT(*) AS n FROM checkpoints WHERE run_id = ? AND sim_month = '2027-02'", (run_id,))["n"] == 1


def test_cli_demo_flow(tmp_path, monkeypatch, capsys):
    from sim.cli import main
    monkeypatch.setenv("SIM_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("DATABASE_URL", raising=False)
    main(["create", "--name", "cli", "--seed", "5", "--banks", "tollgate"])
    run_id = __import__("json").loads(capsys.readouterr().out)["runs"][0]
    main(["advance", "--run", run_id, "--months", "1", "--demo"])
    main(["control", "start", "--run", run_id, "--reason", "start from the cli test", "--now", "--demo"])
    main(["status"])
    assert "month=2027-01" in capsys.readouterr().out
    main(["serve", "--demo", "--once", "--poll-seconds", "0"])
    main(["export", "--out", str(tmp_path / "exports")])
    assert (tmp_path / "exports" / "metrics.parquet").exists()
    main(["validation-sample", "--measure", "stance", "--n", "5", "--out", str(tmp_path / "v.csv")])
    assert (tmp_path / "v.csv").read_text().startswith("msg_id")
    with pytest.raises(SystemExit) as leak_exit:
        main(["leak-check"])
    assert leak_exit.value.code == 0
