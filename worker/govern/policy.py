"""The bank's AI policy: one git repo per run (SPEC 8). Sections are '## ' headings; controls are AI-GOV-###."""

from __future__ import annotations

import os
import re
import subprocess
from dataclasses import dataclass
from datetime import date
from pathlib import Path

POLICY_FILE = "policy.md"
CONTROL_ID = re.compile(r"\bAI-GOV-(\d{3,4})\b")
NEW_CONTROL = re.compile(r"\bAI-GOV-(?:NEW|XXX|###)\b", re.IGNORECASE)
_HEADING = re.compile(r"^## +(.+?)\s*$", re.MULTILINE)
_WORD = re.compile(r"[A-Za-z0-9][A-Za-z0-9'-]*")
_SENTENCE_END = re.compile(r"[.!?:]+(?:\s|$)|\n")


class PolicyError(RuntimeError):
    pass


@dataclass(frozen=True)
class PolicyStats:
    word_count: int
    controls: tuple[str, ...]
    readability_grade: float | None


def _syllables(word: str) -> int:
    word = word.lower().strip("'")
    if len(word) <= 3:
        return 1
    word = re.sub(r"(?:es|ed|e)$", "", word) or word
    return max(1, len(re.findall(r"[aeiouy]+", word)))


def stats(text: str) -> PolicyStats:
    words = _WORD.findall(CONTROL_ID.sub("", text))
    sentences = max(1, len([s for s in _SENTENCE_END.split(text) if _WORD.search(s)]))
    grade = None
    if words:
        syllables = sum(_syllables(w) for w in words)
        grade = round(0.39 * len(words) / sentences + 11.8 * syllables / len(words) - 15.59, 2)
    controls = tuple(dict.fromkeys(f"AI-GOV-{m}" for m in CONTROL_ID.findall(text)))
    return PolicyStats(word_count=len(words), controls=controls, readability_grade=grade)


def normalize_heading(section: str) -> str:
    return re.sub(r"^#+\s*", "", section).strip()


def sections(text: str) -> dict[str, str]:
    matches = list(_HEADING.finditer(text))
    result = {}
    for i, match in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        result[match.group(1)] = text[match.end():end].strip()
    return result


def read_section(text: str, section: str) -> str | None:
    wanted = normalize_heading(section).lower()
    return next((body for heading, body in sections(text).items() if heading.lower() == wanted), None)


def apply_edit(text: str, section: str, body: str) -> str:
    """Replace (or append) one section, assigning numbers to new controls and fixing duplicate ids."""
    heading = normalize_heading(section)
    if not heading or not body.strip():
        raise PolicyError("a policy edit needs a section heading and text")
    parts = sections(text)
    existing_key = next((h for h in parts if h.lower() == heading.lower()), None)
    other_ids = {int(n) for h, b in parts.items() if h != existing_key for n in CONTROL_ID.findall(b)}
    next_number = max(other_ids | {int(n) for n in CONTROL_ID.findall(text)} | {0}) + 1
    used_here: set[int] = set()

    def renumber(match: re.Match[str]) -> str:
        nonlocal next_number
        number = int(match.group(1))
        if number in other_ids or number in used_here:
            number, next_number = next_number, next_number + 1
        used_here.add(number)
        return f"AI-GOV-{number:03d}"

    def assign(_: re.Match[str]) -> str:
        nonlocal next_number
        number, next_number = next_number, next_number + 1
        used_here.add(number)
        return f"AI-GOV-{number:03d}"

    new_body = NEW_CONTROL.sub(assign, CONTROL_ID.sub(renumber, re.sub(r"^## .*$", "", body.strip(), flags=re.MULTILINE).strip()))
    preamble = text[: _HEADING.search(text).start()].rstrip() if _HEADING.search(text) else text.rstrip()
    preamble = preamble.replace(" No sections have been adopted yet.", "")
    ordered = [(existing_key or heading, new_body) if h == existing_key else (h, b) for h, b in parts.items()]
    if existing_key is None:
        ordered.append((heading, new_body))
    return preamble + "\n\n" + "\n\n".join(f"## {h}\n\n{b}" for h, b in ordered) + "\n"


class PolicyRepo:
    def __init__(self, path: Path) -> None:
        self.path = Path(path)

    def _git(self, *args: str, sim_date: date | None = None) -> str:
        env = {**os.environ, "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_SYSTEM": "/dev/null"}
        if sim_date is not None:
            stamp = f"{sim_date.isoformat()}T17:00:00-06:00"
            env.update(GIT_AUTHOR_DATE=stamp, GIT_COMMITTER_DATE=stamp)
        result = subprocess.run(["git", *args], cwd=self.path, env=env, capture_output=True, text=True)
        if result.returncode != 0:
            raise PolicyError(f"git {' '.join(args)} failed: {result.stderr.strip()}")
        return result.stdout.strip()

    def init(self, bank_name: str, author_email: str, sim_date: date) -> str:
        self.path.mkdir(parents=True, exist_ok=True)
        self._git("init", "-q", "-b", "main")
        self._git("config", "user.name", "AI Governance Committee")
        self._git("config", "user.email", author_email)
        header = (f"# {bank_name} Artificial Intelligence Policy\n\nOwner: AI Governance Committee\n\n"
                  "Requirements are numbered AI-GOV-###. No sections have been adopted yet.\n")
        return self.commit(header, f"{sim_date.isoformat()}: policy file created", sim_date)

    def read(self) -> str:
        return (self.path / POLICY_FILE).read_text()

    def commit(self, text: str, message: str, sim_date: date) -> str:
        (self.path / POLICY_FILE).write_text(text)
        self._git("add", POLICY_FILE)
        if self._git("status", "--porcelain"):
            self._git("commit", "-q", "-m", message, sim_date=sim_date)
        return self.head()

    def head(self) -> str:
        return self._git("rev-parse", "HEAD")

    def reset_to(self, sha: str) -> None:
        self._git("reset", "-q", "--hard", sha)

    def clone_to(self, destination: Path, sha: str) -> "PolicyRepo":
        destination.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "clone", "-q", str(self.path), str(destination)], check=True, capture_output=True)
        clone = PolicyRepo(destination)
        for key in ("user.name", "user.email"):
            clone._git("config", key, self._git("config", "--get", key))
        clone.reset_to(sha)
        return clone
