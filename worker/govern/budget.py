"""Spend tracking and caps (SPEC 12)."""

from __future__ import annotations

from datetime import datetime, timezone

from govern.alerts import raise_alert
from govern.config import Config
from govern.db import Database

ALERT_LEVELS = (0.5, 0.8, 1.0)


def run_month_spend(db: Database, run_id: str, sim_month: str) -> float:
    row = db.fetch_one("SELECT COALESCE(SUM(cost_usd), 0) AS c FROM llm_calls WHERE run_id = ? AND sim_month = ?",
                       (run_id, sim_month))
    return float(row["c"])


def real_month_spend(db: Database, now: datetime | None = None) -> float:
    now = now or datetime.now(timezone.utc)
    start = now.strftime("%Y-%m-01")
    row = db.fetch_one("SELECT COALESCE(SUM(cost_usd), 0) AS c FROM llm_calls WHERE created_at >= ?", (start,))
    return float(row["c"])


def check_hard_cap(db: Database, config: Config, now: datetime | None = None) -> bool:
    """Raise 50/80/100% alerts once per real month. Returns True when the hard cap is reached."""
    now = now or datetime.now(timezone.utc)
    cap = float(config.budget.raw["spend_caps_usd"]["hard_monthly"])
    spent = real_month_spend(db, now)
    for level in ALERT_LEVELS:
        if spent >= cap * level:
            raise_alert(db, "spend", "critical" if level >= 1.0 else "warning",
                        f"API spend ${spent:,.2f} is {spent / cap:.0%} of the ${cap:,.0f} monthly cap",
                        dedupe_key=f"{now:%Y-%m}-{int(level * 100)}")
    return spent >= cap


def bank_under_cap(db: Database, run: dict, sim_month: str, config: Config) -> bool:
    cap = run.get("spend_cap_usd_per_month") or config.budget.raw["spend_caps_usd"]["per_bank_per_sim_month"]
    return run_month_spend(db, run["run_id"], sim_month) < float(cap)


class BudgetExceeded(RuntimeError):
    """The customer's monthly cap on review spend has been reached."""


def workspace_month_spend(db: Database, run_id: str, now: datetime | None = None) -> float:
    """What one customer's reviews have cost this calendar month."""
    month = (now or datetime.now(timezone.utc)).strftime("%Y-%m")
    row = db.fetch_one("SELECT COALESCE(SUM(cost_usd), 0) AS total FROM llm_calls WHERE run_id = ? AND created_at LIKE ?",
                       (run_id, f"{month}%"))
    return float(row["total"] or 0)


def require_review_budget(db: Database, run: dict, config: Config, now: datetime | None = None) -> None:
    """Refuse to convene once the month's cap is spent. A cap nobody checks is not a cap."""
    cap = run.get("spend_cap_usd_per_month")
    if cap is None:
        return
    spent = workspace_month_spend(db, run["run_id"], now)
    if spent >= float(cap):
        raise BudgetExceeded(f"this month's review budget is spent (${spent:,.2f} of ${float(cap):,.2f}); "
                             "raise it under Settings, or wait for next month")


class ReviewOverBudget(RuntimeError):
    """A review in flight has cost more than one review may. It stops here."""


def per_review_cap(config: Config) -> float | None:
    cap = (config.budget.raw.get("spend_caps_usd") or {}).get("per_review")
    return float(cap) if cap is not None else None


def spend_since(db: Database, run_id: str, since_iso: str) -> float:
    row = db.fetch_one("SELECT COALESCE(SUM(cost_usd), 0) AS total FROM llm_calls WHERE run_id = ? AND created_at >= ?", (run_id, since_iso))
    return float(row["total"] or 0)


def require_review_ceiling(db: Database, run: dict, config: Config, *, since_iso: str, phase: str) -> float:
    """Between phases of one review: stop if it has already cost more than a review may. Returns the spend so far."""
    spent = spend_since(db, run["run_id"], since_iso)
    cap = per_review_cap(config)
    if run.get("condition") == "workspace" and cap is not None and spent >= cap:
        raise ReviewOverBudget(f"this review has cost ${spent:,.2f} by the {phase}, over the ${cap:,.2f} a review may cost; "
                               "it stops here and its matters go back to Waiting")
    return spent
