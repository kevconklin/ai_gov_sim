"""The human loop over the command queue, which is how the dashboard reaches it."""

from __future__ import annotations

import json

import pytest

from conftest import REPO_ROOT
from sim import commands
from govern.config import load_config
from govern.db import Database
from sim.demo_llm import DemoAnthropic
from govern.llm import LLMClient
from sim.orchestrator import Orchestrator
from sim.setup import create_experiment
from sim.world import load_world

REASON = "Governance review requested by the Chief Risk Officer."


@pytest.fixture(scope="module")
def queued(tmp_path_factory):
    data_dir = tmp_path_factory.mktemp("queued")
    db = Database.connect_sqlite(data_dir / "sim.sqlite")
    db.migrate(REPO_ROOT / "db" / "migrations")
    config, world = load_config(REPO_ROOT / "config"), load_world(REPO_ROOT / "config")
    llm = LLMClient(db=db, config=config, client=DemoAnthropic(), sleep=lambda s: None)
    orch = Orchestrator(db=db, world=world, config=config, llm=llm, data_dir=data_dir)
    run_id = create_experiment(db, world, config, name="queued", replicates=1, seed=11, data_dir=data_dir)[0]
    orch.advance(run_id)
    return db, orch, run_id, data_dir


def run_command(queued, kind: str, payload: dict) -> dict:
    db, orch, run_id, data_dir = queued
    command_id = commands.enqueue(db, kind=kind, run_id=run_id, reason=REASON, payload=payload, source="test")
    commands.process_pending(db, orch, data_dir)
    row = db.fetch_one("SELECT status, result FROM commands WHERE command_id = ?", (command_id,))
    return {"status": row["status"], "result": json.loads(row["result"] or "{}")}


def test_the_new_kinds_are_accepted(queued):
    assert {"candidates", "convene", "attest"} <= commands.KINDS


def test_candidates_come_back_ranked(queued):
    out = run_command(queued, "candidates", {"today": "2027-02-01"})
    assert out["status"] == "done"
    priorities = [c["priority"] for c in out["result"]["candidates"]]
    assert priorities == sorted(priorities, reverse=True)


def test_convening_on_an_advisory_question_records_a_meeting(queued):
    out = run_command(queued, "convene", {"advisory": ["Where should model risk oversight sit?"]})
    assert out["status"] == "done"
    assert out["result"]["meeting_id"]
    assert out["result"]["recommendations"] == []


def test_convening_with_nothing_to_discuss_is_refused(queued):
    out = run_command(queued, "convene", {})
    assert out["status"] == "failed"
    assert "needs an agenda" in out["result"]["error"]


def test_a_thin_rationale_fails_the_command_rather_than_the_worker(queued):
    db, _, run_id, _ = queued
    out = run_command(queued, "attest", {"decision_id": "nope", "actor": "k@bank.example",
                                         "outcome": "approved", "rationale": "ok"})
    assert out["status"] == "failed"
    assert "no decision" in out["result"]["error"]


def test_attesting_applies_the_meeting_when_asked(queued):
    db, orch, run_id, _ = queued
    ref = f"{run_id}/uc/UC-090"
    db.insert("use_cases", {"use_case_id": ref, "run_id": run_id, "bank_id": "calder_ridge",
                            "title": "Collections assistant", "description": "d", "details": {},
                            "risk_tier": "low", "status": "proposed", "proposed_month": "2027-01"})
    held = run_command(queued, "convene", {"agenda": [
        {"item_id": "UC-090", "kind": "use_case", "title": "Collections assistant", "ref_id": ref}]})
    decision_id = held["result"]["recommendations"][0]["decision_id"]

    out = run_command(queued, "attest", {
        "decision_id": decision_id, "actor": "k@bank.example", "outcome": "rejected",
        "rationale": "Overriding the committee: fair lending exposure is not quantified.", "apply": True})
    assert out["status"] == "done"
    assert out["result"]["problems"] == []
    assert db.fetch_one("SELECT status FROM use_cases WHERE use_case_id = ?", (ref,))["status"] == "rejected"


def test_every_governance_command_is_logged_as_an_intervention(queued):
    db, _, run_id, _ = queued
    kinds = {r["kind"] for r in db.fetch_all("SELECT kind FROM interventions WHERE run_id = ?", (run_id,))}
    assert {"command_candidates", "command_convene", "command_attest"} <= kinds


# ---- a workspace through the same queue -----------------------------------


@pytest.fixture(scope="module")
def workspace(queued):
    from govern.workspace import create_workspace
    db, orch, _, data_dir = queued
    run_id = create_workspace(db, orch.config, config_dir=REPO_ROOT / "config", data_dir=data_dir,
                              name="Northwind Credit Union",
                              risk_appetite="Adopt AI where it improves service, never at the cost of a fair lending finding.")
    return db, orch, run_id, data_dir


def test_a_matter_is_submitted_through_the_queue(workspace):
    out = run_command(workspace, "submit", {
        "kind": "vendor", "title": "Lumen transcript analytics", "risk_tier": "medium",
        "description": "Scores member call transcripts for complaint risk.", "submitted_by": "cx@northwind.example"})
    assert out["status"] == "done"
    assert out["result"]["item_id"].endswith("/item/IT-001")
    ranked = run_command(workspace, "candidates", {})["result"]["candidates"]
    assert [c["kind"] for c in ranked] == ["item"]
    assert ranked[0]["title"].startswith("AI vendor:")


def test_a_workspace_is_reviewed_on_todays_date_by_its_panel(workspace):
    from datetime import date
    db, _, run_id, _ = workspace
    ranked = run_command(workspace, "candidates", {})["result"]["candidates"]
    out = run_command(workspace, "convene", {"agenda": [
        {"item_id": "IT-001", "kind": "item", "title": ranked[0]["title"], "ref_id": ranked[0]["ref_id"]}]})
    assert out["status"] == "done", out
    assert out["result"]["date"] == date.today().isoformat()
    sat = db.fetch_one("SELECT COUNT(DISTINCT agent_id) AS n FROM votes WHERE meeting_id = ?",
                       (out["result"]["meeting_id"],))["n"]
    assert sat == 5          # chair, security, legal, risk, finance: not the whole committee


def test_the_clock_refuses_a_workspace(workspace):
    from sim.orchestrator import RunNotActive
    _, orch, run_id, _ = workspace
    with pytest.raises(RunNotActive, match="convene a review"):
        orch.advance(run_id)


def test_a_brief_rewritten_through_the_queue_is_attributed_to_the_dashboard(workspace):
    db, _, run_id, _ = workspace
    out = run_command(workspace, "set_brief", {"seat": "finance", "brief":
                      "You answer for spend and return, and you will not accept a pilot with no stopping rule."})
    assert out["status"] == "done"
    row = db.fetch_one("SELECT source FROM interventions WHERE run_id = ? AND kind = 'prompt_edit'", (run_id,))
    assert row["source"] == "dashboard"
