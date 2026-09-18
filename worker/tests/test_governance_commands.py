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
