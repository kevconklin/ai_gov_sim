"""Event injector (SPEC 6.4): scheduled and random events, worded as inbox items and news."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import date
from string import Template
from typing import Any, Mapping, Sequence

from sim import ids, prompts
from sim.agents.structured import StructuredOutputError, call_structured, tool
from sim.calendar import add_months, day_in_month, long_date, meeting_date, parse_month
from sim.context import RunContext
from sim.engine.rng import stable_int
from sim.engine.state import CompanyState
from sim.llm import LLMCallFailed
from sim.realism import find_leaks

log = logging.getLogger(__name__)

INBOX_TOOL = tool("write_email", "Write the email.", {
    "sender_name": {"type": "string"}, "sender_title": {"type": "string"},
    "subject": {"type": "string"}, "body": {"type": "string", "description": "120 to 300 words, with signature"},
})
NEWS_TOOL = tool("write_news", "Write the news item.", {
    "outlet": {"type": "string"}, "headline": {"type": "string"},
    "body": {"type": "string", "description": "120 to 250 words"},
})


@dataclass(frozen=True)
class WorldEvent:
    event_id: str
    type: str
    severity: str | None
    source: str
    payload: Mapping[str, Any]


def _probability(kind: str, spec: Mapping[str, Any], state: CompanyState, month: str) -> float:
    prev = add_months(month, -1)
    risk = state.risk
    if kind == "press_inquiry":
        highs = sum(i.severity == "high" for i in state.incidents_in(prev))
        return spec["prob"] + spec["per_high_incident_last_month"] * highs
    if kind == "shadow_ai_discovery":
        return spec["prob_per_shadow_rate"] * state.people.shadow_ai_usage_rate
    if kind == "data_leak":
        live = sum(p.status == "live" and p.customer_facing for p in state.projects)
        return spec["prob"] + spec["per_live_customer_facing_use_case"] * live
    if kind == "complaint_wave":
        elevated = risk.customer_complaint_rate >= spec["if_complaint_rate_multiple_above"] * risk.customer_complaint_rate_baseline
        return spec["elevated_prob"] if elevated else spec["prob"]
    if kind == "morale_issue":
        return spec["elevated_prob"] if state.people.morale_index < spec["if_morale_below"] else spec["prob"]
    return float(spec["prob"])


def _pick(ctx: RunContext, variable: str, options: Sequence[Any], month: str) -> Any:
    index = ctx.rng.draw(variable, "choice", {"weights": [1] * len(options)}, sim_month=month, stream="exogenous")
    return options[int(index)]


def draw_random_events(ctx: RunContext, month: str, state: CompanyState) -> list[WorldEvent]:
    """Uniform draws are shared across paired banks (exogenous stream); probabilities depend on each bank's state."""
    events = []
    universe = ctx.world.universe
    for kind, spec in ctx.world.events["random"].items():
        u = ctx.rng.draw(f"event_{kind}", "uniform", {"low": 0, "high": 1}, sim_month=month, stream="exogenous")
        if u >= min(1.0, _probability(kind, spec, state, month)):
            continue
        payload: dict[str, Any] = {"channel": spec["channel"]}
        if kind == "vendor_pitch" and universe.get("vendors"):
            vendor = _pick(ctx, "vendor_choice", universe["vendors"], month)
            payload["vendor"] = {k: vendor[k] for k in ("name", "category", "description", "products")}
        if kind == "competitor_launch" and universe.get("competitors"):
            payload["competitor"] = dict(_pick(ctx, "competitor_choice", universe["competitors"], month))
        if kind == "key_staff_resignation" and universe.get("staff"):
            payload["staff"] = dict(_pick(ctx, "resigning_staff", universe["staff"], month))
        events.append(WorldEvent(ids.unique(ctx.run_id, "event"), kind, spec.get("severity"), "random", payload))
    return events


def pending_injected(ctx: RunContext, month: str) -> list[WorldEvent]:
    rows = ctx.db.fetch_all("SELECT e.* FROM events e WHERE e.run_id = ? AND e.sim_month = ? AND e.source = 'injected' "
                            "AND NOT EXISTS (SELECT 1 FROM inbox_items i WHERE i.event_id = e.event_id) "
                            "AND NOT EXISTS (SELECT 1 FROM news_items n WHERE n.event_id = e.event_id)", (ctx.run_id, month))
    return [WorldEvent(r["event_id"], r["type"], r["severity"], "injected",
                       {"channel": "news" if r["type"] in ("competitor_launch", "regulator_guidance") else "inbox",
                        **json.loads(r["payload"])}) for r in rows]


