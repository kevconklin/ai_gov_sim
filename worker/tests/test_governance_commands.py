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
    row = db.fetch_one("SELECT actor, area, target FROM config_changes WHERE run_id = ? AND area = 'brief'", (run_id,))
    assert (row["area"], row["target"]) == ("brief", "finance")


def test_signing_the_first_of_two_matters_waits_rather_than_fails(workspace):
    """A review takes effect when its last matter is signed; signing an earlier one is not an error."""
    db, _, run_id, _ = workspace
    refs = []
    for title in ("Notetaker for board meetings", "Translation of member letters"):
        out = run_command(workspace, "submit", {"kind": "tool", "title": title, "risk_tier": "low",
                          "description": "A low-risk productivity tool for internal staff use only.",
                          "submitted_by": "ops@northwind.example"})
        refs.append(out["result"]["item_id"])
    held = run_command(workspace, "convene", {"agenda": [
        {"item_id": r.rsplit("/", 1)[-1], "kind": "item", "title": "AI tool", "ref_id": r} for r in refs]})
    first, second = [d["decision_id"] for d in held["result"]["recommendations"]]
    sign = {"actor": "cro@northwind.example", "outcome": "approved", "apply": True,
            "rationale": "Approved for internal staff use with no member data."}

    one = run_command(workspace, "attest", {**sign, "decision_id": first})
    assert one["status"] == "done" and one["result"]["applied"] is None
    assert "no human attestation" in one["result"]["waiting_on"]
    assert db.fetch_one("SELECT status FROM items WHERE item_id = ?", (refs[0],))["status"] == "recommended"

    two = run_command(workspace, "attest", {**sign, "decision_id": second})
    assert two["result"]["applied"] == held["result"]["meeting_id"]
    assert {db.fetch_one("SELECT status FROM items WHERE item_id = ?", (r,))["status"] for r in refs} == {"approved"}


def test_a_command_another_worker_claimed_is_left_alone(queued):
    """Two workers can both see a command as pending. Only one may run it."""
    db, orch, run_id, data_dir = queued
    command_id = commands.enqueue(db, kind="candidates", run_id=run_id, reason=REASON, payload={}, source="test")
    db.update("commands", {"status": "processing"}, where={"command_id": command_id})     # the other worker got there first
    assert command_id not in commands.process_pending(db, orch, data_dir)
    assert db.fetch_one("SELECT status FROM commands WHERE command_id = ?", (command_id,))["status"] == "processing"


# ---- customers and their configuration, through the queue -----------------


def test_a_new_customer_is_created_without_an_existing_run(queued):
    db, orch, _, data_dir = queued
    command_id = commands.enqueue(db, kind="create_workspace", run_id=None, reason="Onboarding a new customer.", source="test",
                                  payload={"name": "Harbor Health", "framework": "nist_ai_rmf", "actor": "kevin@example.invalid",
                                           "source": "dashboard_session",
                                           "risk_appetite": "Use AI to reduce clinician admin time, never to make a clinical decision."})
    commands.process_pending(db, orch, data_dir)
    row = db.fetch_one("SELECT status, result FROM commands WHERE command_id = ?", (command_id,))
    assert row["status"] == "done", row["result"]
    new_run = json.loads(row["result"])["run_id"]
    assert db.fetch_one("SELECT name, framework FROM org_profiles WHERE run_id = ?", (new_run,))["framework"] == "nist_ai_rmf"
    first = db.fetch_one("SELECT actor, area FROM config_changes WHERE run_id = ?", (new_run,))
    assert (first["actor"], first["area"]) == ("kevin@example.invalid", "workspace")


def test_configuration_changes_through_the_queue_carry_the_session_name(workspace):
    db, _, run_id, _ = workspace
    who = {"actor": "kevin@example.invalid", "source": "dashboard_session"}
    out = run_command(workspace, "update_profile", {**who, "why": "The board revised its AI strategy.",
                                                    "changes": {"business_goals": "Halve call handling time."}})
    assert out["status"] == "done" and out["result"]["changed"] == ["business_goals"]
    out = run_command(workspace, "add_document", {**who, "why": "Adopted by the board in September.", "kind": "charter",
                                                  "title": "AI Committee Charter", "body": "The committee advises. The CRO decides."})
    assert out["status"] == "done"
    out = run_command(workspace, "set_panel", {**who, "why": "Tools always need legal review here.",
                                               "kind": "tool", "seats": ["technology", "security", "legal"]})
    assert out["status"] == "done"
    rows = db.fetch_all("SELECT actor, area FROM config_changes WHERE run_id = ? AND area IN ('profile', 'document', 'panel')", (run_id,))
    assert {r["area"] for r in rows} == {"profile", "document", "panel"}
    assert {r["actor"] for r in rows} == {"kevin@example.invalid"}


def test_a_submission_keeps_the_extra_facts_it_was_given(workspace):
    db, _, run_id, _ = workspace
    out = run_command(workspace, "submit", {
        "kind": "vendor", "title": "Scribe clinical notes", "description": "Transcribes consultations into draft notes.",
        "submitted_by": "kevin@example.invalid", "risk_tier": "high",
        "details": {"vendor": "Scribe Inc", "data_shared": ["audio", "health records"], "customer_facing": False}})
    stored = json.loads(db.fetch_one("SELECT details FROM items WHERE item_id = ?", (out["result"]["item_id"],))["details"])
    assert stored["data_shared"] == ["audio", "health records"] and stored["customer_facing"] is False


def test_the_committee_is_reshaped_through_the_queue(workspace, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    db, _, run_id, _ = workspace
    who = {"actor": "kevin@example.invalid", "source": "dashboard_session", "why": "The board asked for a member-conduct voice."}
    added = run_command(workspace, "add_seat", {**who, "seat": "data_protection", "title": "Data Protection Officer",
                        "brief": "You answer for member data: what is collected, where it goes, and whether members would expect it."})
    assert added["status"] == "done", added
    moved = run_command(workspace, "update_seat", {**who, "seat": "data_protection", "changes": {"model": "openai:gpt-4.1"}})
    assert moved["result"]["changed"] == ["model"]
    gone = run_command(workspace, "remove_seat", {**who, "seat": "business"})
    assert gone["status"] == "done"
    refused = run_command(workspace, "update_seat", {**who, "seat": "risk", "changes": {"model": "openai:not-on-offer"}})
    assert refused["status"] == "failed" and "not a model on offer" in refused["result"]["error"]
    targets = [r["target"] for r in db.fetch_all("SELECT target FROM config_changes WHERE run_id = ? AND area = 'committee' ORDER BY changed_at, change_id", (run_id,))]
    assert targets == ["data_protection added", "data_protection: model", "business removed"]
