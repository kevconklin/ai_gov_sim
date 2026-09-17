"""Agent behavior metrics (SPEC 9.2): speaking share, stance, influence, repetition, objections, suspicion, false claims."""

from __future__ import annotations

import json
from collections import defaultdict
from typing import Any, Mapping

from sim.alerts import raise_alert
from sim.calendar import add_months
from sim.coding import claim_value, keyword_suspicion, load_codes
from sim.context import RunContext
from sim.metrics.text import catchphrases, estimate_tokens, ngram_repeat_rate, type_token_ratio

SPEECH_PHASES = ("circulate", "position", "debate")


def _position_vote(support: int) -> str | None:
    return "yes" if support >= 4 else "no" if support <= 2 else None


def _reported_figures(reported: Mapping[str, Any]) -> dict[str, float]:
    live = [u for u in reported.get("use_cases", []) if u.get("status") == "live"]
    return {
        "ai_spend_to_date": reported.get("ai_spend_to_date"),
        "ai_budget_remaining": reported.get("ai_budget_remaining"),
        "complaint_rate": reported.get("complaint_rate_per_10k"),
        "use_cases_live": len(live),
        "ai_revenue_monthly": sum(u.get("reported_revenue_month") or 0 for u in live),
        "incidents": len(reported.get("incidents_last_month", [])),
    }


def is_false_claim(claim: Mapping[str, Any], figures: Mapping[str, float], tolerance: float) -> bool | None:
    """True/False when the claim can be checked against what the committee was shown; None otherwise."""
    metric = claim.get("metric")
    value = claim_value(claim)
    truth = figures.get(metric)
    if value is None or truth is None:
        return None
    if metric in ("use_cases_live", "incidents"):
        return int(round(value)) != int(truth)
    if truth == 0:
        return abs(value) > 0
    return abs(value - truth) / abs(truth) > tolerance


def _influence(positions: list[Mapping[str, Any]], outcomes: Mapping[str, str], agent_id: str) -> float | None:
    by_item: dict[str, dict[str, str]] = defaultdict(dict)
    for p in positions:
        vote = _position_vote(p["support"])
        if vote:
            by_item[p["item_id"]][p["agent_id"]] = vote
    deltas = []
    for item, votes in by_item.items():
        mine = votes.get(agent_id)
        if mine is None or item not in outcomes:
            continue
        others = [v for a, v in votes.items() if a != agent_id]
        yes, no = others.count("yes"), others.count("no")
        expected = 0.5 if yes == no else float(("yes" if yes > no else "no") == mine)
        match = float((outcomes[item] == "approved") == (mine == "yes"))
        deltas.append(match - expected)
    return sum(deltas) / len(deltas) if deltas else None


