"""After the window, a workspace's model-call text goes and the accounting stays; the simulation keeps its text."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from conftest import REPO_ROOT
from govern.config import load_config
from govern.db import Database, utc_now_iso
from govern.retention import RetentionConfig, load_retention, redact_expired
from govern.workspace import create_workspace

CONFIG = REPO_ROOT / "config"


def _call(db, run_id, age_days, text="the whole charter and the matter"):
    when = (datetime.now(timezone.utc) - timedelta(days=age_days)).isoformat()
    db.insert("llm_calls", {"call_id": f"c-{run_id[:8]}-{age_days}", "run_id": run_id, "agent_id": None, "sim_month": None,
                            "model": "claude-haiku-4-5-20251001", "purpose": "ask_policy", "status": "ok", "attempt": 1,
                            "input_tokens": 100, "cached_tokens": 0, "cache_write_tokens": 0, "output_tokens": 20, "cost_usd": 0.001,
                            "batch": False, "batch_id": None, "custom_id": None, "stop_reason": "end_turn", "error": None,
                            "request": text, "response": text, "created_at": when})


def test_the_config_loads():
    cfg = load_retention(CONFIG)
    assert cfg.keep_text_days >= 0 and "removed" in cfg.redact_marker


def test_old_workspace_text_is_replaced_and_the_accounting_kept(tmp_path):
    db = Database.connect_sqlite(tmp_path / "g.sqlite")
    db.migrate(REPO_ROOT / "db" / "migrations")
    run_id = create_workspace(db, load_config(CONFIG), config_dir=CONFIG, data_dir=tmp_path, name="Harbor Health",
                              risk_appetite="Use AI to cut clinician admin time. Never let it make a clinical decision.")
    db.insert("experiments", {"experiment_id": "sim-x", "name": "sim", "notes": "", "created_at": utc_now_iso()})
    db.insert("runs", {"run_id": "sim-x-r1", "experiment_id": "sim-x", "bank_id": "tollgate", "condition": "baseline", "replicate": 1,
                       "seed": 1, "model_versions": {}, "config_hash": "x", "start_month": "2026-01", "current_month": None,
                       "status": "created", "spend_cap_usd_per_month": None, "started_at": utc_now_iso()})
    _call(db, run_id, 30); _call(db, run_id, 3); _call(db, "sim-x-r1", 30)
    cfg = RetentionConfig(keep_text_days=14, redact_marker="[gone]")
    assert redact_expired(db, cfg) == 1
    rows = {r["call_id"]: r for r in db.fetch_all("SELECT call_id, request, response, cost_usd, input_tokens FROM llm_calls")}
    old, recent, sim = rows[f"c-{run_id[:8]}-30"], rows[f"c-{run_id[:8]}-3"], rows["c-sim-x-r1-30"]
    assert old["request"] == "[gone]" and old["response"] == "[gone]" and old["cost_usd"] == 0.001 and old["input_tokens"] == 100
    assert "charter" in recent["request"] and "charter" in sim["request"]
    assert redact_expired(db, cfg) == 0          # idempotent
