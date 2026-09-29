"""Employees ask the policy, not the committee.

Most of the time governance spends is answering the same questions: can I paste this into that,
do I need approval for this tool. Those have answers in the policy, if anyone reads it. Here a
question is answered from the policy and the documents in force, with the controls it relies on
cited by number, or with a plain admission that the policy does not cover it. The admissions are
the point: they become questions for the committee, and the person still decides when to convene.

The answer is one model call through `govern.llm`, on the utility model, counted against the
workspace's cap. It never invents a control: a citation is kept only if the policy has it, and
"covered" is kept only if at least one citation survives.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date
from typing import Any, Mapping, Sequence

from govern import ids, prompts, settings
from govern.agents.structured import extract, forced, tool
from govern.budget import require_review_budget
from govern.context import ReviewContext
from govern.db import Database, utc_now_iso
from govern.intake import submit_item
from govern.policy import stats
from govern.untrusted import quote

MIN_QUESTION, MAX_QUESTION = 10, 2000
MAX_ANSWER_TOKENS = 700
PURPOSE = "ask_policy"
TOOL = tool("answer_from_policy", "Answer the question from the policy and documents given, or say the policy does not cover it.", {
    "covered": {"type": "boolean", "description": "True only if the policy or a document in force settles the question."},
    "answer": {"type": "string", "description": "The answer to the person asking, in plain language. If not covered, say so and what would settle it."},
    "controls_cited": {"type": "array", "items": {"type": "string"}, "description": "AI-GOV ids the answer relies on, exactly as they appear in the policy. Empty if not covered."},
})


class AskError(ValueError):
    """The question cannot be taken, or the ask cannot be sent on, as it stands."""


@dataclass(frozen=True)
class Ask:
    ask_id: str
    question: str
    answer: str
    covered: bool
    controls: tuple[str, ...]
    asked_by: str
    asked_at: str
    item_id: str | None


def _settle(raw: Mapping[str, Any], *, policy_controls: Sequence[str]) -> dict[str, Any]:
    """Keep only citations the policy has; without one, the answer is not covered whatever the model said."""
    known = set(policy_controls)
    cited = tuple(dict.fromkeys(str(c).strip().upper() for c in raw.get("controls_cited") or [] if str(c).strip().upper() in known))
    covered = bool(raw.get("covered")) and bool(cited)
    return {"answer": str(raw.get("answer") or "").strip(), "covered": covered, "controls": cited}


def _documents_block(db: Database, run_id: str, policy_text: str) -> str:
    parts = [f"THE POLICY IN FORCE\n\n{policy_text.strip()}"]
    for doc in settings.documents(db, run_id):
        parts.append(f"DOCUMENT IN FORCE: {doc['title']} ({doc['kind'].replace('_', ' ')})\n\n{doc['body'].strip()}")
    return "\n\n----\n\n".join(parts)


def answer(ctx: ReviewContext, *, question: str, asked_by: str, today: date | None = None) -> Ask:
    """Answer one question from the policy. Records the ask whether or not the policy covered it."""
    question = " ".join(question.split())
    if not MIN_QUESTION <= len(question) <= MAX_QUESTION:
        raise AskError(f"a question needs between {MIN_QUESTION} and {MAX_QUESTION:,} characters")
    if not asked_by.strip():
        raise AskError("a question needs to say who is asking")
    require_review_budget(ctx.db, dict(ctx.run), ctx.config)

    org = ctx.org
    policy_text = ctx.policy_repo.read()
    result = ctx.llm.call(forced({
        "role": "utility", "purpose": PURPOSE, "run_id": ctx.run_id, "max_tokens": MAX_ANSWER_TOKENS,
        # the brief and the documents are stable between asks, so both sit in the cached block
        "system_fixed": (prompts.render("ask/fixed.md", org=org.name), _documents_block(ctx.db, ctx.run_id, policy_text)),
        "messages": ({"role": "user", "content": f"Question from {asked_by.strip()}:\n\n" + quote(question, source=f"the person asking, {asked_by.strip()}")},),
    }, TOOL))
    settled = _settle(extract(result, TOOL["name"]), policy_controls=stats(policy_text).controls)
    if not settled["answer"]:
        raise AskError("the model returned no answer; try again")

    asked_at = (today or date.today()).isoformat()
    ask_id = ids.unique(ctx.run_id, "ask")
    ctx.db.insert("asks", {
        "ask_id": ask_id, "run_id": ctx.run_id, "asked_by": asked_by.strip(), "asked_at": asked_at, "question": question,
        "answer": settled["answer"], "covered": settled["covered"], "controls": list(settled["controls"]),
        "call_id": result.call_id, "item_id": None, "created_at": utc_now_iso(),
    })
    return Ask(ask_id=ask_id, question=question, answer=settled["answer"], covered=settled["covered"],
               controls=settled["controls"], asked_by=asked_by.strip(), asked_at=asked_at, item_id=None)


def _row(row: Any) -> Ask:
    controls = row["controls"]
    return Ask(ask_id=row["ask_id"], question=row["question"], answer=row["answer"], covered=bool(row["covered"]),
               controls=tuple(json.loads(controls) if isinstance(controls, str) else controls or []),
               asked_by=row["asked_by"], asked_at=row["asked_at"], item_id=row["item_id"])


def unanswered(db: Database, run_id: str) -> tuple[Ask, ...]:
    """Asks the policy could not settle and nobody has sent to the committee yet: what it should hear next."""
    rows = db.fetch_all("SELECT * FROM asks WHERE run_id = ? AND NOT covered AND item_id IS NULL ORDER BY created_at DESC", (run_id,))
    return tuple(_row(r) for r in rows)


def send_to_committee(db: Database, run_id: str, ask_id: str, *, actor: str, today: date | None = None) -> str:
    """Turn an ask into a question for the committee. It joins Waiting; a person still convenes."""
    row = db.fetch_one("SELECT * FROM asks WHERE ask_id = ? AND run_id = ?", (ask_id, run_id))
    if row is None:
        raise AskError("that question is not on this workspace's record")
    if row["item_id"]:
        raise AskError("that question has already been sent to the committee")
    if not actor.strip():
        raise AskError("sending a question to the committee needs someone's name on it")
    ask = _row(row)
    verdict = "The policy could not answer it." if not ask.covered else f"The policy answered it, citing {', '.join(ask.controls)}, and it was sent on anyway."
    description = (f"Asked by {ask.asked_by} on {ask.asked_at}. {verdict}\n\n"
                   f"What the policy reading said:\n{ask.answer}\n\n"
                   "The committee is asked what the policy should say, and whether a control should be added or changed.")
    item_id = submit_item(db, run_id, kind="question", title=ask.question[:200], description=description,
                          submitted_by=actor.strip(), details={"ask_id": ask_id}, today=today)
    db.update("asks", {"item_id": item_id}, where={"ask_id": ask_id})
    return item_id