def _reference(ctx: RunContext, event: WorldEvent, extra: str) -> str:
    universe = ctx.world.universe
    staff = "\n".join(f"- {s['name']}, {s['title']} ({s['department']})" for s in universe.get("staff", []))
    outlets = "\n".join(f"- {o['name']}: {o['kind']}" for o in universe.get("media_outlets", []))
    details = json.dumps({k: v for k, v in event.payload.items() if k != "channel"}, indent=2)
    return f"Staff directory\n{staff}\n\nNews outlets\n{outlets}\n\nEvent details\n{details}\n{extra}".strip()


def _writer_system(ctx: RunContext, when: date, reference: str) -> str:
    facts = ctx.world.bank_universe(ctx.run["bank_id"])
    region = ctx.world.universe.get("region", {}).get("name", "Midwest")
    return prompts.render("world/writer.md", bank_name=ctx.bank.name, assets_note="$18 billion",
                          hq_city=str(facts.get("hq_address", "")).split(",")[-1].strip() or region, region=region,
                          date=long_date(when), reference=reference)


def _fallback(kind: str, channel: str, signature: str) -> dict[str, str]:
    template = prompts.load_yaml("world/event_fallbacks.yaml")[channel]
    subject = kind.replace("_", " ").capitalize()
    summary = prompts.load_yaml("world/event_briefs.yaml").get(kind, subject)
    return {k: Template(v).safe_substitute(subject=subject, summary=summary, signature=signature) for k, v in template.items()}


def word_event(ctx: RunContext, event: WorldEvent, month: str, *, extra: str = "") -> None:
    """Write the event as an inbox email or news item. Leaky or failed wording falls back to a plain template."""
    channel = event.payload.get("channel", "inbox")
    when = day_in_month(month, stable_int(1, max(1, meeting_date(month).day - 1), ctx.run_id, event.event_id))
    briefs = prompts.load_yaml("world/event_briefs.yaml")
    fields = dict(role="utility", purpose=f"event_wording_{event.type}", run_id=ctx.run_id, sim_month=month,
                  max_tokens=int(ctx.budget("max_tokens", "event_wording")),
                  system_fixed=(_writer_system(ctx, when, _reference(ctx, event, extra)),),
                  messages=({"role": "user", "content": briefs.get(event.type, briefs["staff_voice"])},))
    content: dict[str, Any] | None = None
    try:
        content = call_structured(ctx.llm, fields, NEWS_TOOL if channel == "news" else INBOX_TOOL)
        if any(find_leaks(str(v)) for v in content.values()) or not all(str(v).strip() for v in content.values()):
            log.warning("event wording for %s rejected by leak check; using fallback", event.event_id)
            content = None
    except (StructuredOutputError, LLMCallFailed) as error:
        log.warning("event wording failed for %s: %s", event.event_id, error)
    exists = ctx.db.fetch_one("SELECT 1 FROM events WHERE event_id = ?", (event.event_id,))
    if not exists:
        ctx.db.insert("events", {"event_id": event.event_id, "run_id": ctx.run_id, "bank_id": ctx.run["bank_id"],
                                 "sim_month": month, "type": event.type, "severity": event.severity,
                                 "source": event.source, "payload": dict(event.payload)})
    if channel == "news":
        content = content or {"outlet": ctx.world.universe.get("media_outlets", [{"name": "Regional Banking Week"}])[-2]["name"],
                              **_fallback(event.type, "news", "")}
        ctx.db.insert("news_items", {"news_id": ids.unique(ctx.run_id, "news"), "run_id": ctx.run_id,
                                     "bank_id": ctx.run["bank_id"], "sim_month": month, "published_date": when.isoformat(),
                                     "outlet": content["outlet"], "headline": content["headline"], "body": content["body"],
                                     "event_id": event.event_id})
        return
    if content is None:
        content = {"sender_name": "Office of the Chief Operating Officer", "sender_title": ctx.bank.name,
                   **_fallback(event.type, "inbox", ctx.bank.name)}
    deliver_inbox(ctx, month=month, sent=when, sender_name=content["sender_name"], sender_title=content["sender_title"],
                  subject=content["subject"], body=content["body"], event_id=event.event_id)


