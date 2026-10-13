"""The research seat: the committee's one reach outside the room, fenced, logged, capped, and priced."""

from __future__ import annotations

from datetime import date

import pytest

from conftest import REPO_ROOT
from govern import research
from govern.committee import load_default_committee
from govern.config import load_config
from govern.db import Database
from govern.intake import submit_item
from govern.llm import LLMClient
from govern.packet import AgendaItem
from govern.panels import load_panels
from govern.pricing import TokenUsage, compute_cost
from govern.service import ReviewService
from govern.tools import NOT_AVAILABLE, ToolSession, execute, tools_for
from govern.untrusted import UNTRUSTED_END, UNTRUSTED_START
from govern.workspace import create_workspace
from sim.demo_llm import DemoAnthropic

CONFIG = REPO_ROOT / "config"
TODAY = date(2026, 10, 11)


@pytest.fixture
def workspace(tmp_path):
    db = Database.connect_sqlite(tmp_path / "g.sqlite")
    db.migrate(REPO_ROOT / "db" / "migrations")
    config = load_config(CONFIG)
    run_id = create_workspace(db, config, config_dir=CONFIG, data_dir=tmp_path, name="Harbor Health",
                              risk_appetite="Use AI to cut clinician admin time. Never let it make a clinical decision.", today=TODAY,
                              actor="dana@harbor.example", source="test")
    service = ReviewService(db=db, config=config, llm=LLMClient(db=db, config=config, client=DemoAnthropic(), sleep=lambda s: None),
                            data_dir=tmp_path, panel_rules=load_panels(CONFIG))
    return db, service, run_id


def _session(service, run_id, seat, meeting_id="m1"):
    ctx = service.context(run_id)
    agent = next(a for a in ctx.active_agents() if a.seat == seat)
    return ctx, ToolSession(ctx=ctx, agent=agent, phase="position", month="2026-10", meeting_id=meeting_id, meeting_date=TODAY,
                            decision_items={"IT-001": "AI vendor: Otter.ai"})


def test_the_default_committee_seats_a_research_adviser_with_the_capability():
    seats = load_default_committee(CONFIG)
    assert seats["research"]["capabilities"] == ["research"]
    assert all("capabilities" not in s for k, s in seats.items() if k != "research"), "only the research seat reaches the web"


def test_only_a_research_seat_on_a_disclosed_committee_is_offered_the_web_tools():
    assert {"web_search", "read_page"} <= {t["name"] for t in tools_for(True, ("research",))}
    assert not {"web_search", "read_page"} & {t["name"] for t in tools_for(True)}
    assert not {"web_search", "read_page"} & {t["name"] for t in tools_for(False, ("research",))}


def test_a_workspace_copies_the_capability_onto_the_seat(workspace):
    db, service, run_id = workspace
    agents = {a.seat: a for a in service.context(run_id).active_agents()}
    assert agents["research"].capabilities == ("research",)
    assert agents["chair"].capabilities == ()


def test_a_seat_without_the_capability_cannot_research(workspace):
    db, service, run_id = workspace
    _, session = _session(service, run_id, "chair")
    text, is_error = execute(session, "web_search", {"query": "Otter.ai data retention"})
    assert text == NOT_AVAILABLE
    assert db.fetch_one("SELECT COUNT(*) AS n FROM research_calls")["n"] == 0


def test_a_search_is_fenced_logged_and_priced(workspace):
    db, service, run_id = workspace
    ctx, session = _session(service, run_id, "research")
    text, is_error = execute(session, "web_search", {"query": "Otter.ai data retention and training terms", "item_id": "IT-001"})
    assert not is_error
    assert text.startswith("Web search 1 of") and UNTRUSTED_START in text and text.rstrip().endswith(UNTRUSTED_END)
    assert "research librarian" in text and "https://vendor.example/trust/data-handling" in text
    # the page's attempt to instruct the committee is inside the fence, so it arrives as evidence
    assert text.index("IGNORE PREVIOUS INSTRUCTIONS") > text.index(UNTRUSTED_START)
    row = db.fetch_one("SELECT * FROM research_calls WHERE kind = 'search'")
    assert row["status"] == "ok" and row["item_id"] == "IT-001" and row["query"].startswith("Otter.ai")
    assert row["cost_usd"] >= ctx.config.models.web_search_per_1000 / 1000, "a search costs at least the search"
    call = db.fetch_one("SELECT purpose, cost_usd FROM llm_calls WHERE purpose = 'research_search'")
    assert call is not None and abs(call["cost_usd"] - row["cost_usd"]) < 1e-9


