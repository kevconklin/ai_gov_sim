"""Disclosure checks: a customer's committee must be told what it is.

The mirror image of the simulation's leak check. There, nothing a member reads may reveal that
the world is simulated. Here, the standing brief must say the member is an AI adviser, that the
output is advisory, and that a person decides. A brief that lost those lines in an edit would
quietly turn advisers into impersonators, so their presence is checked, not assumed.
"""

from __future__ import annotations

from pathlib import Path

# The standing brief every disclosed committee member is given.
REQUIRED: dict[str, tuple[str, ...]] = {
    "review/fixed.md": ("AI adviser", "not a person", "advisory", "machine-generated", "makes the decision"),
}


class DisclosureError(ValueError):
    """A brief that must disclose what the member is no longer does."""


def missing_phrases(text: str, name: str) -> list[str]:
    return [phrase for phrase in REQUIRED.get(name, ()) if phrase.lower() not in text.lower()]


def assert_disclosed(text: str, name: str) -> str:
    missing = missing_phrases(text, name)
    if missing:
        raise DisclosureError(f"{name} no longer discloses: {', '.join(missing)}")
    return text


def scan(prompts_dir: Path) -> list[str]:
    problems = []
    for name in REQUIRED:
        path = Path(prompts_dir) / name
        if not path.is_file():
            problems.append(f"{name}: missing")
            continue
        problems += [f"{name}: does not say {phrase!r}" for phrase in missing_phrases(path.read_text(), name)]
    return problems
