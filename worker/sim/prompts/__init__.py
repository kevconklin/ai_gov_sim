"""Prompt templates. Agent-facing text lives in files here so CI can scan it for simulation language."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from string import Template
from typing import Any

import yaml

from sim.realism import assert_clean

PROMPTS_DIR = Path(__file__).resolve().parent


@lru_cache(maxsize=None)
def _raw(name: str) -> str:
    path = PROMPTS_DIR / name
    if not path.is_file():
        raise FileNotFoundError(f"missing prompt template: {name}")
    return path.read_text()


def render(template_name: str, /, **values: Any) -> str:
    """Render a $-template. Templates are leak-checked; substituted values are the caller's responsibility."""
    template = assert_clean(_raw(template_name), template_name)
    return Template(template).substitute({k: str(v) for k, v in values.items()}).strip()


@lru_cache(maxsize=None)
def load_yaml(name: str) -> Any:
    return yaml.safe_load(assert_clean(_raw(name), name))
