"""Run-scoped ids are prefixed with "<run_id>/" so a fork can remap every reference by prefix."""

from __future__ import annotations

import uuid


def new_run_id(experiment_id: str, bank_id: str, replicate: int) -> str:
    return f"{experiment_id}-r{replicate}-{bank_id}-{uuid.uuid4().hex[:6]}"


def scoped(run_id: str, kind: str, *parts: object) -> str:
    suffix = "-".join(str(p) for p in parts) if parts else uuid.uuid4().hex[:12]
    return f"{run_id}/{kind}/{suffix}"


def unique(run_id: str, kind: str) -> str:
    return f"{run_id}/{kind}/{uuid.uuid4().hex[:12]}"


def global_id() -> str:
    return str(uuid.uuid4())