def deliver_inbox(ctx: RunContext, *, month: str, sent: date, sender_name: str, sender_title: str, subject: str,
                  body: str, event_id: str | None = None, recipient_seat: str | None = None) -> None:
    ctx.db.insert("inbox_items", {"item_id": ids.unique(ctx.run_id, "inbox"), "run_id": ctx.run_id,
                                  "bank_id": ctx.run["bank_id"], "sim_month": month, "sent_date": sent.isoformat(),
                                  "recipient_seat": recipient_seat, "sender_name": sender_name,
                                  "sender_title": sender_title, "subject": subject, "body": body, "event_id": event_id})


def deliver_seed_news(ctx: RunContext, month: str, count: int) -> None:
    used = {json.loads(r["payload"]).get("seed_id") for r in ctx.db.fetch_all(
        "SELECT payload FROM events WHERE run_id = ? AND type = 'news_seed'", (ctx.run_id,))}
    available = [s for s in ctx.world.news_seeds if s.get("id") not in used]
    for n in range(min(count, len(available))):
        seed = available.pop(int(ctx.rng.draw("news_seed_choice", "choice", {"weights": [1] * len(available)},
                                              sim_month=month, stream="exogenous", key=(n,))))
        event_id = ids.unique(ctx.run_id, "event")
        ctx.db.insert("events", {"event_id": event_id, "run_id": ctx.run_id, "bank_id": ctx.run["bank_id"],
                                 "sim_month": month, "type": "news_seed", "severity": None, "source": "scheduled",
                                 "payload": {"seed_id": seed.get("id"), "topic": seed.get("topic")}})
        when = day_in_month(month, stable_int(1, meeting_date(month).day - 1, ctx.run_id, month, n))
        ctx.db.insert("news_items", {"news_id": ids.unique(ctx.run_id, "news"), "run_id": ctx.run_id,
                                     "bank_id": ctx.run["bank_id"], "sim_month": month, "published_date": when.isoformat(),
                                     "outlet": seed["outlet"], "headline": seed["headline"], "body": seed["body"],
                                     "event_id": event_id})


def budget_cycle(ctx: RunContext, month: str, state: CompanyState) -> CompanyState:
    events_cfg = ctx.world.events["scheduled"]["budget_cycle"]
    if parse_month(month)[1] != events_cfg["month_of_year"] or month == ctx.run["start_month"]:
        return state
    annual = state.financials.ai_budget_annual
    staff = {s["key"]: s for s in ctx.world.universe.get("staff", [])}
    analyst = staff.get("finance_analyst", {"name": "Finance", "title": "Corporate Finance"})
    deliver_inbox(ctx, month=month, sent=day_in_month(month, 5), sender_name=analyst["name"], sender_title=analyst["title"],
                  subject="AI budget for the new fiscal year",
                  body=(f"Committee members,\n\nThe Board has approved the AI budget for the new fiscal year at ${annual:,.0f}. "
                        f"Unspent funds from last year do not carry over. Spending to date across all years is "
                        f"${state.financials.ai_spend_to_date:,.0f}.\n\n{analyst['name']}\n{analyst['title']}"))
    return state.model_copy(update={"financials": state.financials.model_copy(update={"ai_budget_remaining": annual})})


def resolve_world_events(ctx: RunContext, month: str, state: CompanyState) -> list[WorldEvent]:
    """SPEC 5 step 1. Returns the month's events; incident-like events also feed the engine."""
    events = pending_injected(ctx, month) + draw_random_events(ctx, month, state)
    for event in events:
        word_event(ctx, event, month)
    optional_ok = ctx.budget_ok(month)
    news_cfg = ctx.world.events["news"]
    deliver_seed_news(ctx, month, news_cfg["seed_items_per_month"] + (news_cfg["optional_extra_items"] if optional_ok else 0))
    if optional_ok and ctx.world.universe.get("staff"):
        u = ctx.rng.draw("staff_voice", "uniform", {"low": 0, "high": 1}, sim_month=month, stream="exogenous")
        if u < ctx.world.events["staff_voices"]["prob_per_month"]:
            person = _pick(ctx, "staff_voice_person", ctx.world.universe["staff"], month)
            live = [p.title for p in state.projects if p.status == "live"]
            situation = (f"AI initiatives in production: {', '.join(live) or 'none yet'}. "
                         f"Share of staff estimated to use unapproved AI tools: about {round(state.people.shadow_ai_usage_rate * 100)}%.")
            word_event(ctx, WorldEvent(ids.unique(ctx.run_id, "event"), "staff_voice", "low", "random",
                                       {"channel": "inbox", "staff": dict(person)}), month, extra=situation)
    return events
