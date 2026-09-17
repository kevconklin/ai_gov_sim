"""End-to-end: both banks run three months on the scripted client; checkpoints, forks, and rollback work."""

from __future__ import annotations

import pytest

from sim.checkpoint import fork_run
from sim.config import load_config
from sim.db import Database
from sim.demo_llm import DemoAnthropic
from sim.llm import LLMClient
from sim.orchestrator import Orchestrator
from sim.setup import create_experiment
from sim.world import load_world
from conftest import REPO_ROOT


@pytest.fixture(scope="module")
def pilot(tmp_path_factory):
    data_dir = tmp_path_factory.mktemp("data")
    db = Database.connect_sqlite(data_dir / "sim.sqlite")
    db.migrate(REPO_ROOT / "db" / "migrations")
    config = load_config(REPO_ROOT / "config")
    world = load_world(REPO_ROOT / "config")
    llm = LLMClient(db=db, config=config, client=DemoAnthropic(), sleep=lambda s: None)
    orch = Orchestrator(db=db, world=world, config=config, llm=llm, data_dir=data_dir)
    run_ids = create_experiment(db, world, config, name="pilot", replicates=1, seed=42, data_dir=data_dir)
    for _ in range(3):
        for run_id in run_ids:
            orch.advance(run_id)
    return db, orch, run_ids, data_dir


def test_three_months_complete_for_both_banks(pilot):
    db, _, run_ids, _ = pilot
    for run_id in run_ids:
        assert db.fetch_one("SELECT current_month FROM runs WHERE run_id = ?", (run_id,))["current_month"] == "2027-03"
        assert db.fetch_one("SELECT COUNT(*) AS n FROM meetings WHERE run_id = ? AND status = 'closed'", (run_id,))["n"] == 3
        assert db.fetch_one("SELECT COUNT(*) AS n FROM policy_versions WHERE run_id = ?", (run_id,))["n"] == 3
        assert db.fetch_one("SELECT COUNT(*) AS n FROM checkpoints WHERE run_id = ? AND sim_month = '2027-03'", (run_id,))["n"] == 1


def test_meeting_records_positions_debate_votes_minutes(pilot):
    db, _, run_ids, _ = pilot
    run_id = run_ids[0]
    assert db.fetch_one("SELECT COUNT(*) AS n FROM messages WHERE run_id = ? AND phase = 'debate'", (run_id,))["n"] > 0
    assert db.fetch_one("SELECT COUNT(*) AS n FROM decisions WHERE run_id = ?", (run_id,))["n"] > 0
    assert db.fetch_one("SELECT COUNT(*) AS n FROM votes WHERE run_id = ?", (run_id,))["n"] > 0
    assert db.fetch_one("SELECT COUNT(*) AS n FROM positions WHERE run_id = ?", (run_id,))["n"] > 0
    minutes = db.fetch_one("SELECT minutes_text FROM meetings WHERE run_id = ? ORDER BY sim_month DESC LIMIT 1", (run_id,))
    assert "Decisions" in minutes["minutes_text"]


def test_memory_stays_under_limit(pilot):
    db, orch, run_ids, _ = pilot
    limit = int(orch.config.budget.raw["memory"]["max_tokens"])
    rows = db.fetch_all("SELECT token_estimate FROM agent_memories WHERE run_id = ?", (run_ids[0],))
    assert rows and max(r["token_estimate"] for r in rows) <= limit


def test_engine_and_metrics_produce_rows(pilot):
    db, _, run_ids, _ = pilot
    run_id = run_ids[0]
    assert db.fetch_one("SELECT COUNT(*) AS n FROM engine_draws WHERE run_id = ?", (run_id,))["n"] > 0
    assert db.fetch_one("SELECT COUNT(*) AS n FROM outcome_reports WHERE run_id = ?", (run_id,))["n"] == 3
    metrics = {r["metric"] for r in db.fetch_all("SELECT DISTINCT metric FROM metrics WHERE run_id = ?", (run_id,))}
    for name in ("proposals_submitted", "control_count", "ai_spend_cumulative", "speaking_share", "suspicion_rate", "cost_usd",
                 "unanimity_rate", "type_token_ratio"):
        assert name in metrics, name
    assert db.fetch_one("SELECT COUNT(*) AS n FROM coded_measures WHERE run_id = ?", (run_id,))["n"] > 0
    for rid in run_ids:
        assert db.fetch_one("SELECT COUNT(*) AS n FROM metrics WHERE run_id = ? AND metric = 'policy_similarity_cross_bank'",
                            (rid,))["n"] == 3


def test_every_call_logged_with_cost(pilot):
    db, _, _, _ = pilot
    row = db.fetch_one("SELECT COUNT(*) AS n, SUM(CASE WHEN batch THEN 1 ELSE 0 END) AS batched, MIN(cost_usd) AS min_cost "
                       "FROM llm_calls")
    assert row["n"] > 100 and row["batched"] > 0 and row["min_cost"] >= 0


def test_paired_banks_share_exogenous_draws(pilot):
    db, _, run_ids, _ = pilot
    draws = [{r["variable"]: r["value"] for r in db.fetch_all(
        "SELECT variable, value FROM engine_draws WHERE run_id = ? AND variable LIKE 'event_%' AND sim_month = '2027-02'", (rid,))}
        for rid in run_ids]
    assert draws[0] and draws[0] == draws[1]


