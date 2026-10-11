"""The fast decision model: typed questions, calibrated answers, every call on the record, and gates that only flag."""

from __future__ import annotations

import json
from datetime import date

import pytest

from conftest import REPO_ROOT
from govern import jev as jevmod
from govern.classify import JevClassifier, Position, load_classify
from govern.config import load_config
from govern.db import Database
from govern.intake import get_item, submit_item
from govern.jev import GateUnavailable, Jev, JevSettings, ScriptedJev, build_jev, load_settings
from govern.triage import assess_submission, load_intake_gate, questions_for
from govern.workspace import create_workspace

CONFIG = REPO_ROOT / "config"
TODAY = date(2026, 10, 11)


@pytest.fixture
def ws(tmp_path):
    db = Database.connect_sqlite(tmp_path / "g.sqlite")
    db.migrate(REPO_ROOT / "db" / "migrations")
    config = load_config(CONFIG)
    run_id = create_workspace(db, config, config_dir=CONFIG, data_dir=tmp_path, name="Harbor Health",
                              risk_appetite="Use AI to cut clinician admin time.", today=TODAY, actor="dana@harbor.example", source="test")
    return db, config, run_id


def test_settings_come_from_config_and_the_price_from_models_yaml():
    config = load_config(CONFIG)
    s = load_settings(CONFIG, config.models.prices)
    assert s.endpoint == "https://api.typesafe.ai/v1/systemone" and s.model == "jev-1.13.0" and s.key_env == "JEV_API_KEY"
    assert s.price_per_mtok == pytest.approx(0.042) and s.priced_model == "typesafe:jev-1.13.0"


def test_the_request_is_the_documented_shape_and_the_answer_is_logged_and_priced(ws):
    db, config, run_id = ws
    seen = {}

    def transport(body, *, settings, key):
        seen.update(body); seen["key"] = key
        return {"model": "jev-1.13.0", "usage": {"input_tokens": 1000, "output_tokens": 5},
                "answers": {"dup": {"type": "choice", "choice": "none", "probabilities": {"IT-001": 0.1, "none": 0.9}, "confidence": 0.8},
                            "urgent": {"type": "noul", "noul": 0.2}}}
    client = Jev(db, load_settings(CONFIG, config.models.prices), transport=transport, key="k-test")
    out = client.evaluate({"matter": "x"}, {"dup": {"type": "choice", "instructions": "?", "criteria": {"IT-001": "a", "none": "b"}},
                                           "urgent": {"type": "noul", "instructions": "?"}}, purpose="intake_triage", run_id=run_id, item_id="i1")
    assert seen["model"] == "jev-1.13.0" and seen["state"] == {"matter": "x"} and set(seen["questions"]) == {"dup", "urgent"} and seen["key"] == "k-test"
    assert out.choice("dup")[0] == "none" and out.noul("urgent") == 0.2
    assert out.cost_usd == pytest.approx(1000 * 0.042 / 1_000_000)
    row = db.fetch_one("SELECT * FROM gate_calls WHERE call_id = ?", (out.call_id,))
    assert row["status"] == "ok" and row["purpose"] == "intake_triage" and json.loads(row["answers"])["urgent"]["noul"] == 0.2
    ledger = db.fetch_one("SELECT model, purpose, cost_usd FROM llm_calls WHERE call_id = ?", (out.call_id,))
    assert ledger["model"] == "typesafe:jev-1.13.0" and ledger["purpose"] == "gate_intake_triage" and ledger["cost_usd"] == pytest.approx(out.cost_usd)
    client.acted(out.call_id, {"flags": []})
    assert json.loads(db.fetch_one("SELECT acted FROM gate_calls WHERE call_id = ?", (out.call_id,))["acted"]) == {"flags": []}


def test_no_key_no_price_or_a_bad_answer_means_unavailable_and_still_logged(ws):
    db, config, run_id = ws
    settings = load_settings(CONFIG, config.models.prices)
    with pytest.raises(GateUnavailable, match="JEV_API_KEY"):
        Jev(db, settings, key="").evaluate("s", {"q": {"type": "noul", "instructions": "?"}}, purpose="p", run_id=run_id)
    with pytest.raises(GateUnavailable, match="price"):
        Jev(db, JevSettings(price_per_mtok=0.0), key="k").evaluate("s", {"q": {"type": "noul", "instructions": "?"}}, purpose="p", run_id=run_id)
    bad = Jev(db, settings, transport=lambda body, settings, key: {"answers": {"q": {"type": "choice"}}, "usage": {}}, key="k")
    with pytest.raises(GateUnavailable):
        bad.evaluate("s", {"q": {"type": "noul", "instructions": "?"}}, purpose="p", run_id=run_id)
    rows = db.fetch_all("SELECT status, error FROM gate_calls WHERE run_id = ?", (run_id,))
    assert len(rows) == 3 and all(r["status"] == "unavailable" and r["error"] for r in rows)
    assert db.fetch_one("SELECT COUNT(*) AS n FROM llm_calls WHERE run_id = ?", (run_id,))["n"] == 0, "nothing unpriced reaches the ledger"


