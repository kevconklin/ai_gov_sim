"""A customer shapes its own committee: how many sit, who they are, what they aim for, and which model each is."""

from __future__ import annotations

from datetime import date

import pytest

from conftest import REPO_ROOT
from govern import committee, providers
from govern.config import load_config
from govern.context import ReviewContext, load_org_profile
from govern.db import Database
from govern.workspace import create_workspace

CONFIG = REPO_ROOT / "config"
WHO = dict(actor="kevin@northwind.example", source="dashboard_session")
WHY = "The board asked for a clinical voice on the committee."
BRIEF = "You speak for patient safety. You ask what happens to a patient when the system is wrong, and who notices."


@pytest.fixture
def ws(tmp_path):
    db = Database.connect_sqlite(tmp_path / "g.sqlite")
    db.migrate(REPO_ROOT / "db" / "migrations")
    config = load_config(CONFIG)
    run_id = create_workspace(db, config, config_dir=CONFIG, data_dir=tmp_path, name="Harbor Health",
                              risk_appetite="Use AI to cut admin time, never to make a clinical decision.", today=date(2026, 9, 18))
    registry = providers.Registry(providers.load_providers(CONFIG), env={"ANTHROPIC_API_KEY": "k", "OPENAI_API_KEY": "k"})
    yield db, run_id, config, registry, tmp_path
    db.close()


def changes(db, run_id):
    return db.fetch_all("SELECT target, before_value, after_value, actor FROM config_changes WHERE run_id = ? AND area = 'committee' "
                        "ORDER BY changed_at, change_id", (run_id,))


def test_a_seat_is_added_and_sits_last_in_the_speaking_order(ws):
    db, run_id, config, registry, _ = ws
    committee.add_seat(db, run_id, seat="clinical", title="Chief Medical Officer", name="Clinical", brief=BRIEF,
                       models=config.models, registry=registry, reason=WHY, **WHO)
    assert load_org_profile(db, run_id).seats[-1] == "clinical"
    assert len(committee.seats(db, run_id)) == 9
    assert changes(db, run_id)[0]["target"] == "clinical added"


def test_a_seat_is_removed_but_its_history_is_kept(ws):
    db, run_id, *_ = ws
    committee.remove_seat(db, run_id, "business", reason="The sponsor now submits matters instead of judging them.", **WHO)
    assert "business" not in load_org_profile(db, run_id).seats
    assert len(committee.seats(db, run_id)) == 7
    assert db.fetch_one("SELECT active_to FROM agents WHERE run_id = ? AND seat = 'business'", (run_id,))["active_to"] is not None


def test_the_chair_cannot_be_removed_and_a_committee_cannot_shrink_to_one(ws):
    db, run_id, *_ = ws
    with pytest.raises(ValueError, match="chair"):
        committee.remove_seat(db, run_id, "chair", reason=WHY, **WHO)
    for seat in ("technology", "security", "legal", "risk", "finance", "business"):
        committee.remove_seat(db, run_id, seat, reason="Trimming the committee for a pilot.", **WHO)
    with pytest.raises(ValueError, match="at least two"):
        committee.remove_seat(db, run_id, "customer", reason="Trimming the committee for a pilot.", **WHO)


def test_a_removed_seat_can_be_added_back(ws):
    db, run_id, config, registry, _ = ws
    committee.remove_seat(db, run_id, "business", reason="Trimming the committee for a pilot.", **WHO)
    committee.add_seat(db, run_id, seat="business", title="Business Sponsor", name="Business", brief=BRIEF,
                       models=config.models, registry=registry, reason="Pilot ended; restoring the seat.", **WHO)
    assert [s["seat"] for s in committee.seats(db, run_id)].count("business") == 1


def test_a_seats_title_goal_and_model_change_one_record_each(ws):
    db, run_id, config, registry, _ = ws
    changed = committee.update_seat(db, run_id, "risk", {"title": "Head of Model Risk", "model": "openai:gpt-4.1", "stance_baseline": 1.5},
                                    models=config.models, registry=registry, reason="Second-line review moved to model risk.", **WHO)
    assert sorted(changed) == ["model", "stance_baseline", "title"]
    rows = {r["target"]: r for r in changes(db, run_id)}
    assert rows["risk: model"]["before_value"] is None and rows["risk: model"]["after_value"] == "openai:gpt-4.1"
    assert rows["risk: title"]["before_value"] == "Chief Risk Officer"


