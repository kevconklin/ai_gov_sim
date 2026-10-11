"""The corpus: what the organization has written down, and how the committee changes it.

The governing documents (policy, charter, acceptable use, standards) are what every review reads
and cites. The committee may propose a revision to any of them, or a new one, as a draft attached
to the matter under review; a person sees the exact change before signing, and signing "approved"
applies it as a new version that supersedes the old. Nothing is overwritten and nothing applies
without the signature. A register of the AI the organization has approved, who owns each thing,
and on what conditions is written from the record itself and attached to every review.
"""

from __future__ import annotations

from datetime import date
from typing import Any, Sequence

from govern import ids
from govern.db import Database, utc_now_iso
from govern.policy import PolicyError, apply_edit

POLICY_TARGET, DOCUMENT_TARGET = "policy", "document"
MAX_BODY = 60_000


class CorpusError(ValueError):
    """The revision cannot be recorded as asked."""


# ---- proposing ----------------------------------------------------------------------------------

MODES = ("add", "replace")      # for a policy section: add the text to it, or replace the whole section


def propose(db: Database, run_id: str, *, meeting_id: str, item_id: str, agent_id: str, target: str, title: str, body: str,
            rationale: str, kind: str | None = None, mode: str = "add") -> str:
    """A draft revision, attached to a matter. It applies only if a person signs that matter approved."""
    if target not in (POLICY_TARGET, DOCUMENT_TARGET):
        raise CorpusError("target must be 'policy' or 'document'")
    if len(title.strip()) < 3:
        raise CorpusError("name the document, or the policy section")
    if len(body.strip()) < 20:
        raise CorpusError("give the full text you propose, not a description of it")
    if len(body) > MAX_BODY:
        raise CorpusError(f"keep a document under {MAX_BODY:,} characters")
    if len(rationale.strip()) < 10:
        raise CorpusError("say why, in at least a sentence")
    if mode not in MODES:
        raise CorpusError("mode must be 'add' or 'replace'")
    document_id = None
    if target == DOCUMENT_TARGET:
        existing = db.fetch_one("SELECT document_id, kind FROM documents WHERE run_id = ? AND retired_at IS NULL AND lower(title) = lower(?)",
                                (run_id, title.strip()))
        if existing:
            document_id, kind = existing["document_id"], existing["kind"]
        elif kind not in ("acceptable_use", "charter", "policy", "standard", "regulation", "other"):
            raise CorpusError("a new document needs a kind: acceptable_use, charter, standard, regulation, or other")
    rev_id = ids.unique(run_id, "rev")
    db.insert("document_revisions", {"rev_id": rev_id, "run_id": run_id, "meeting_id": meeting_id, "item_id": item_id.strip().upper(),
                                     "agent_id": agent_id, "target": target, "document_id": document_id, "kind": kind,
                                     "title": title.strip(), "body": body.strip(), "rationale": rationale.strip(),
                                     "status": "proposed", "applied_as": None, "created_at": utc_now_iso(), "mode": mode if target == POLICY_TARGET else None})
    return rev_id


def proposed_for(db: Database, meeting_id: str, item_id: str) -> list[Any]:
    return db.fetch_all("SELECT r.*, a.title AS seat_title FROM document_revisions r JOIN agents a ON a.agent_id = r.agent_id "
                        "WHERE r.meeting_id = ? AND r.item_id = ? AND r.status = 'proposed' ORDER BY r.created_at", (meeting_id, item_id.upper()))


# ---- applying, on the signature -----------------------------------------------------------------

