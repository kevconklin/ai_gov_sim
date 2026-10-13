"""Model-call text at rest has a shelf life.

`llm_calls` keeps every request and response in full, which makes a review auditable and a bug
findable, and also makes the database a copy of every customer's documents and matters. After the
retention window the text goes and the accounting stays. The simulation's runs are exempt: the
study replays them.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

import yaml

from govern.config import ConfigError
from govern.db import Database


@dataclass(frozen=True)
class RetentionConfig:
    keep_text_days: int
    redact_marker: str


def load_retention(config_dir: Path) -> RetentionConfig:
    path = Path(config_dir) / "retention.yaml"
    if not path.is_file():
        raise ConfigError(f"missing config file: retention.yaml (looked in {config_dir})")
    data = (yaml.safe_load(path.read_text()) or {}).get("llm_calls") or {}
    days = int(data.get("keep_text_days", 14))
    if days < 0:
        raise ConfigError("retention.yaml: keep_text_days cannot be negative")
    return RetentionConfig(keep_text_days=days, redact_marker=str(data.get("redact_marker") or "[text removed]"))


def redact_expired(db: Database, config: RetentionConfig, now: datetime | None = None) -> int:
    """Replace the text of workspace calls older than the window. Returns how many rows changed."""
    cutoff = ((now or datetime.now(timezone.utc)) - timedelta(days=config.keep_text_days)).isoformat()
    return db.execute(
        """UPDATE llm_calls SET request = ?, response = CASE WHEN response IS NULL THEN NULL ELSE ? END
           WHERE created_at < ? AND request <> ?
             AND run_id IN (SELECT run_id FROM runs WHERE condition = 'workspace')""",
        (config.redact_marker, config.redact_marker, cutoff, config.redact_marker))
