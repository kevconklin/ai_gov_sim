"""A backup that has been restored from: the record, the policies, and nothing partial."""

from __future__ import annotations

from datetime import date, datetime, timezone

import pytest

from conftest import REPO_ROOT
from govern.backup import BackupError, backup, prune, restore
from govern.config import load_config
from govern.db import Database
from govern.intake import submit_item
from govern.policy import PolicyRepo
from govern.workspace import create_workspace

CONFIG = REPO_ROOT / "config"


def test_backup_then_restore_gives_the_same_record_and_policy(tmp_path):
    data = tmp_path / "data"; data.mkdir()
    target = str(data / "sim.sqlite")
    db = Database.connect_sqlite(target)
    db.migrate(REPO_ROOT / "db" / "migrations")
    run_id = create_workspace(db, load_config(CONFIG), config_dir=CONFIG, data_dir=data, name="Harbor Health",
                              risk_appetite="Use AI to cut clinician admin time. Never let it make a clinical decision.",
                              today=date(2026, 9, 29), starter="general_business", actor="dana@harbor.example", source="test")
    submit_item(db, run_id, kind="tool", title="Otter.ai", description="Meeting notes for the clinic.", submitted_by="ops@harbor.example")
    policy_before = PolicyRepo(data / "policies" / run_id / "harbor_health").read()

    made = backup(target, data, tmp_path / "backups", now=datetime(2026, 9, 29, 12, tzinfo=timezone.utc))
    assert made["kind"] == "sqlite" and made["policies"] is True
    assert (tmp_path / "backups" / "20260929T120000Z" / "MANIFEST.txt").is_file()

    # restore into an empty place, as a drill
    fresh = tmp_path / "restored"; fresh.mkdir()
    out = restore(tmp_path / "backups" / "20260929T120000Z", str(fresh / "sim.sqlite"), fresh)
    assert out["policies"] is True
    db2 = Database.connect_sqlite(fresh / "sim.sqlite")
    assert db2.fetch_one("SELECT COUNT(*) AS n FROM items")["n"] == 2                    # the starter matter and Otter.ai
    assert db2.fetch_one("SELECT COUNT(*) AS n FROM config_changes")["n"] == db.fetch_one("SELECT COUNT(*) AS n FROM config_changes")["n"]
    assert PolicyRepo(fresh / "policies" / run_id / "harbor_health").read() == policy_before

    # never over a database that has something in it
    with pytest.raises(BackupError, match="already exists"):
        restore(tmp_path / "backups" / "20260929T120000Z", target, data)


def test_prune_keeps_the_newest_sets(tmp_path):
    for stamp in ("20260901T000000Z", "20260902T000000Z", "20260903T000000Z"):
        (tmp_path / stamp).mkdir(); (tmp_path / stamp / "MANIFEST.txt").write_text("kind: sqlite\n")
    gone = prune(tmp_path, keep=2)
    assert [p.split("/")[-1] for p in gone] == ["20260901T000000Z"]
    assert sorted(p.name for p in tmp_path.iterdir()) == ["20260902T000000Z", "20260903T000000Z"]
