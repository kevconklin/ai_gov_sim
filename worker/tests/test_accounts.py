"""Accounts: a password that verifies, a membership on the record, and a hash format the dashboard shares."""

from __future__ import annotations

from datetime import date

import pytest

from conftest import REPO_ROOT
from govern import accounts
from govern.config import load_config
from govern.db import Database
from govern.workspace import create_workspace

CONFIG = REPO_ROOT / "config"
WHO = dict(actor="dana@harbor.example", source="dashboard_session")


@pytest.fixture
def ws(tmp_path):
    db = Database.connect_sqlite(tmp_path / "g.sqlite")
    db.migrate(REPO_ROOT / "db" / "migrations")
    run_id = create_workspace(db, load_config(CONFIG), config_dir=CONFIG, data_dir=tmp_path, name="Harbor Health",
                              risk_appetite="Use AI to cut clinician admin time. Never let it make a clinical decision.",
                              today=date(2026, 9, 29), **WHO)
    return db, run_id


def test_a_password_hashes_with_scrypt_and_verifies():
    stored = accounts.hash_password("correct horse battery staple")
    assert stored.startswith("scrypt$16384$8$1$")
    assert accounts.verify_password("correct horse battery staple", stored)
    assert not accounts.verify_password("wrong", stored)
    assert not accounts.verify_password("x", "garbage")
    with pytest.raises(accounts.AccountError, match="12 characters"):
        accounts.hash_password("short")


def test_a_user_needs_an_email_and_a_name_and_is_unique(ws):
    db, _ = ws
    uid = accounts.create_user(db, email="Dana@Harbor.example", name="Dana Whitfield", password="a long enough password", role="operator")
    assert accounts.user_by_email(db, "dana@harbor.example")["user_id"] == uid
    with pytest.raises(accounts.AccountError, match="already"):
        accounts.create_user(db, email="dana@harbor.example", name="Again", password="a long enough password")
    with pytest.raises(accounts.AccountError, match="email"):
        accounts.create_user(db, email="nope", name="Nobody", password="a long enough password")


def test_membership_changes_are_on_the_change_record(ws):
    db, run_id = ws
    uid = accounts.create_user(db, email="lee@harbor.example", name="Lee Park", password="a long enough password")
    accounts.set_member(db, run_id, user_id=uid, role="asks", reason="Joined the finance team.", **WHO)
    accounts.set_member(db, run_id, user_id=uid, role="decides", reason="Now heads finance and signs for it.", **WHO)
    accounts.set_member(db, run_id, user_id=uid, role="decides", reason="No change, so no record.", **WHO)
    assert [m["role"] for m in accounts.members(db, run_id)] == ["decides"]
    accounts.remove_member(db, run_id, user_id=uid, reason="Left the organization.", **WHO)
    assert accounts.members(db, run_id) == []
    rows = db.fetch_all("SELECT before_value, after_value, target FROM config_changes WHERE run_id = ? AND area = 'people' ORDER BY changed_at, change_id", (run_id,))
    assert [(r["before_value"], r["after_value"]) for r in rows] == [(None, "asks"), ("asks", "decides"), ("decides", None)]
    assert rows[0]["target"] == "Lee Park <lee@harbor.example>"
    with pytest.raises(accounts.AccountError, match="role"):
        accounts.set_member(db, run_id, user_id=uid, role="king", reason="Not a role at all.", **WHO)
    # re-adding after removal reuses the row
    accounts.set_member(db, run_id, user_id=uid, role="asks", reason="Back as a contractor.", **WHO)
    assert len(db.fetch_all("SELECT 1 FROM memberships WHERE run_id = ?", (run_id,))) == 1


def test_memberships_travel_with_the_workspace():
    from sim.checkpoint import RUN_TABLES
    assert "memberships" in RUN_TABLES
