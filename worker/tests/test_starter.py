"""Governance in an hour: a starter kit gives a new organization a policy, documents, and a first matter to review."""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

from conftest import REPO_ROOT
from govern import settings, starter
from govern.config import load_config
from govern.db import Database
from govern.intake import get_item
from govern.policy import CONTROL_ID, PolicyRepo, sections, stats
from govern.settings import FRAMEWORKS
from govern.workspace import create_workspace

CONFIG = REPO_ROOT / "config"
TODAY = date(2026, 9, 27)
WHO = dict(actor="dana@harbor.example", source="dashboard_session")
APPETITE = "Use AI to cut clinician admin time. Never let it make a clinical decision."


@pytest.fixture
def db(tmp_path):
    database = Database.connect_sqlite(tmp_path / "g.sqlite")
    database.migrate(REPO_ROOT / "db" / "migrations")
    return database


# ---- the kits themselves ----------------------------------------------------------------------

def test_every_kit_loads_with_its_controls_documents_and_stances():
    kits = starter.load_starters(CONFIG)
    assert set(kits) >= {"general_business", "regulated", "software"}
    for kit in kits.values():
        assert kit.framework in FRAMEWORKS and kit.framework != "none"
        assert set(kit.stances) == {"cautious", "balanced", "ambitious"}
        assert all(len(s.text) >= 20 for s in kit.stances.values())
        assert len(kit.controls) >= 15
        assert {d.kind for d in kit.documents} == {"charter", "acceptable_use"}
        assert "{org}" in kit.first_matter.title


def test_every_library_control_is_one_paragraph_with_a_framework_mapping():
    library = starter.load_controls(CONFIG)
    assert len(library) >= 25
    for control in library.values():
        assert "\n" not in control.text.strip(), control.key
        assert control.map, control.key
        assert set(control.map) <= set(FRAMEWORKS) - {"none"}, control.key


def test_a_kit_may_only_name_controls_the_library_has(tmp_path):
    import shutil
    bad = tmp_path / "starters"
    shutil.copytree(CONFIG / "starters", bad)
    (bad / "broken.yaml").write_text((bad / "general_business.yaml").read_text()
                                     .replace("id: general_business", "id: broken").replace("  - scope\n", "  - nonesuch\n"))
    with pytest.raises(starter.StarterError, match="nonesuch"):
        starter.load_starters(tmp_path)


# ---- rendering the policy -----------------------------------------------------------------------

def test_the_rendered_policy_numbers_controls_in_order_and_tags_the_chosen_framework():
    kit = starter.load_starters(CONFIG)["general_business"]
    text = starter.render_policy(kit, org="Harbor Health", framework="nist_ai_rmf")
    numbers = [int(n) for n in CONTROL_ID.findall(text)]
    assert numbers == list(range(1, len(kit.controls) + 1))
    assert "(NIST AI RMF GOVERN 1.6)" in text
    assert "Harbor Health" in text and "{org}" not in text
    assert "not legal advice" in text
    assert list(sections(text)) == ["Scope and accountability", "Inventory and approval", "Data and confidentiality",
                                    "Human oversight and fairness", "Vendors and third parties", "Incidents and review"]
    # one control per paragraph, so the dashboard lists them one per row
    body = "\n\n".join(sections(text).values())
    assert all(CONTROL_ID.match(p) for p in body.split("\n\n") if p.strip())


def test_a_control_with_no_mapping_for_the_framework_is_left_untagged():
    kit = starter.load_starters(CONFIG)["general_business"]
    text = starter.render_policy(kit, org="Harbor Health", framework="sr_11_7")
    line = next(p for p in text.split("\n\n") if "interacting with an AI system" in p)     # disclosure has no SR 11-7 clause
    assert not line.rstrip().endswith(")")
    assert "(SR 11-7 Model inventory)" in text


def test_rendering_refuses_an_unknown_framework():
    kit = starter.load_starters(CONFIG)["software"]
    with pytest.raises(starter.StarterError, match="framework"):
        starter.render_policy(kit, org="Acme", framework="cobit")


# ---- applying a kit to a workspace ---------------------------------------------------------------