def test_a_model_must_be_on_offer_and_its_provider_must_have_a_key(ws):
    db, run_id, config, registry, _ = ws
    with pytest.raises(ValueError, match="not a model on offer"):
        committee.update_seat(db, run_id, "risk", {"model": "openai:made-up"}, models=config.models, registry=registry, reason=WHY, **WHO)
    with pytest.raises(ValueError, match="HF_TOKEN"):
        committee.update_seat(db, run_id, "risk", {"model": "huggingface:Qwen/Qwen2.5-72B-Instruct"}, models=config.models,
                              registry=registry, reason=WHY, **WHO)


def test_clearing_a_model_returns_the_seat_to_the_default(ws):
    db, run_id, config, registry, _ = ws
    committee.update_seat(db, run_id, "risk", {"model": "openai:gpt-4.1"}, models=config.models, registry=registry, reason=WHY, **WHO)
    committee.update_seat(db, run_id, "risk", {"model": ""}, models=config.models, registry=registry, reason="Back to the default.", **WHO)
    assert db.fetch_one("SELECT model FROM agents WHERE run_id = ? AND seat = 'risk'", (run_id,))["model"] is None


def test_each_seat_is_called_on_its_own_model(ws):
    """The point of the whole change: one committee, several models, each turn routed to its own."""
    from govern.agents.runner import run_turn
    from govern.llm import LLMClient
    from govern.tools import ToolSession
    db, run_id, config, _, tmp_path = ws
    sent = []

    def transport(url, headers, body):
        sent.append((url, body["model"]))
        return {"choices": [{"finish_reason": "stop", "message": {"content": "I would wait."}}], "usage": {"prompt_tokens": 9, "completion_tokens": 3}}

    live = providers.Registry(providers.load_providers(CONFIG), transport=transport, env={"OPENAI_API_KEY": "k", "HF_TOKEN": "k"})
    committee.update_seat(db, run_id, "risk", {"model": "openai:gpt-4.1"}, models=config.models, registry=live, reason=WHY, **WHO)
    committee.update_seat(db, run_id, "legal", {"model": "huggingface:meta-llama/Llama-3.3-70B-Instruct"}, models=config.models,
                          registry=live, reason=WHY, **WHO)
    run = dict(db.fetch_one("SELECT * FROM runs WHERE run_id = ?", (run_id,)))
    ctx = ReviewContext(db=db, llm=LLMClient(db=db, config=config, registry=live, sleep=lambda s: None), config=config, run=run, data_dir=tmp_path)
    for seat in ("risk", "legal"):
        agent = next(a for a in ctx.active_agents() if a.seat == seat)
        session = ToolSession(ctx=ctx, agent=agent, phase="debate", month="2026-09", meeting_id="m", meeting_date=date(2026, 9, 20))
        run_turn(ctx, session, instruction="Speak.", packet="Pre-read.", purpose="committee_turn", max_tokens=50, tools_enabled=False)
    assert sent == [("https://api.openai.com/v1/chat/completions", "gpt-4.1"),
                    ("https://router.huggingface.co/v1/chat/completions", "meta-llama/Llama-3.3-70B-Instruct")]
    assert {r["model"] for r in db.fetch_all("SELECT model FROM llm_calls WHERE run_id = ?", (run_id,))} == \
        {"openai:gpt-4.1", "huggingface:meta-llama/Llama-3.3-70B-Instruct"}


def test_the_catalog_is_published_with_which_providers_have_a_key(ws):
    db, _, config, registry, _ = ws
    providers.publish_catalog(db, config.models, registry)
    rows = {r["model_id"]: r for r in db.fetch_all("SELECT * FROM model_catalog")}
    assert rows["openai:gpt-4.1"]["available"] and not rows["huggingface:Qwen/Qwen2.5-72B-Instruct"]["available"]
    assert rows["local:default"]["available"]          # a self-hosted endpoint needs no key