def test_the_intake_gate_asks_about_duplicates_kind_tier_and_steering(ws):
    db, config, run_id = ws
    matter = {"title": "Otter.ai", "kind_filed": "tool", "risk_tier_filed": "medium", "description": "Meeting notes."}
    q = questions_for(matter, [{"id": "IT-001", "kind": "tool", "title": "Otter", "summary": "notes"}], load_intake_gate(CONFIG).tiers)
    assert set(q) == {"kind", "risk_tier", "instruction_shaped", "duplicate_of"}
    assert set(q["duplicate_of"]["criteria"]) == {"IT-001", "none"} and set(q["risk_tier"]["criteria"]) == {"low", "medium", "high"}
    assert q["instruction_shaped"]["type"] == "noul"


def test_a_duplicate_a_different_tier_and_steering_text_are_flagged_not_applied(ws):
    db, config, run_id = ws
    first = submit_item(db, run_id, kind="tool", title="Otter.ai", description="Meeting notes for the clinic.", submitted_by="a@h", today=TODAY)
    second = submit_item(db, run_id, kind="tool", title="Otter AI notes", description="Otter for meeting notes, filed again.", submitted_by="b@h",
                         risk_tier="low", today=TODAY)
    scripted = ScriptedJev(db, load_settings(CONFIG, config.models.prices), answers={
        "duplicate_of": {"choice": "IT-001", "probabilities": {"IT-001": 0.93, "none": 0.07}, "confidence": 0.9},
        "risk_tier": {"choice": "high", "probabilities": {"low": 0.05, "medium": 0.15, "high": 0.8}, "confidence": 0.75},
        "kind": {"choice": "tool", "probabilities": {"tool": 0.9}, "confidence": 0.9},
        "instruction_shaped": {"noul": 0.85},
    })
    gate = assess_submission(db, scripted, load_intake_gate(CONFIG), run_id=run_id, item_id=second)
    assert gate["duplicate"] == {"of": "IT-001", "p": 0.93, "confidence": 0.9}
    assert gate["risk_tier"]["read"] == "high" and gate["risk_tier"]["agrees"] is False and gate["kind"]["agrees"] is True
    assert gate["flags"] == ["possible duplicate of IT-001", "reads as high risk, filed as low"]
    item = get_item(db, second)
    details = json.loads(item["details"]) if isinstance(item["details"], str) else item["details"]
    assert details["gate"]["flags"] == gate["flags"]
    assert any(f.startswith("gate: text addressed") for f in details["flagged_text"])
    assert item["risk_tier"] == "low" and item["status"] == "submitted", "the gate flags; it changes nothing"
    acted = json.loads(db.fetch_one("SELECT acted FROM gate_calls WHERE item_id = ?", (second,))["acted"])
    assert acted["flags"] == gate["flags"] and acted["flagged_text"] is True


def test_an_unavailable_gate_leaves_the_submission_untouched(ws):
    db, config, run_id = ws
    item = submit_item(db, run_id, kind="tool", title="Otter.ai", description="Meeting notes for the clinic.", submitted_by="a@h", today=TODAY)
    down = Jev(db, load_settings(CONFIG, config.models.prices), key="")
    assert assess_submission(db, down, load_intake_gate(CONFIG), run_id=run_id, item_id=item) is None
    details = get_item(db, item)["details"]
    assert "gate" not in (json.loads(details) if isinstance(details, str) else details)


def test_the_debate_gate_reads_positions_through_the_fast_model(ws):
    db, config, run_id = ws
    scripted = ScriptedJev(db, load_settings(CONFIG, config.models.prices), answers={
        "outcome": {"choice": "contested", "probabilities": {"unanimous": 0.3, "contested": 0.7}, "confidence": 0.6}})
    gate = JevClassifier(scripted, run_id, "m1")
    decision = gate.debate_outcome([Position("r/agent/chair", "IT-001", 4, "fine", ""), Position("r/agent/risk", "IT-001", 2, "no", "data")])
    assert decision.label == "contested" and decision.probability == pytest.approx(0.7) and decision.detail["confidence"] == 0.6
    row = db.fetch_one("SELECT purpose, state FROM gate_calls WHERE meeting_id = 'm1'")
    assert row["purpose"] == "debate_outcome" and "summary" in row["state"] and "concerns" in row["state"]


def test_build_jev_is_scripted_beside_a_scripted_model_client(ws):
    db, config, run_id = ws
    assert isinstance(build_jev(db, CONFIG, config.models, scripted=True), ScriptedJev)
    assert isinstance(build_jev(db, CONFIG, config.models, scripted=False), Jev)
