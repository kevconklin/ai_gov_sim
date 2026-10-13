from __future__ import annotations

from datetime import date

import pytest

from govern.policy import PolicyError, PolicyRepo, apply_edit, read_section, sections, stats

BASE = "# Bank AI Policy\n\nOwner: AI Governance Committee\n"


def test_new_section_assigns_control_numbers():
    text = apply_edit(BASE, "Scope", "AI-GOV-NEW: Applies to all AI.\nAI-GOV-NEW: Inventory every model.")
    assert "AI-GOV-001: Applies" in text and "AI-GOV-002: Inventory" in text
    assert "No sections" not in apply_edit(BASE.rstrip() + " No sections have been adopted yet.\n", "Scope", "AI-GOV-NEW: A.")
    assert stats(text).controls == ("AI-GOV-001", "AI-GOV-002")
    assert text.startswith("# Bank AI Policy")


def test_replacing_section_keeps_ids_and_numbers_after_max():
    text = apply_edit(BASE, "Scope", "AI-GOV-NEW: A.\nAI-GOV-NEW: B.")
    text = apply_edit(text, "Validation", "AI-GOV-NEW: Validate models.")
    text = apply_edit(text, "## scope", "AI-GOV-001: A revised.\nAI-GOV-NEW: C.")
    assert list(sections(text)) == ["Scope", "Validation"]
    assert read_section(text, "SCOPE") == "AI-GOV-001: A revised.\nAI-GOV-004: C."
    assert stats(text).controls == ("AI-GOV-001", "AI-GOV-004", "AI-GOV-003")


def test_duplicate_ids_from_other_sections_are_renumbered():
    text = apply_edit(BASE, "Scope", "AI-GOV-001: A.")
    text = apply_edit(text, "Vendors", "AI-GOV-001: Vendor review.")
    assert read_section(text, "Vendors") == "AI-GOV-002: Vendor review."


def test_empty_edit_rejected():
    with pytest.raises(PolicyError):
        apply_edit(BASE, "", "x")
    with pytest.raises(PolicyError):
        apply_edit(BASE, "Scope", "  ")


def test_stats_readability_and_words():
    result = stats("## Scope\n\nAI-GOV-001: Staff must use approved tools. Models are validated annually.")
    assert result.word_count == 10   # control ids are not words
    assert result.readability_grade is not None
    assert stats("").readability_grade is None


def test_repo_commits_with_sim_date_and_resets(tmp_path):
    repo = PolicyRepo(tmp_path / "policy")
    first = repo.init("Calder Ridge Bank", "committee@example.com", date(2027, 1, 12))
    second = repo.commit(apply_edit(repo.read(), "Scope", "AI-GOV-NEW: A."), "2027-02-09: adopted", date(2027, 2, 9))
    assert first != second
    assert repo._git("log", "-1", "--format=%ad", "--date=short") == "2027-02-09"
    assert repo.commit(repo.read(), "no change", date(2027, 2, 9)) == second
    clone = repo.clone_to(tmp_path / "fork", first)
    assert clone._git("config", "--get", "user.email") == "committee@example.com"
    assert "AI-GOV-001" not in clone.read()
    repo.reset_to(first)
    assert "No sections" in repo.read()
    with pytest.raises(PolicyError):
        repo.reset_to("deadbeef")