def test_no_leaks_in_agent_facing_records(pilot):
    from sim.realism import find_leaks
    db, _, run_ids, _ = pilot
    texts = [r["body"] for r in db.fetch_all("SELECT body FROM inbox_items")] + \
            [r["body"] for r in db.fetch_all("SELECT body FROM news_items")] + \
            [r["report_text"] for r in db.fetch_all("SELECT report_text FROM outcome_reports")]
    assert texts and not [l for t in texts for l in find_leaks(t)]


def test_fork_from_checkpoint_with_injected_event_continues_independently(pilot):
    db, orch, run_ids, data_dir = pilot
    parent = run_ids[0]
    fork = fork_run(db, parent_run_id=parent, from_month="2027-03", data_dir=data_dir, reason="data breach branch",
                    inject_event={"event_type": "data_leak", "severity": "high", "notes": "customer records exposed"})
    assert db.fetch_one("SELECT COUNT(*) AS n FROM meetings WHERE run_id = ?", (fork,))["n"] == 3
    assert db.fetch_one("SELECT COUNT(*) AS n FROM interventions WHERE run_id = ? AND kind IN ('fork', 'inject_event')", (fork,))["n"] == 2
    db.update("runs", {"status": "running"}, where={"run_id": fork})
    assert orch.advance(fork) == "2027-04"
    assert orch.advance(parent) == "2027-04"
    leak = db.fetch_one("SELECT COUNT(*) AS n FROM events WHERE run_id = ? AND type = 'data_leak'", (fork,))["n"]
    assert leak == 1
    assert db.fetch_one("SELECT COUNT(*) AS n FROM events WHERE run_id = ? AND type = 'data_leak' AND source = 'injected'", (parent,))["n"] == 0
    assert db.fetch_one("SELECT COUNT(*) AS n FROM inbox_items WHERE run_id = ? AND event_id IN "
                        "(SELECT event_id FROM events WHERE run_id = ? AND type = 'data_leak')", (fork, fork))["n"] == 1


def test_failed_month_rolls_back(pilot, monkeypatch):
    db, orch, run_ids, _ = pilot
    run_id = run_ids[1]
    before = {t: db.fetch_one(f"SELECT COUNT(*) AS n FROM {t} WHERE run_id = ?", (run_id,))["n"]
              for t in ("meetings", "messages", "events", "inbox_items")}
    import sim.orchestrator as orchestrator_module

    def boom(*args, **kwargs):
        raise RuntimeError("engine exploded")

    monkeypatch.setattr(orchestrator_module, "run_engine_month", boom)
    with pytest.raises(RuntimeError):
        orch.advance(run_id)
    after = {t: db.fetch_one(f"SELECT COUNT(*) AS n FROM {t} WHERE run_id = ?", (run_id,))["n"] for t in before}
    assert after == before
    assert db.fetch_one("SELECT status FROM runs WHERE run_id = ?", (run_id,))["status"] == "failed"
    assert db.fetch_one("SELECT COUNT(*) AS n FROM alerts WHERE kind = 'worker_error'")["n"] >= 1


def test_hard_kill_mid_month_is_recovered_on_next_advance(pilot):
    """Simulate SIGKILL: a snapshot file exists and partial rows were written, but no rollback ran."""
    from sim import checkpoint
    db, orch, run_ids, data_dir = pilot
    run_id = run_ids[0]
    ctx = orch.context(run_id)
    month = orch.next_month(run_id)
    snapshot = checkpoint.dump_run(db, run_id, ctx.policy_repo)
    checkpoint.write_snapshot(snapshot, checkpoint.snapshot_path(data_dir, run_id, month))
    db.insert("meetings", {"meeting_id": f"{run_id}/meeting/{month}", "run_id": run_id, "bank_id": ctx.run["bank_id"],
                           "sim_month": month, "meeting_date": "2027-05-11", "agenda": [], "status": "open"})
    db.update("runs", {"status": "running"}, where={"run_id": run_id})
    assert orch.advance(run_id) == month
    assert db.fetch_one("SELECT COUNT(*) AS n FROM meetings WHERE run_id = ? AND sim_month = ?", (run_id, month))["n"] == 1
    assert db.fetch_one("SELECT COUNT(*) AS n FROM interventions WHERE run_id = ? AND kind = 'recovered_interrupted_month'",
                        (run_id,))["n"] == 1
    assert not checkpoint.snapshot_path(data_dir, run_id, month).exists()


def test_every_member_records_every_position_and_ballot(pilot):
    db, _, run_ids, _ = pilot
    for run_id in run_ids:
        rows = db.fetch_all("SELECT d.meeting_id, d.item_id, (SELECT COUNT(*) FROM votes v WHERE v.meeting_id = d.meeting_id "
                            "AND v.item_id = d.item_id) AS ballots FROM decisions d WHERE d.run_id = ?", (run_id,))
        assert rows and all(r["ballots"] == 8 for r in rows)


def test_notes_are_written_for_every_member_every_month(pilot):
    db, _, run_ids, _ = pilot
    for run_id in run_ids:
        rows = db.fetch_all("SELECT sim_month, COUNT(*) AS n FROM agent_memories WHERE run_id = ? GROUP BY sim_month", (run_id,))
        assert rows and all(r["n"] == 8 for r in rows), rows
