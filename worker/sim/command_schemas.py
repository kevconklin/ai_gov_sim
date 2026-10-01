"""What a queued command may carry, checked by the worker before anything runs.

The dashboard validates with zod and the raw API is operators-only, but the queue is a table, and
a row that reached it any other way used to be executed as written. Every kind now has a shape
here; a payload that does not fit fails on the command row with the reason, and never reaches
the code that would have acted on it.
"""

from __future__ import annotations

from typing import Any, Literal, Mapping

from pydantic import BaseModel, ConfigDict, Field, ValidationError

Str = Field(min_length=1, max_length=4000)
Short = Field(min_length=1, max_length=200)
Why = Field(default=None, max_length=1000)


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Attributed(_Strict):
    actor: str | None = Field(default=None, max_length=200)
    source: Literal["dashboard_session", "cli_asserted", "unknown"] | None = None
    why: str | None = Why


class Empty(_Strict):
    pass


class Advance(_Strict):
    months: int = Field(default=1, ge=1, le=12)


class InjectEvent(_Strict):
    model_config = ConfigDict(extra="allow")   # the simulation's event shape is its own; only bounded


class Fork(_Strict):
    from_month: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    inject_event: dict[str, Any] | None = None


class SpendCap(Attributed):
    usd_per_sim_month: float = Field(gt=0, le=1_000_000)


class Candidates(_Strict):
    today: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")


class AgendaItem(_Strict):
    item_id: str = Field(min_length=1, max_length=60)
    kind: Literal["use_case", "policy_edit", "status_change", "advisory", "item"]
    title: str = Field(min_length=1, max_length=400)
    ref_id: str | None = Field(default=None, max_length=400)


class Convene(_Strict):
    agenda: list[AgendaItem] = Field(default_factory=list, max_length=40)
    advisory: list[str] = Field(default_factory=list, max_length=20)
    actor: str | None = Field(default=None, max_length=200)
    source: str | None = Field(default=None, max_length=40)


class Attest(_Strict):
    decision_id: str = Field(min_length=1, max_length=400)
    actor: str = Field(min_length=1, max_length=200)
    source: Literal["dashboard_session", "cli_asserted", "unknown"] = "unknown"
    outcome: Literal["approved", "rejected", "deferred"]
    rationale: str = Field(min_length=1, max_length=4000)
    responded_to: list[str] = Field(default_factory=list, max_length=40)
    apply: bool = True


class Submit(_Strict):
    kind: Literal["use_case", "tool", "vendor", "policy_change", "exception", "incident", "question"]
    title: str = Field(min_length=3, max_length=200)
    description: str = Field(min_length=10, max_length=4000)
    submitted_by: str = Field(min_length=1, max_length=200)
    risk_tier: Literal["low", "medium", "high"] | None = None
    details: dict[str, Any] | None = None


class SetBrief(Attributed):
    seat: str = Field(min_length=1, max_length=60)
    brief: str = Field(min_length=40, max_length=4000)


class CreateWorkspace(_Strict):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=2, max_length=200)
    risk_appetite: str = Field(min_length=20, max_length=4000)
    facts: str | None = Field(default=None, max_length=4000)
    framework: str | None = Field(default=None, max_length=40)
    business_goals: str | None = Field(default=None, max_length=4000)
    ai_landscape: str | None = Field(default=None, max_length=4000)
    ai_tools: str | None = Field(default=None, max_length=4000)
    starter: str | None = Field(default=None, pattern=r"^[a-z][a-z0-9_]{1,39}$")
    first_matters: list[dict[str, Any]] = Field(default_factory=list, max_length=30)
    answers: dict[str, Any] | None = None
    actor: str = Field(min_length=1, max_length=200)
    source: str = Field(min_length=1, max_length=40)


class UpdateProfile(Attributed):
    changes: dict[str, str | None] = Field(max_length=12)


class AddDocument(Attributed):
    kind: str = Field(min_length=1, max_length=40)
    title: str = Field(min_length=3, max_length=200)
    body: str = Field(min_length=20, max_length=60_000)


class RetireDocument(Attributed):
    document_id: str = Field(min_length=1, max_length=400)


class SetPanel(Attributed):
    kind: str = Field(min_length=1, max_length=40)
    seats: list[str] = Field(max_length=20)
    risk_tier: str = Field(default="*", max_length=10)


class AddSeat(Attributed):
    seat: str = Field(pattern=r"^[a-z][a-z0-9_]{1,39}$")
    title: str = Field(min_length=2, max_length=120)
    name: str | None = Field(default=None, max_length=120)
    brief: str = Field(min_length=40, max_length=4000)
    stance_baseline: float = Field(default=3.0, ge=1, le=5)
    model: str | None = Field(default=None, max_length=200)


class RemoveSeat(Attributed):
    seat: str = Field(min_length=1, max_length=60)


class UpdateSeat(Attributed):
    seat: str = Field(min_length=1, max_length=60)
    changes: dict[str, Any] = Field(max_length=8)


class Ask(Attributed):
    question: str = Field(min_length=10, max_length=2000)


class EscalateAsk(Attributed):
    ask_id: str = Field(min_length=1, max_length=400)


class SetMember(Attributed):
    user_id: str = Field(min_length=1, max_length=80)
    role: Literal["runs", "decides", "asks"]


class RemoveMember(Attributed):
    user_id: str = Field(min_length=1, max_length=80)


class SetStage(Attributed):
    item_id: str = Field(min_length=1, max_length=400)
    to: Literal["approved", "building", "piloting", "live", "paused", "retired"]


class SetOwner(Attributed):
    item_id: str = Field(min_length=1, max_length=400)
    owner: str = Field(min_length=2, max_length=200)


SCHEMAS: Mapping[str, type[BaseModel]] = {
    "start": Empty, "pause": Empty, "resume": Empty, "stop": Empty, "advance": Advance, "inject_event": InjectEvent, "fork": Fork,
    "set_spend_cap": SpendCap, "candidates": Candidates, "convene": Convene, "attest": Attest, "submit": Submit, "set_brief": SetBrief,
    "create_workspace": CreateWorkspace, "update_profile": UpdateProfile, "add_document": AddDocument, "retire_document": RetireDocument,
    "set_panel": SetPanel, "add_seat": AddSeat, "remove_seat": RemoveSeat, "update_seat": UpdateSeat, "ask": Ask, "escalate_ask": EscalateAsk,
    "archive_workspace": Attributed, "restore_workspace": Attributed, "set_member": SetMember, "remove_member": RemoveMember,
    "set_stage": SetStage, "set_owner": SetOwner,
}


class CommandInvalid(ValueError):
    """The payload does not fit the command's shape; it will not run."""


def validate(kind: str, payload: Mapping[str, Any]) -> dict[str, Any]:
    schema = SCHEMAS.get(kind)
    if schema is None:
        raise CommandInvalid(f"unsupported command {kind}")
    try:
        return schema.model_validate(dict(payload)).model_dump(exclude_none=True)
    except ValidationError as error:
        problems = "; ".join(f"{'.'.join(map(str, e['loc'])) or 'payload'}: {e['msg']}" for e in error.errors()[:6])
        raise CommandInvalid(f"{kind} payload refused: {problems}") from None
