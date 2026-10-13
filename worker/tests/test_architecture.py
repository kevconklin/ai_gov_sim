"""The review core must stand without the simulation. The simulation is its client, not its host."""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

from govern import disclosure, prompts

GOVERN = Path(__file__).resolve().parents[1] / "govern"


def imported_modules(path: Path) -> set[str]:
    found = set()
    for node in ast.walk(ast.parse(path.read_text())):
        if isinstance(node, ast.Import):
            found |= {alias.name for alias in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module:
            found.add(node.module)
    return found


def test_the_review_core_never_imports_the_simulation():
    offenders = {str(p.relative_to(GOVERN)): sorted(m for m in imported_modules(p) if m == "sim" or m.startswith("sim."))
                 for p in GOVERN.rglob("*.py")}
    assert {k: v for k, v in offenders.items() if v} == {}


def test_a_disclosed_brief_says_what_the_member_is():
    assert disclosure.scan(prompts.PROMPTS_DIR) == []


def test_a_brief_that_stops_disclosing_is_refused():
    with pytest.raises(disclosure.DisclosureError, match="AI adviser"):
        disclosure.assert_disclosed("You are the Chief Risk Officer of a bank.", "review/fixed.md")


def test_the_simulation_brief_is_still_held_to_the_leak_check():
    """The two checks pull in opposite directions, so each must stay on its own directory."""
    import sim  # noqa: F401 - registers the leak check
    from sim.realism import LeakError
    with pytest.raises(LeakError):
        for prefix, check in prompts._CHECKS:
            if prefix == "committee/":
                check("You are an AI adviser in a simulation.", "committee/fixed.md")