def test_searches_stop_at_the_review_cap(workspace):
    db, service, run_id = workspace
    ctx, session = _session(service, run_id, "research")
    cap = int(ctx.budget("research", "max_searches_per_review"))
    for i in range(cap):
        text, _ = execute(session, "web_search", {"query": f"query number {i} about Otter.ai"})
        assert text.startswith(f"Web search {i + 1} of {cap}")
    text, _ = execute(session, "web_search", {"query": "one more"})
    assert f"used its {cap} web searches" in text
    assert db.fetch_one("SELECT COUNT(*) AS n FROM research_calls WHERE status = 'refused'")["n"] == 1
    # another review starts from zero
    _, other = _session(service, run_id, "research", meeting_id="m2")
    assert execute(other, "web_search", {"query": "fresh review"})[0].startswith("Web search 1 of")


@pytest.mark.parametrize("url", ["http://127.0.0.1/admin", "http://localhost/x", "http://10.0.0.8/", "http://[::1]/",
                                 "file:///etc/passwd", "ftp://vendor.example/", "http://user:pw@vendor.example/", "not a url",
                                 "http://169.254.169.254/latest/meta-data/"])
def test_read_page_refuses_what_is_not_a_public_web_address(workspace, url):
    db, service, run_id = workspace
    _, session = _session(service, run_id, "research")
    text, _ = execute(session, "read_page", {"url": url})
    assert "public" in text or "not read" in text or "could not be resolved" in text, text
    row = db.fetch_one("SELECT status FROM research_calls WHERE kind = 'page'")
    assert row["status"] == "failed"


def test_page_text_strips_scripts_tags_and_entities():
    title, text = research.page_text("text/html; charset=utf-8".split(";")[0], "<html><head><title>Privacy &amp; data</title>"
                                     "<script>alert(1)</script><style>p{}</style></head><body><p>Kept <b>30</b> days.</p></body></html>")
    assert title == "Privacy & data" and text == "Kept 30 days." and "alert" not in text
    with pytest.raises(research.ResearchError):
        research.page_text("application/pdf", "%PDF-1.4")


def test_read_page_through_an_injected_fetch_is_fenced_and_cut(workspace):
    db, service, run_id = workspace
    ctx, session = _session(service, run_id, "research")
    limit = int(ctx.budget("research", "max_page_chars"))
    body = "<html><head><title>Terms</title></head><body><p>Prompts are kept 30 days.</p>" + "<p>filler</p>" * 2000 + "</body></html>"
    text = research.read_page(ctx, meeting_id="m1", agent=session.agent, url="https://vendor.example/terms", item_id="IT-001",
                              fetch=lambda url, timeout: ("text/html", body))
    assert text.startswith("Page 1 of") and "(Terms)" in text and "Showing the first" in text
    assert UNTRUSTED_START in text and text.rstrip().endswith(UNTRUSTED_END)
    inside = text.split(UNTRUSTED_START, 1)[1]
    assert len(inside) < limit + 400
    row = db.fetch_one("SELECT * FROM research_calls WHERE kind = 'page'")
    assert row["status"] == "ok" and row["url"] == "https://vendor.example/terms" and row["item_id"] == "IT-001"


def test_a_search_is_priced_and_never_discounted():
    models = load_config(CONFIG).models
    plain = compute_cost(models, "claude-haiku-4-5-20251001", TokenUsage(1000, 100), batch=False)
    searched = compute_cost(models, "claude-haiku-4-5-20251001", TokenUsage(1000, 100, web_searches=2), batch=True)
    assert searched >= 2 * models.web_search_per_1000 / 1000
    assert searched - plain * models.batch_multiplier == pytest.approx(2 * models.web_search_per_1000 / 1000)


def test_research_is_off_when_a_search_has_no_price(workspace):
    db, service, run_id = workspace
    config = load_config(CONFIG)
    assert research.enabled(config)
    from dataclasses import replace
    off = replace(config, models=replace(config.models, web_search_per_1000=0.0))
    assert not research.enabled(off)


def test_a_review_with_the_research_seat_searches_and_the_record_shows_it(workspace):
    db, service, run_id = workspace
    item = submit_item(db, run_id, kind="vendor", title="Otter.ai", description="Meeting notes for the clinic.", submitted_by="ops@harbor.example", today=TODAY)
    result = service.convene(run_id, [AgendaItem("IT-001", "item", "AI vendor: Otter.ai", item)], on=TODAY)
    sources = research.sources_for(db, result.meeting_id, "IT-001")
    assert sources and sources[0]["kind"] == "search" and sources[0]["seat_title"] == "Research Adviser"
    assert sources[0]["results"][0]["url"].startswith("https://")
    # the seat read the result inside the fence: the next request to its model carries the fenced tool result
    requests = db.fetch_all("SELECT request FROM llm_calls WHERE purpose = 'committee_position' AND agent_id LIKE '%/agent/research'")
    assert any(UNTRUSTED_START in str(r["request"]) and "research librarian" in str(r["request"]) for r in requests)
    # the research seat's own positions still landed
    assert db.fetch_one("SELECT COUNT(*) AS n FROM positions WHERE meeting_id = ? AND agent_id LIKE '%/agent/research'", (result.meeting_id,))["n"] == 1
