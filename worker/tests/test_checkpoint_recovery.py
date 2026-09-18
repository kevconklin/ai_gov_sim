"""Snapshots live in the database, so a worker that dies mid-month can be replaced anywhere."""

from __future__ import annotations

import pytest

from sim import checkpoint


@pytest.fixture
def seeded(db, run_id):
    db.insert("use_cases", {"use_case_id": f"{run_id}/uc/UC-001", "run_id": run_id, "bank_id": "calder_ridge",
                            "title": "Before", "description": "d", "details": {}, "status": "proposed",
                            "proposed_month": "2027-01"})
    return run_id


def test_no_snapshot_means_the_month_was_not_interrupted(db, run_id):
    assert checkpoint.load_snapshot(db, run_id, "2027-01") is None


def test_a_snapshot_round_trips_through_the_database(db, seeded):
    dump = checkpoint.dump_run(db, seeded, None)
    checkpoint.save_snapshot(db, seeded, "2027-01", dump)
    loaded = checkpoint.load_snapshot(db, seeded, "2027-01")
    assert loaded is not None
    assert loaded["run_id"] == seeded
    assert [r["title"] for r in loaded["tables"]["use_cases"]] == ["Before"]


def test_rollback_restores_from_the_stored_snapshot(db, seeded):
    checkpoint.save_snapshot(db, seeded, "2027-01", checkpoint.dump_run(db, seeded, None))
    db.update("use_cases", {"title": "Changed mid-month"}, where={"use_case_id": f"{seeded}/uc/UC-001"})
    checkpoint.rollback(db, checkpoint.load_snapshot(db, seeded, "2027-01"), None)
    row = db.fetch_one("SELECT title FROM use_cases WHERE use_case_id = ?", (f"{seeded}/uc/UC-001",))
    assert row["title"] == "Before"


def test_the_snapshot_survives_the_rollback_it_is_used_for(db, seeded):
    """A rollback deletes every run-scoped row; deleting the snapshot too would strand the run."""
    checkpoint.save_snapshot(db, seeded, "2027-01", checkpoint.dump_run(db, seeded, None))
    checkpoint.rollback(db, checkpoint.load_snapshot(db, seeded, "2027-01"), None)
    assert checkpoint.load_snapshot(db, seeded, "2027-01") is not None


def test_clearing_a_snapshot_marks_the_month_complete(db, seeded):
    checkpoint.save_snapshot(db, seeded, "2027-01", checkpoint.dump_run(db, seeded, None))
    checkpoint.clear_snapshot(db, seeded, "2027-01")
    assert checkpoint.load_snapshot(db, seeded, "2027-01") is None


def test_snapshots_are_not_run_scoped_for_deletion():
    assert "run_snapshots" not in checkpoint.RUN_TABLES
