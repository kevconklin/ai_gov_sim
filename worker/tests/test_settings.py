"""A customer configures its own committee, and every change leaves a record of who, what, and why."""

from __future__ import annotations

from datetime import date

import pytest

from conftest import REPO_ROOT
from govern import settings
from govern.committee import set_brief
from govern.config import load_config
from govern.context import load_org_profile
from govern.db import Database
from govern.workspace import create_workspace

CONFIG = REPO_ROOT / "config"
WHO = dict(actor="kevin@northwind.example", source="dashboard_session")
WHY = "Board approved a revised AI strategy in September."


@pytest.fixture
def ws(tmp_path):
    db = Database.connect_sqlite(tmp_path / "g.sqlite")
    db.migrate(REPO_ROOT / "db" / "migrations")
    run_id = create_workspace(db, load_config(CONFIG), config_dir=CONFIG, data_dir=tmp_path, name="Northwind Credit Union",
                              risk_appetite="Adopt AI where it improves member service, never at the cost of a finding.",
                              today=date(2026, 9, 18), actor="kevin@northwind.example", source="dashboard_session")
    yield db, run_id
    db.close()


def changes(db, run_id, area=None):
    rows = db.fetch_all("SELECT * FROM config_changes WHERE run_id = ? ORDER BY changed_at, change_id", (run_id,))
    return [r for r in rows if area is None or r["area"] == area]


def test_creating_a_customer_is_the_first_record(ws):
    db, run_id = ws
    first = changes(db, run_id, "workspace")
    assert len(first) == 1
    assert first[0]["actor"] == "kevin@northwind.example" and first[0]["after_value"] == "Northwind Credit Union"


def test_a_profile_change_records_before_after_who_and_why(ws):
    db, run_id = ws
    settings.update_profile(db, run_id, {"framework": "nist_ai_rmf", "business_goals": "Cut call handling time by a fifth."},
                            reason=WHY, **WHO)
    rows = {r["target"]: r for r in changes(db, run_id, "profile")}
    assert set(rows) == {"framework", "business_goals"}
    assert rows["framework"]["before_value"] is None and rows["framework"]["after_value"] == "nist_ai_rmf"
    assert rows["framework"]["actor"] == "kevin@northwind.example" and rows["framework"]["reason"] == WHY


def test_an_unchanged_field_leaves_no_record(ws):
    db, run_id = ws
    settings.update_profile(db, run_id, {"framework": "iso_42001"}, reason=WHY, **WHO)
    settings.update_profile(db, run_id, {"framework": "iso_42001"}, reason=WHY, **WHO)
    assert len(changes(db, run_id, "profile")) == 1


def test_changes_need_a_reason_a_known_field_and_a_known_framework(ws):
    db, run_id = ws
    with pytest.raises(settings.SettingsError, match="reason"):
        settings.update_profile(db, run_id, {"framework": "iso_42001"}, reason="because", **WHO)
    with pytest.raises(settings.SettingsError, match="cannot be changed"):
        settings.update_profile(db, run_id, {"run_id": "x"}, reason=WHY, **WHO)
    with pytest.raises(settings.SettingsError, match="framework"):
        settings.update_profile(db, run_id, {"framework": "made_up"}, reason=WHY, **WHO)
    with pytest.raises(settings.SettingsError, match="board's direction"):
        settings.update_profile(db, run_id, {"risk_appetite": "yes"}, reason=WHY, **WHO)


def test_what_the_committee_is_told_reflects_the_configuration(ws):
    db, run_id = ws
    settings.update_profile(db, run_id, {"framework": "nist_ai_rmf", "business_goals": "Cut call handling time by a fifth.",
                                         "ai_tools": "Fraud scoring from our card processor."}, reason=WHY, **WHO)
    facts = load_org_profile(db, run_id).facts
    assert "NIST AI Risk Management Framework" in facts
    assert "Cut call handling time" in facts and "Fraud scoring" in facts


