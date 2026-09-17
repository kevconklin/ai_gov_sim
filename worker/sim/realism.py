"""Leak checks: nothing an agent reads may mention the simulation (SPEC 7)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

LEAK_PATTERNS: tuple[str, ...] = (
    r"\bsimulat\w*",
    r"\bfictional\b",
    r"\bfictitious\b",
    r"\bpersonas?\b",
    r"\brole[- ]?play\w*",
    r"\bLLMs?\b",
    r"\blanguage models?\b",
    r"\bClaude\b",
    r"\bAnthropic\b",
    r"\btokens?\b",
    r"\byour turn\b",
    r"\bprompts?\b",
    r"\bagents?\b",
    r"\borchestrator\b",
    r"\breality engine\b",
    r"\bsim[ _-]?month\b",
    r"\bthis is (?:a|just a|only a) test\b",
    r"\bnot real\b",
)
_LEAK = re.compile("|".join(f"(?:{p})" for p in LEAK_PATTERNS), re.IGNORECASE)

# Files whose contents reach committee members verbatim or through templates.
AGENT_FACING_GLOBS: tuple[str, ...] = (
    "config/personas/**/*.md",
    "config/risk_appetite/*.md",
    "config/universe/*.yaml",
    "worker/sim/prompts/committee/*",
    "worker/sim/prompts/world/*",
)


class LeakError(ValueError):
    """Agent-facing text contains simulation language."""


@dataclass(frozen=True)
class Leak:
    source: str
    line: int
    match: str


def find_leaks(text: str, source: str = "<text>") -> list[Leak]:
    return [
        Leak(source=source, line=text.count("\n", 0, m.start()) + 1, match=m.group(0))
        for m in _LEAK.finditer(text)
    ]


def assert_clean(text: str, source: str = "<text>") -> str:
    leaks = find_leaks(text, source)
    if leaks:
        detail = ", ".join(f"{l.source}:{l.line} {l.match!r}" for l in leaks[:5])
        raise LeakError(f"simulation language in agent-facing text: {detail}")
    return text


def scan_repo(repo_root: Path) -> list[Leak]:
    leaks: list[Leak] = []
    for pattern in AGENT_FACING_GLOBS:
        for path in sorted(repo_root.glob(pattern)):
            if path.is_file():
                leaks.extend(find_leaks(path.read_text(), str(path.relative_to(repo_root))))
    return leaks