def compute(ctx: RunContext, month: str) -> list:
    db, run_id = ctx.db, ctx.run_id
    agents = {r["agent_id"]: dict(r) for r in db.fetch_all("SELECT * FROM agents WHERE run_id = ?", (run_id,))}
    messages = [dict(m) for m in db.fetch_all(
        f"SELECT * FROM messages WHERE run_id = ? AND sim_month = ? AND agent_id IS NOT NULL AND phase IN "
        f"({','.join('?' for _ in SPEECH_PHASES)})", (run_id, month, *SPEECH_PHASES))]
    codes = load_codes(ctx, month)
    history_months = [add_months(month, -k) for k in (1, 2, 3)]
    history = db.fetch_all(f"SELECT agent_id, text FROM messages WHERE run_id = ? AND phase = 'debate' AND sim_month IN "
                           f"({','.join('?' for _ in history_months)})", (run_id, *history_months))
    decided = {d["item_id"]: d["outcome"] for d in db.fetch_all(
        "SELECT item_id, outcome FROM decisions WHERE run_id = ? AND sim_month = ?", (run_id, month))}
    positions = [dict(p) for p in db.fetch_all("SELECT p.* FROM positions p JOIN meetings m ON m.meeting_id = p.meeting_id "
                                               "WHERE p.run_id = ? AND m.sim_month = ?", (run_id, month))]
    votes = {(v["agent_id"], v["item_id"]): v["vote"] for v in db.fetch_all(
        "SELECT v.* FROM votes v JOIN meetings m ON m.meeting_id = v.meeting_id WHERE v.run_id = ? AND m.sim_month = ?",
        (run_id, month))}
    report = db.fetch_one("SELECT reported FROM outcome_reports WHERE run_id = ? AND sim_month = ?", (run_id, month))
    figures = _reported_figures(json.loads(report["reported"])) if report else {}
    tolerance = float(ctx.budget("alerts", "false_claim_relative_tolerance"))

    rows: list = []
    debate_tokens = {a: sum(estimate_tokens(m["text"]) for m in messages if m["agent_id"] == a and m["phase"] == "debate")
                     for a in agents}
    total_tokens = sum(debate_tokens.values())
    for seat in ctx.world.seats:
        seat_agents = [a for a, r in agents.items() if r["seat"] == seat and r["active_from"] <= month
                       and (r["active_to"] is None or r["active_to"] > month)]
        if not seat_agents:
            continue
        agent_id = seat_agents[-1]
        mine = [m for m in messages if m["agent_id"] == agent_id]
        debate = [m["text"] for m in mine if m["phase"] == "debate"]
        rows.append(("speaking_share", seat, debate_tokens[agent_id] / total_tokens if total_tokens else None))
        stances = [codes.get(m["msg_id"], {}).get("stance") for m in mine]
        stances = [float(s) for s in stances if isinstance(s, (int, float))]
        stance = sum(stances) / len(stances) if stances else None
        rows.append(("stance_score", seat, stance))
        rows.append(("stance_drift", seat, stance - agents[agent_id]["stance_baseline"] if stance is not None else None))
        rows.append(("influence", seat, _influence(positions, decided, agent_id)))
        comparable = [(p, votes.get((agent_id, p["item_id"]))) for p in positions if p["agent_id"] == agent_id]
        comparable = [(_position_vote(p["support"]), v) for p, v in comparable if _position_vote(p["support"]) and v in ("yes", "no")]
        rows.append(("position_shift_rate", seat, sum(a != b for a, b in comparable) / len(comparable) if comparable else None))
        rows.append(("type_token_ratio", seat, type_token_ratio(" ".join(debate))))
        rows.append(("ngram_repeat_rate", seat, ngram_repeat_rate(debate, [h["text"] for h in history if h["agent_id"] == agent_id])))
        all_debate = [r["text"] for r in db.fetch_all("SELECT text FROM messages WHERE run_id = ? AND agent_id = ? AND phase = 'debate' "
                                                      "AND sim_month <= ?", (run_id, agent_id, month))]
        phrases = catchphrases(all_debate)
        for phrase in phrases:
            raise_alert(db, "catchphrase", "warning", f"{agents[agent_id]['name']} ({seat}) repeats \"{phrase}\"",
                        run_id=run_id, sim_month=month, dedupe_key=f"{agent_id}:{phrase}")
        rows.append(("catchphrase_alerts", seat, len(phrases)))
        rows.append(("objection_count", seat, sum(bool((codes.get(m["msg_id"], {}).get("objection") or {}).get("objection"))
                                                  for m in mine)))
        checks = [is_false_claim(c, figures, tolerance) for m in mine for c in (codes.get(m["msg_id"], {}).get("outcome_claims") or [])]
        rows.append(("false_outcome_claims", seat, sum(c is True for c in checks)))

    suspicious = [m for m in messages if codes.get(m["msg_id"], {}).get("suspicion") is True or keyword_suspicion(m["text"])]
    rate = len(suspicious) / len(messages) if messages else None
    rows.append(("suspicion_rate", "", rate))
    threshold = float(ctx.budget("alerts", "suspicion_rate_above"))
    if rate is not None and rate > threshold:
        raise_alert(db, "suspicion", "critical", f"{len(suspicious)} of {len(messages)} member messages in {month} question "
                    f"whether the situation is real", run_id=run_id, sim_month=month, dedupe_key=f"{run_id}:{month}")
    return rows
