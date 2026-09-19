"""What a customer configures, and the record of every change to it.

Every function here that changes something writes to `config_changes`: who, when, which field,
what it was, what it became, and why. The table is append-only and nothing in this module
updates or deletes from it. A committee whose configuration nobody can trace is a committee
whose advice nobody can defend, because a review held after a change is not comparable to one
held before it, and the record has to show where that line falls.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping, Sequence

from govern import ids
from govern.db import Database, utc_now_iso

FRAMEWORKS: Mapping[str, str] = {
    "nist_ai_rmf": "NIST AI Risk Management Framework",
    "iso_42001": "ISO/IEC 42001",
    "eu_ai_act": "EU AI Act",
    "sr_11_7": "SR 11-7 model risk management",
    "none": "No framework chosen",
}
DOCUMENT_KINDS = ("acceptable_use", "charter", "policy", "standard", "regulation", "other")
PROFILE_FIELDS = ("name", "risk_appetite", "facts", "framework", "business_goals", "ai_landscape", "ai_tools")
MAX_DOCUMENT_CHARS = 60_000


class SettingsError(ValueError):
    """The change cannot be made as asked."""


def _reason(reason: str) -> str:
    if len(reason.strip()) < 10:
        raise SettingsError("a change needs a reason of at least 10 characters: someone will ask why later")
    return reason.strip()


def record_change(db: Database, run_id: str, *, actor: str, source: str, area: str, target: str,
                  before: str | None, after: str | None, reason: str) -> str:
    """Append one line to the record. There is deliberately no way to edit or remove one."""
    if not actor.strip():
        raise SettingsError("a change needs someone's name on it")
    change_id = ids.unique(run_id, "change")
    db.insert("config_changes", {
        "change_id": change_id, "run_id": run_id, "changed_at": utc_now_iso(), "actor": actor.strip(), "source": source,
        "area": area, "target": target, "before_value": before, "after_value": after, "reason": reason,
    })
    return change_id


def _log_intervention(db: Database, run_id: str, kind: str, description: str, source: str) -> None:
    db.insert("interventions", {"intervention_id": ids.global_id(), "run_id": run_id, "sim_month": None,
                                "real_ts": utc_now_iso(), "kind": kind, "description": description, "source": source})


def update_profile(db: Database, run_id: str, changes: Mapping[str, Any], *, actor: str, reason: str,
                   source: str = "cli_asserted") -> list[str]:
    """Change what the committee is told about the organisation. Returns the fields that actually changed."""
    why = _reason(reason)
    current = db.fetch_one("SELECT * FROM org_profiles WHERE run_id = ?", (run_id,))
    if current is None:
        raise SettingsError(f"{run_id} has no organisation profile to change")
    unknown = sorted(set(changes) - set(PROFILE_FIELDS))
    if unknown:
        raise SettingsError(f"{', '.join(unknown)} cannot be changed here")
    cleaned = {k: (str(v).strip() or None) for k, v in changes.items()}
    if "framework" in cleaned and cleaned["framework"] not in (None, *FRAMEWORKS):
        raise SettingsError(f"framework must be one of {', '.join(FRAMEWORKS)}")
    if "name" in cleaned and len(cleaned["name"] or "") < 2:
        raise SettingsError("the organisation needs a name")
    if "risk_appetite" in cleaned and len(cleaned["risk_appetite"] or "") < 20:
        raise SettingsError("the board's direction on AI needs at least a sentence: the committee argues from it")

    changed = [field for field, value in cleaned.items() if (current[field] or None) != value]
    for field in changed:
        record_change(db, run_id, actor=actor, source=source, area="profile", target=field,
                      before=current[field], after=cleaned[field], reason=why)
    if changed:
        db.update("org_profiles", {f: cleaned[f] for f in changed}, where={"run_id": run_id})
        _log_intervention(db, run_id, "param_change", f"profile changed ({', '.join(changed)}) by {actor}: {why}", source)
    return changed


def documents(db: Database, run_id: str) -> list[Any]:
    """Documents in force. Retired ones stay in the table and out of this list."""
    return db.fetch_all("SELECT document_id, kind, title, body, added_by, added_at FROM documents "
                        "WHERE run_id = ? AND retired_at IS NULL ORDER BY added_at, document_id", (run_id,))


def add_document(db: Database, run_id: str, *, kind: str, title: str, body: str, actor: str, reason: str,
                 source: str = "cli_asserted") -> str:
    why = _reason(reason)
    if kind not in DOCUMENT_KINDS:
        raise SettingsError(f"document kind must be one of {', '.join(DOCUMENT_KINDS)}")
    if len(title.strip()) < 3 or len(body.strip()) < 20:
        raise SettingsError("a document needs a title and enough text for the committee to cite")
    if len(body) > MAX_DOCUMENT_CHARS:
        raise SettingsError(f"a document can be at most {MAX_DOCUMENT_CHARS:,} characters; split it by section")
    document_id = ids.unique(run_id, "document")
    db.insert("documents", {"document_id": document_id, "run_id": run_id, "kind": kind, "title": title.strip(),
                            "body": body.strip(), "added_by": actor, "added_at": utc_now_iso(), "retired_at": None})
    record_change(db, run_id, actor=actor, source=source, area="document", target=title.strip(),
                  before=None, after=f"added ({kind}, {len(body.strip()):,} characters)", reason=why)
    _log_intervention(db, run_id, "param_change", f"document added by {actor}: {title.strip()}", source)
    return document_id


def retire_document(db: Database, run_id: str, document_id: str, *, actor: str, reason: str,
                    source: str = "cli_asserted") -> None:
    why = _reason(reason)
    row = db.fetch_one("SELECT title FROM documents WHERE document_id = ? AND run_id = ? AND retired_at IS NULL",
                       (document_id, run_id))
    if row is None:
        raise SettingsError("that document is not in force, so it cannot be retired")
    db.update("documents", {"retired_at": utc_now_iso()}, where={"document_id": document_id})
    record_change(db, run_id, actor=actor, source=source, area="document", target=row["title"],
                  before="in force", after="retired", reason=why)
    _log_intervention(db, run_id, "param_change", f"document retired by {actor}: {row['title']}", source)


def set_panel(db: Database, run_id: str, *, kind: str, seats: Sequence[str], config_dir: Path, actor: str,
              reason: str, risk_tier: str = "*", source: str = "cli_asserted") -> None:
    """Choose which seats review one kind of matter, recording the panel it replaces."""
    from govern.context import load_org_profile
    from govern.intake import KIND_LABELS
    from govern.panels import ALL, _override, load_panels, set_panel_rule

    why = _reason(reason)
    if kind not in KIND_LABELS:
        raise SettingsError(f"kind must be one of {', '.join(KIND_LABELS)}")
    org = load_org_profile(db, run_id)
    if org is None:
        raise SettingsError(f"{run_id} has no committee to choose a panel from")
    strangers = [s for s in seats if s not in org.seats]
    if strangers:
        raise SettingsError(f"{', '.join(strangers)} not on this committee")
    if not seats:
        raise SettingsError("a panel needs at least one seat besides the chair")
    before = _override(db, run_id, kind, risk_tier if risk_tier != "*" else None)
    if before is None:
        default = load_panels(config_dir)["rules"].get(kind, ALL)
        before = list(org.seats) if default == ALL else list(default)
    set_panel_rule(db, run_id, kind=kind, seats=list(seats), risk_tier=risk_tier)
    target = kind if risk_tier == "*" else f"{kind} ({risk_tier} risk)"
    record_change(db, run_id, actor=actor, source=source, area="panel", target=target,
                  before=", ".join(before), after=", ".join(seats), reason=why)
    _log_intervention(db, run_id, "param_change", f"panel for {target} changed by {actor}: {why}", source)


def change_log(db: Database, run_id: str, limit: int = 200) -> list[Any]:
    return db.fetch_all("SELECT * FROM config_changes WHERE run_id = ? ORDER BY changed_at DESC, change_id DESC LIMIT ?",
                        (run_id, limit))