def test_a_document_is_added_read_and_retired_not_deleted(ws):
    db, run_id = ws
    doc = settings.add_document(db, run_id, kind="acceptable_use", title="Acceptable use of AI tools",
                                body="Staff may not enter member data into public AI tools.", reason=WHY, **WHO)
    assert [d["title"] for d in settings.documents(db, run_id)] == ["Acceptable use of AI tools"]
    settings.retire_document(db, run_id, doc, reason="Superseded by the 2027 policy.", **WHO)
    assert settings.documents(db, run_id) == []
    assert db.fetch_one("SELECT body FROM documents WHERE document_id = ?", (doc,))["body"].startswith("Staff may not")
    assert [c["target"] for c in changes(db, run_id, "document")] == ["Acceptable use of AI tools"] * 2


def test_a_panel_change_is_recorded_with_the_seats_it_replaced(ws):
    db, run_id = ws
    settings.set_panel(db, run_id, kind="vendor", seats=["security", "legal"], config_dir=CONFIG, reason=WHY, **WHO)
    row = changes(db, run_id, "panel")[0]
    assert row["target"] == "vendor" and "finance" in row["before_value"] and row["after_value"] == "security, legal"
    with pytest.raises(settings.SettingsError, match="not on this committee"):
        settings.set_panel(db, run_id, kind="vendor", seats=["treasurer"], config_dir=CONFIG, reason=WHY, **WHO)


def test_rewriting_a_brief_records_the_old_and_new_text(ws):
    db, run_id = ws
    set_brief(db, run_id, "finance", "You answer for spend and return, and you refuse a pilot with no stopping rule.",
              reason=WHY, actor="kevin@northwind.example", source="dashboard_session")
    row = changes(db, run_id, "brief")[0]
    assert row["target"] == "finance" and "sceptical of pilots" in row["before_value"]
    assert "stopping rule" in row["after_value"] and row["actor"] == "kevin@northwind.example"


def test_the_record_cannot_be_rewritten_through_the_settings_api():
    assert not [name for name in dir(settings) if name.startswith(("delete_change", "update_change", "edit_change"))]


# ---- what reaches the committee -------------------------------------------


def _ctx(db, run_id, tmp_path):
    from govern.context import ReviewContext
    run = dict(db.fetch_one("SELECT * FROM runs WHERE run_id = ?", (run_id,)))
    return ReviewContext(db=db, llm=None, config=load_config(CONFIG), run=run, data_dir=tmp_path)


def test_the_pre_read_lists_documents_and_carries_a_questions_context(ws, tmp_path):
    from govern.intake import submit_item
    from govern.packet import AgendaItem, build_packet
    db, run_id = ws
    settings.add_document(db, run_id, kind="acceptable_use", title="Acceptable use of AI tools",
                          body="Staff may not enter member data into public AI tools.", reason=WHY, **WHO)
    item = submit_item(db, run_id, kind="question", title="May staff use public chat assistants?",
                       description="HR is drafting guidance and needs the committee's view before it goes out.",
                       submitted_by="hr@northwind.example",
                       details={"decision_this_informs": "Staff guidance due in October", "data_involved": ["member data"]})
    packet = build_packet(_ctx(db, run_id, tmp_path), month="2026-09", meeting_date=date(2026, 9, 20),
                          agenda=[AgendaItem("IT-001", "advisory", "May staff use public chat assistants?", item)])
    assert "Acceptable use of AI tools (acceptable use)" in packet
    assert "Items for advice, with no vote" in packet
    assert "HR is drafting guidance" in packet and "decision this informs: Staff guidance due in October" in packet
    assert "data involved: member data" in packet


def test_a_member_can_read_a_document_in_full(ws, tmp_path):
    from govern.tools import ToolSession, execute, tools_for
    db, run_id = ws
    settings.add_document(db, run_id, kind="charter", title="AI Committee Charter",
                          body="The committee advises. The Chief Risk Officer decides.", reason=WHY, **WHO)
    ctx = _ctx(db, run_id, tmp_path)
    session = ToolSession(ctx=ctx, agent=ctx.chair(), phase="position", month="2026-09", meeting_id="m",
                          meeting_date=date(2026, 9, 20))
    text, is_error = execute(session, "read_document", {"title": "charter"})
    assert not is_error and "The Chief Risk Officer decides." in text
    assert "read_document" in {t["name"] for t in tools_for(True)}
    assert "read_document" not in {t["name"] for t in tools_for(False)}     # the simulation's tool list is unchanged
