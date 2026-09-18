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
