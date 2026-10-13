"""Starter kits: governance in an hour.

An organization with no AI governance is stopped by the blank page, not by the committee. A kit
gives a new workspace a policy of numbered controls mapped to the framework it chose, a committee
charter, an acceptable-use document, sensible profile defaults, and one matter already waiting:
"does this policy fit us?" The committee's first review is of its own starting point, and the
person's first signature is a real one.

Nothing here is legal advice, and the policy says so in its own preamble. Every value a kit sets is
written to the change record under the name of the person who chose the kit, so it reads like any
other configuration change later.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Mapping

import yaml

from govern import settings
from govern.db import Database, utc_now_iso
from govern.intake import submit_item
from govern.policy import PolicyRepo, stats

STARTERS_DIR = "starters"
CONTROLS_FILE = "controls.yaml"
DOCUMENTS_DIR = "documents"
STANCES = ("cautious", "balanced", "ambitious")
# How a framework is named beside a control, short enough to sit in parentheses.
FRAMEWORK_TAGS: Mapping[str, str] = {
    "nist_ai_rmf": "NIST AI RMF",
    "iso_42001": "ISO/IEC 42001",
    "eu_ai_act": "EU AI Act",
    "sr_11_7": "SR 11-7",
}
FIRST_MATTER_TIER = "medium"


class StarterError(ValueError):
    """A kit cannot be loaded or applied as it stands."""


@dataclass(frozen=True)
class Control:
    key: str
    section: str
    text: str                      # may hold {org}
    map: Mapping[str, str]         # framework id -> clause


@dataclass(frozen=True)
class Stance:
    label: str
    text: str


@dataclass(frozen=True)
class StarterDocument:
    kind: str
    title: str                     # may hold {org}
    body: str                      # may hold {org}


@dataclass(frozen=True)
class FirstMatter:
    title: str                     # may hold {org} and {framework}
    description: str


@dataclass(frozen=True)
class Starter:
    id: str
    label: str
    summary: str
    audience: str
    framework: str
    stances: Mapping[str, Stance]
    facts_template: str
    business_goals: str
    controls: tuple[Control, ...]
    documents: tuple[StarterDocument, ...]
    first_matter: FirstMatter


def _text(value: Any) -> str:
    return " ".join(str(value or "").split())


def load_controls(config_dir: Path) -> Mapping[str, Control]:
    """The control library, keyed by control key, in the order the policy will present them."""
    path = Path(config_dir) / STARTERS_DIR / CONTROLS_FILE
    if not path.is_file():
        raise StarterError(f"missing config file: {STARTERS_DIR}/{CONTROLS_FILE} (looked in {config_dir})")
    data = yaml.safe_load(path.read_text()) or {}
    library: dict[str, Control] = {}
    for section in data.get("sections") or []:
        title = _text(section.get("title"))
        for raw in section.get("controls") or []:
            key = _text(raw.get("key"))
            if not key or not title or len(_text(raw.get("text"))) < 20:
                raise StarterError(f"{CONTROLS_FILE}: every control needs a key, a section title, and a paragraph of text")
            if key in library:
                raise StarterError(f"{CONTROLS_FILE}: control {key!r} appears twice")
            mapping = {str(k): _text(v) for k, v in (raw.get("map") or {}).items() if _text(v)}
            unknown = sorted(set(mapping) - set(FRAMEWORK_TAGS))
            if unknown:
                raise StarterError(f"{CONTROLS_FILE}: control {key!r} maps to unknown framework(s) {', '.join(unknown)}")
            library[key] = Control(key=key, section=title, text=_text(raw.get("text")), map=mapping)
    if not library:
        raise StarterError(f"{CONTROLS_FILE} defines no controls")
    return library


def _load_document(config_dir: Path, kind: str) -> StarterDocument:
    if kind not in settings.DOCUMENT_KINDS:
        raise StarterError(f"document kind must be one of {', '.join(settings.DOCUMENT_KINDS)}, not {kind!r}")
    path = Path(config_dir) / STARTERS_DIR / DOCUMENTS_DIR / f"{kind}.md"
    if not path.is_file():
        raise StarterError(f"missing starter document {STARTERS_DIR}/{DOCUMENTS_DIR}/{kind}.md")
    text = path.read_text().strip()
    heading = re.match(r"^# +(.+?)\s*\n", text)
    if heading is None:
        raise StarterError(f"{path.name} must begin with a '# Title' line; it becomes the document's title")
    return StarterDocument(kind=kind, title=heading.group(1).strip(), body=text[heading.end():].strip())


def _load_kit(path: Path, library: Mapping[str, Control], config_dir: Path) -> Starter:
    data = yaml.safe_load(path.read_text()) or {}
    kit_id = _text(data.get("id"))
    if kit_id != path.stem:
        raise StarterError(f"{path.name}: id must be {path.stem!r}, found {kit_id!r}")
    framework = _text(data.get("framework"))
    if framework not in FRAMEWORK_TAGS:
        raise StarterError(f"{path.name}: framework must be one of {', '.join(FRAMEWORK_TAGS)}")
    stances = {name: Stance(label=_text((data.get("stances") or {}).get(name, {}).get("label")) or name.title(),
                            text=_text((data.get("stances") or {}).get(name, {}).get("text")))
               for name in STANCES}
    if any(len(s.text) < 20 for s in stances.values()):
        raise StarterError(f"{path.name}: every stance ({', '.join(STANCES)}) needs a paragraph the board could have said")
    keys = [str(k) for k in data.get("controls") or []]
    missing = [k for k in keys if k not in library]
    if missing:
        raise StarterError(f"{path.name}: unknown control(s) {', '.join(missing)}; the library is {CONTROLS_FILE}")
    if len(set(keys)) != len(keys):
        raise StarterError(f"{path.name}: a control is listed twice")
    matter = data.get("first_matter") or {}
    if len(_text(matter.get("title"))) < 3 or len(_text(matter.get("description"))) < 10:
        raise StarterError(f"{path.name}: first_matter needs a title and a description the committee can act on")
    return Starter(
        id=kit_id, label=_text(data.get("label")) or kit_id, summary=_text(data.get("summary")),
        audience=_text(data.get("audience")), framework=framework, stances=stances,
        facts_template=_text(data.get("facts_template")), business_goals=_text(data.get("business_goals")),
        controls=tuple(library[k] for k in keys),
        documents=tuple(_load_document(config_dir, str(kind)) for kind in data.get("documents") or []),
        first_matter=FirstMatter(title=_text(matter.get("title")), description=_text(matter.get("description"))),
    )


def load_starters(config_dir: Path) -> Mapping[str, Starter]:
    """Every kit in config/starters, keyed by id. Loading validates all of them, so a broken kit fails CI, not setup."""
    library = load_controls(config_dir)
    folder = Path(config_dir) / STARTERS_DIR
    kits = {path.stem: _load_kit(path, library, Path(config_dir))
            for path in sorted(folder.glob("*.yaml")) if path.name != CONTROLS_FILE}
    if not kits:
        raise StarterError(f"no starter kits found in {folder}")
    return kits


def get_starter(config_dir: Path, starter_id: str) -> Starter:
    kits = load_starters(config_dir)
    if starter_id not in kits:
        raise StarterError(f"unknown starter kit {starter_id!r}; choose from {', '.join(sorted(kits))}")
    return kits[starter_id]


# ---- rendering -----------------------------------------------------------------------------------

def _tag(control: Control, framework: str) -> str:
    clause = control.map.get(framework)
    return f" ({FRAMEWORK_TAGS[framework]} {clause})" if clause else ""


def render_policy(kit: Starter, *, org: str, framework: str) -> str:
    """The kit's controls as a policy file, numbered in order, each tagged with the chosen framework's clause.

    Sections follow the library's order; a section the kit takes nothing from is left out. One control per
    paragraph, because that is how the committee edits them and how the dashboard lists them.
    """
    if framework not in FRAMEWORK_TAGS:
        raise StarterError(f"framework must be one of {', '.join(FRAMEWORK_TAGS)}, not {framework!r}")
    by_section: dict[str, list[Control]] = {}
    for control in kit.controls:
        by_section.setdefault(control.section, []).append(control)
    number = 0
    parts = []
    for section, controls in by_section.items():
        lines = []
        for control in controls:
            number += 1
            lines.append(f"AI-GOV-{number:03d} {control.text.format(org=org)}{_tag(control, framework)}")
        parts.append(f"## {section}\n\n" + "\n\n".join(lines))
    preamble = (f"# {org} Artificial Intelligence Policy\n\nOwner: AI Governance Committee\n\n"
                f"Requirements are numbered AI-GOV-###. This policy started from the {kit.label} starter kit, mapped to "
                f"{settings.FRAMEWORKS[framework]}. It is a starting point for the committee and the board to make their own, "
                "not legal advice.\n")
    return preamble + "\n" + "\n\n".join(parts) + "\n"


# ---- applying ------------------------------------------------------------------------------------

def apply_starter(db: Database, run_id: str, kit: Starter, *, org: str, slug: str, framework: str | None,
                  data_dir: Path, today: date, actor: str, source: str) -> Mapping[str, Any]:
    """Give a freshly created workspace the kit's policy, documents, defaults, and first matter.

    The workspace's own profile row must already exist. Anything the person chose at setup stands; the kit only
    fills what was left blank. Returns what it created so a caller can report it.
    """
    framework = framework if framework and framework != "none" else kit.framework    # a starter policy must map to something
    reason = f"Starter kit: {kit.label}, chosen at setup"
    who = dict(actor=actor, source=source)
    settings.record_change(db, run_id, area="starter", target=kit.id, before=None, after=kit.label, reason=reason, **who)

    text = render_policy(kit, org=org, framework=framework)
    sha = PolicyRepo(Path(data_dir) / "policies" / run_id / slug).commit(
        text, f"{today.isoformat()}: starter policy from the {kit.label} kit", today)
    policy_stats = stats(text)
    db.upsert("policy_versions", {
        "run_id": run_id, "bank_id": slug, "sim_month": today.isoformat()[:7], "git_sha": sha, "policy_text": text,
        "word_count": policy_stats.word_count, "control_count": len(policy_stats.controls),
        "controls": list(policy_stats.controls), "readability": policy_stats.readability_grade,
    }, key=("run_id", "sim_month"))
    settings.record_change(db, run_id, area="policy", target="starter", before=None,
                           after=f"{len(policy_stats.controls)} controls from the {kit.label} kit, mapped to {settings.FRAMEWORKS[framework]}",
                           reason=reason, **who)

    document_ids = [settings.add_document(db, run_id, kind=doc.kind, title=doc.title.format(org=org),
                                         body=doc.body.format(org=org), reason=reason, **who)
                    for doc in kit.documents]

    current = db.fetch_one("SELECT framework, business_goals FROM org_profiles WHERE run_id = ?", (run_id,))
    defaults = {field: value for field, value in (("framework", framework), ("business_goals", kit.business_goals))
                if value and (current[field] or "").strip() in ("", "none")}
    if defaults:
        settings.update_profile(db, run_id, defaults, reason=reason, **who)

    framework_name = settings.FRAMEWORKS[framework]
    item_id = submit_item(db, run_id, kind="policy_change",
                          title=kit.first_matter.title.format(org=org, framework=framework_name),
                          description=kit.first_matter.description.format(org=org, framework=framework_name),
                          submitted_by=actor, risk_tier=FIRST_MATTER_TIER, today=today)
    return {"starter": kit.id, "framework": framework, "policy_sha": sha, "controls": len(policy_stats.controls),
            "document_ids": document_ids, "first_matter": item_id}


# ---- what the dashboard reads --------------------------------------------------------------------

def publish_starters(db: Database, config_dir: Path) -> None:
    """Write the kits to `starter_kits` so the dashboard, which cannot read config/, can offer them."""
    now = utc_now_iso()
    kits = load_starters(config_dir)
    for kit in kits.values():
        db.upsert("starter_kits", {
            "starter_id": kit.id, "label": kit.label, "summary": kit.summary, "audience": kit.audience,
            "framework": kit.framework,
            "stances": json.dumps({name: {"label": s.label, "text": s.text} for name, s in kit.stances.items()}),
            "facts_template": kit.facts_template, "business_goals": kit.business_goals,
            "control_count": len(kit.controls), "document_count": len(kit.documents), "updated_at": now,
        }, key=("starter_id",))
    stale = [r["starter_id"] for r in db.fetch_all("SELECT starter_id FROM starter_kits") if r["starter_id"] not in kits]
    for starter_id in stale:
        db.execute("DELETE FROM starter_kits WHERE starter_id = ?", (starter_id,))
