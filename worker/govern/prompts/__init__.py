"""Prompt templates. Agent-facing text lives in files so it can be scanned rather than trusted.

Templates resolve across registered roots, and every render passes through whichever checks
are registered for that template's directory. The two checks pull in opposite directions, which
is why they are per-directory: the simulation forbids telling members what they are, and a
customer's committee requires it.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from string import Template
from typing import Any, Callable

import yaml

PROMPTS_DIR = Path(__file__).resolve().parent

Check = Callable[[str, str], str]
_ROOTS: list[Path] = [PROMPTS_DIR]
_CHECKS: list[tuple[str, Check]] = []


def register_root(path: Path) -> None:
    if Path(path) not in _ROOTS:
        _ROOTS.append(Path(path))
        _raw.cache_clear()


def register_check(prefix: str, check: Check) -> None:
    """Run `check(text, name)` on every template whose name starts with `prefix`."""
    if (prefix, check) not in _CHECKS:
        _CHECKS.append((prefix, check))


def roots() -> tuple[Path, ...]:
    return tuple(_ROOTS)


@lru_cache(maxsize=None)
def _raw(name: str) -> str:
    for root in _ROOTS:
        path = root / name
        if path.is_file():
            return path.read_text()
    raise FileNotFoundError(f"missing prompt template: {name}")


def _checked(name: str) -> str:
    text = _raw(name)
    for prefix, check in _CHECKS:
        if name.startswith(prefix):
            text = check(text, name)
    return text


def render(template_name: str, /, **values: Any) -> str:
    """Render a $-template. Templates are checked; substituted values are the caller's responsibility."""
    return Template(_checked(template_name)).substitute({k: str(v) for k, v in values.items()}).strip()


@lru_cache(maxsize=None)
def load_yaml(name: str) -> Any:
    return yaml.safe_load(_checked(name))


def _register_disclosure() -> None:
    from govern.disclosure import assert_disclosed
    register_check("review/", assert_disclosed)


_register_disclosure()