def test_a_workspace_made_from_a_kit_has_a_policy_two_documents_a_profile_and_one_matter(db, tmp_path):
    config = load_config(CONFIG)
    run_id = create_workspace(db, config, config_dir=CONFIG, data_dir=tmp_path, name="Harbor Health",
                              risk_appetite=APPETITE, today=TODAY, starter="regulated", **WHO)

    policy = PolicyRepo(tmp_path / "policies" / run_id / "harbor_health").read()
    assert len(stats(policy).controls) == len(starter.load_starters(CONFIG)["regulated"].controls)
    assert "(ISO/IEC 42001 " in policy                       # the kit's default framework, since none was chosen
    version = db.fetch_one("SELECT sim_month, control_count, policy_text FROM policy_versions WHERE run_id = ?", (run_id,))
    assert version["sim_month"] == "2026-09" and version["policy_text"] == policy

    docs = settings.documents(db, run_id)
    assert [(d["kind"], d["added_by"]) for d in docs] == [("charter", WHO["actor"]), ("acceptable_use", WHO["actor"])]
    assert all("Harbor Health" in d["body"] and "{org}" not in d["body"] for d in docs)

    profile = db.fetch_one("SELECT framework, facts, business_goals FROM org_profiles WHERE run_id = ?", (run_id,))
    assert profile["framework"] == "iso_42001"
    assert profile["business_goals"].startswith("Use AI to reduce operational cost")
    assert "has not yet described itself" in profile["facts"]       # the kit does not invent facts about them

    items = db.fetch_all("SELECT item_id, kind, title, status, submitted_by, risk_tier FROM items WHERE run_id = ?", (run_id,))
    assert len(items) == 1
    assert (items[0]["kind"], items[0]["status"], items[0]["risk_tier"]) == ("policy_change", "submitted", "medium")
    assert items[0]["title"] == "Does the starter AI policy fit Harbor Health?"
    assert items[0]["submitted_by"] == WHO["actor"]
    assert "ISO/IEC 42001" in get_item(db, items[0]["item_id"])["description"]


def test_the_persons_own_choices_beat_the_kits_defaults(db, tmp_path):
    config = load_config(CONFIG)
    run_id = create_workspace(db, config, config_dir=CONFIG, data_dir=tmp_path, name="Harbor Health",
                              risk_appetite=APPETITE, today=TODAY, starter="regulated", facts="A 40-clinician group practice.",
                              profile={"framework": "nist_ai_rmf", "business_goals": "Cut charting time by a third."}, **WHO)
    profile = db.fetch_one("SELECT framework, facts, business_goals FROM org_profiles WHERE run_id = ?", (run_id,))
    assert (profile["framework"], profile["facts"], profile["business_goals"]) == ("nist_ai_rmf", "A 40-clinician group practice.", "Cut charting time by a third.")
    policy = PolicyRepo(tmp_path / "policies" / run_id / "harbor_health").read()
    assert "(NIST AI RMF " in policy and "ISO/IEC" not in policy


def test_no_framework_chosen_means_the_kits_default(db, tmp_path):
    config = load_config(CONFIG)
    run_id = create_workspace(db, config, config_dir=CONFIG, data_dir=tmp_path, name="Harbor Health",
                              risk_appetite=APPETITE, today=TODAY, starter="software", profile={"framework": "none"}, **WHO)
    assert db.fetch_one("SELECT framework FROM org_profiles WHERE run_id = ?", (run_id,))["framework"] == "eu_ai_act"
    assert "(EU AI Act " in PolicyRepo(tmp_path / "policies" / run_id / "harbor_health").read()


def test_everything_the_kit_set_is_on_the_change_record(db, tmp_path):
    config = load_config(CONFIG)
    run_id = create_workspace(db, config, config_dir=CONFIG, data_dir=tmp_path, name="Harbor Health",
                              risk_appetite=APPETITE, today=TODAY, starter="general_business", **WHO)
    log = settings.change_log(db, run_id)
    by_area = {(r["area"], r["target"]): r for r in log}
    assert ("starter", "general_business") in by_area
    kit_row = by_area[("starter", "general_business")]
    assert kit_row["actor"] == WHO["actor"] and kit_row["source"] == WHO["source"]
    assert "Starter kit" in kit_row["reason"]
    assert ("policy", "starter") in by_area and "20 controls" in by_area[("policy", "starter")]["after_value"]
    assert ("document", "Harbor Health AI Governance Committee charter") in by_area
    assert ("document", "Acceptable use of AI tools at Harbor Health") in by_area
    assert all(r["actor"] == WHO["actor"] for r in log)