def apply_revisions(db: Database, run_id: str, *, meeting_id: str, item_id: str, outcome: str, actor: str, on: date,
                    policy_text: str) -> tuple[str, list[str]]:
    """Apply this matter's proposed revisions if it was signed approved; drop them otherwise.

    Returns the policy text after any policy revisions (the caller commits it) and notes on anything that
    could not apply. Each document revision becomes a new version that supersedes the old, on the change record.
    """
    from govern.settings import record_change
    notes: list[str] = []
    for rev in proposed_for(db, meeting_id, item_id):
        if outcome != "approved":
            db.update("document_revisions", {"status": "dropped"}, where={"rev_id": rev["rev_id"]})
            continue
        if rev["target"] == POLICY_TARGET:
            try:
                from govern.policy import read_section
                current = read_section(policy_text, rev["title"]) if (rev["mode"] or "add") == "add" else None
                # "add" keeps what the section says and puts the new text after it; "replace" is the whole section
                policy_text = apply_edit(policy_text, rev["title"], f"{current}\n\n{rev['body']}" if current else rev["body"])
            except PolicyError as error:
                notes.append(f"{rev['title']}: {error}")
                db.update("document_revisions", {"status": "dropped"}, where={"rev_id": rev["rev_id"]})
                continue
            db.update("document_revisions", {"status": "applied", "applied_as": "policy"}, where={"rev_id": rev["rev_id"]})
            record_change(db, run_id, actor=actor, source="dashboard_session", area="policy", target=rev["title"], before=None,
                          after=f"section revised as the committee proposed on {item_id}", reason=f"Signed approved on {item_id}: {rev['rationale'][:200]}")
            continue
        old = db.fetch_one("SELECT * FROM documents WHERE document_id = ?", (rev["document_id"],)) if rev["document_id"] else None
        new_id = ids.unique(run_id, "document")
        db.insert("documents", {"document_id": new_id, "run_id": run_id, "kind": (old["kind"] if old else rev["kind"]) or "other",
                                "title": rev["title"], "body": rev["body"], "added_by": actor, "added_at": utc_now_iso(), "retired_at": None,
                                "version": (int(old["version"]) + 1) if old else 1, "supersedes": old["document_id"] if old else None})
        if old:
            db.update("documents", {"retired_at": utc_now_iso()}, where={"document_id": old["document_id"]})
        db.update("document_revisions", {"status": "applied", "applied_as": new_id}, where={"rev_id": rev["rev_id"]})
        record_change(db, run_id, actor=actor, source="dashboard_session", area="document", target=rev["title"],
                      before=f"version {old['version']}" if old else None, after=f"version {(int(old['version']) + 1) if old else 1}, as the committee proposed on {item_id}",
                      reason=f"Signed approved on {item_id}: {rev['rationale'][:200]}")
    return policy_text, notes


# ---- the register, written from the record ------------------------------------------------------

def register_text(db: Database, run_id: str) -> str:
    """The AI the organization has decided on: what, who owns it, on what conditions, when it is back for review."""
    from govern.intake import KIND_LABELS
    rows = db.fetch_all(
        """SELECT i.item_id, i.kind, i.title, i.status, i.stage, i.owner, i.risk_tier, i.review_due, i.decided_on,
                  (SELECT a.rationale FROM attestations a JOIN decisions d ON d.decision_id = a.decision_id
                    WHERE d.ref_id = i.item_id AND a.outcome <> 'deferred' ORDER BY a.created_at DESC LIMIT 1) AS conditions,
                  (SELECT a.actor FROM attestations a JOIN decisions d ON d.decision_id = a.decision_id
                    WHERE d.ref_id = i.item_id AND a.outcome <> 'deferred' ORDER BY a.created_at DESC LIMIT 1) AS signed_by
           FROM items i WHERE i.run_id = ? AND i.kind IN ('tool', 'vendor', 'use_case') AND i.status IN ('approved', 'rejected')
           ORDER BY i.status, i.title""", (run_id,))
    if not rows:
        return "Nothing has been decided yet. The register fills as decisions are signed."
    lines = []
    for r in rows:
        short = r["item_id"].rsplit("/", 1)[-1]
        head = f"- {short} {KIND_LABELS.get(r['kind'], r['kind'])}: {r['title']} - {r['status']}"
        if r["signed_by"]:
            head += f" by {r['signed_by']} on {r['decided_on']}"
        parts = [head]
        if r["owner"]:
            parts.append(f"  Owner: {r['owner']}")
        if r["stage"]:
            parts.append(f"  Stage: {r['stage']}" + (f"; next review due {r['review_due']}" if r["review_due"] else ""))
        if r["conditions"]:
            parts.append(f"  Conditions, in the signer's words: {r['conditions']}")
        lines.append("\n".join(parts))
    return "\n".join(lines)