def test_no_kit_means_the_blank_start_it_always_was(db, tmp_path):
    config = load_config(CONFIG)
    run_id = create_workspace(db, config, config_dir=CONFIG, data_dir=tmp_path, name="Harbor Health",
                              risk_appetite=APPETITE, today=TODAY, **WHO)
    assert "No sections have been adopted yet" in PolicyRepo(tmp_path / "policies" / run_id / "harbor_health").read()
    assert settings.documents(db, run_id) == []
    assert db.fetch_all("SELECT 1 FROM items WHERE run_id = ?", (run_id,)) == []


def test_an_unknown_kit_is_refused_before_anything_is_created(db, tmp_path):
    config = load_config(CONFIG)
    with pytest.raises(starter.StarterError, match="nonesuch"):
        create_workspace(db, config, config_dir=CONFIG, data_dir=tmp_path, name="Harbor Health",
                         risk_appetite=APPETITE, today=TODAY, starter="nonesuch", **WHO)
    assert db.fetch_all("SELECT 1 FROM runs") == []


# ---- what the dashboard reads ------------------------------------------------------------------

def test_publishing_lets_the_dashboard_offer_the_kits(db):
    starter.publish_starters(db, CONFIG)
    rows = db.fetch_all("SELECT starter_id, label, framework, stances, control_count, document_count FROM starter_kits ORDER BY starter_id")
    assert [r["starter_id"] for r in rows] == ["general_business", "regulated", "software"]
    regulated = next(r for r in rows if r["starter_id"] == "regulated")
    assert regulated["framework"] == "iso_42001" and regulated["document_count"] == 2
    assert regulated["control_count"] == len(starter.load_starters(CONFIG)["regulated"].controls)
    import json
    assert set(json.loads(regulated["stances"])) == {"cautious", "balanced", "ambitious"}
    starter.publish_starters(db, CONFIG)        # publishing again replaces, never duplicates
    assert len(db.fetch_all("SELECT 1 FROM starter_kits")) == 3


# ---- the first review is real ------------------------------------------------------------------

def test_the_first_matter_can_be_reviewed_and_signed_on_day_one(db, tmp_path):
    from govern.agenda import candidates
    from govern.attestation import apply_meeting, record_attestation
    from govern.config import load_agenda_priority, load_attestation
    from govern.llm import LLMClient
    from govern.packet import AgendaItem
    from govern.panels import load_panels
    from govern.service import ReviewService
    from sim.demo_llm import DemoAnthropic

    config = load_config(CONFIG)
    run_id = create_workspace(db, config, config_dir=CONFIG, data_dir=tmp_path, name="Harbor Health",
                              risk_appetite=APPETITE, today=TODAY, starter="general_business", **WHO)
    ranked = candidates(db, run_id, load_agenda_priority(CONFIG), today=TODAY)
    assert [c.title for c in ranked] == ["Policy change: Does the starter AI policy fit Harbor Health?"]

    service = ReviewService(db=db, config=config, llm=LLMClient(db=db, config=config, client=DemoAnthropic(), sleep=lambda s: None),
                            data_dir=tmp_path, panel_rules=load_panels(CONFIG))
    agenda = [AgendaItem(c.ref_id.rsplit("/", 1)[-1], c.kind, c.title, c.ref_id) for c in ranked]
    result = service.convene(run_id, agenda, on=TODAY)
    decision = result.decisions[0]
    record_attestation(db, run_id, decision_id=decision.decision_id, actor=WHO["actor"], outcome="approved",
                       rationale="Adopted as our starting point; the committee's edits come back as policy changes.",
                       config=load_attestation(CONFIG), source="dashboard_session",
                       responded_to=[r["agent_id"] for r in db.fetch_all(
                           "SELECT agent_id FROM votes WHERE meeting_id = ? AND item_id = ? AND vote = 'no'",
                           (result.meeting_id, decision.item.item_id))])
    apply_meeting(service.context(run_id), result.meeting_id, month="2026-09", meeting_date=TODAY)
    assert get_item(db, ranked[0].ref_id)["status"] == "approved"
    # approving the starter changes no text, so the September version is still the kit's policy
    version = db.fetch_one("SELECT control_count FROM policy_versions WHERE run_id = ? AND sim_month = '2026-09'", (run_id,))
    assert version["control_count"] == 20
