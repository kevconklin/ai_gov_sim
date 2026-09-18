"""Scripted stand-in for the Anthropic client, for tests and free end-to-end demo runs.

It returns real SDK Message objects with plausible tool calls, chosen deterministically from a hash of the request.
Nothing it produces is research data; demo runs are for exercising the pipeline and the dashboard.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from typing import Any, Mapping

from anthropic.types import Message
from anthropic.types.messages import MessageBatch, MessageBatchIndividualResponse

USE_CASES = [
    {"title": "Call center conversation summaries", "description": "Summarize contact center calls into CRM notes so agents "
     "spend less time on after-call work and sales leads are logged consistently.", "line_of_business": "operations",
     "delivery": "vendor", "vendor_name": "Brevanta", "customer_facing": False, "affects_credit_decisions": False,
     "data_used": ["call transcripts", "CRM records"], "human_review": "Representatives edit notes before saving.",
     "expected_benefit": "About 9 minutes saved per call and more follow-up on cross-sell leads.", "estimated_cost_usd": 310000},
    {"title": "Personal loan pre-qualification model", "description": "Machine learning model that pre-qualifies existing "
     "deposit customers for personal loans and triggers targeted offers.", "line_of_business": "consumer_lending",
     "delivery": "build", "customer_facing": True, "affects_credit_decisions": True,
     "data_used": ["deposit history", "bureau attributes"], "human_review": "Underwriters review declines on request.",
     "expected_benefit": "Loan growth of 6 to 9 percent in the personal loan book.", "estimated_cost_usd": 850000},
    {"title": "Staff writing and research assistant", "description": "Approved generative assistant for employees with "
     "retrieval over policies and procedures, replacing unapproved public tools.", "line_of_business": "enterprise",
     "delivery": "vendor", "vendor_name": "Brevanta", "customer_facing": False, "affects_credit_decisions": False,
     "data_used": ["policies and procedures"], "human_review": "Employees remain responsible for outputs.",
     "expected_benefit": "Productivity and reduced use of unapproved tools.", "estimated_cost_usd": 420000},
    {"title": "Next-best-offer marketing engine", "description": "Personalized product offers in digital banking and email "
     "based on customer behavior.", "line_of_business": "marketing", "delivery": "vendor", "customer_facing": True,
     "affects_credit_decisions": False, "data_used": ["transaction data", "digital engagement"],
     "human_review": "Marketing approves offer templates.", "expected_benefit": "Higher product per household.",
     "estimated_cost_usd": 390000},
]
POLICY_SECTIONS = [
    ("Scope and Inventory", "AI-GOV-NEW: This policy applies to every AI system the Bank builds, buys, or uses.\n"
     "AI-GOV-NEW: The Model Inventory Office maintains an inventory of all AI systems with an accountable owner for each."),
    ("Acceptable Use of AI Tools", "AI-GOV-NEW: Employees may use only approved AI tools for Bank work.\n"
     "AI-GOV-NEW: Customer information must not be entered into unapproved tools."),
    ("Model Validation", "AI-GOV-NEW: Models that affect customers or credit decisions are independently validated before use.\n"
     "AI-GOV-NEW: Validated models are reviewed at least annually."),
    ("Vendor Due Diligence", "AI-GOV-NEW: AI vendors complete third-party risk review before contract signature."),
    ("Human Review", "AI-GOV-NEW: Credit decisions supported by AI include a documented human review path."),
]
REMARKS = [
    "I support moving forward, but I want a clear owner and a ninety-day checkpoint with real numbers.",
    "My concern is capacity. We have the same engineers committed to the core upgrade, and something will slip.",
    "Before we approve anything customer-facing, I need to see how we explain decisions and handle complaints.",
    "The revenue case is plausible but thin. I would like Finance to validate the assumptions before we commit the full amount.",
    "Our competitors are already in market. Waiting another quarter has a cost too, and I want that cost on the table.",
    "We should write the guardrails now, while the portfolio is small, rather than retrofitting them after an incident.",
]


def _h(*parts: object) -> int:
    return int(hashlib.md5("|".join(map(str, parts)).encode()).hexdigest(), 16)


def _message(model: str, content: list[dict[str, Any]], params: Mapping[str, Any]) -> Message:
    stop = "tool_use" if any(b["type"] == "tool_use" for b in content) else "end_turn"
    return Message.model_validate({
        "id": f"msg_demo_{_h(json.dumps(content))% 10**12}", "type": "message", "role": "assistant", "model": model,
        "content": content, "stop_reason": stop, "stop_sequence": None,
        "usage": {"input_tokens": len(json.dumps(params, default=str)) // 4, "output_tokens": len(json.dumps(content)) // 4,
                  "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0},
    })


def _tool(name: str, data: Mapping[str, Any], key: object) -> dict[str, Any]:
    return {"type": "tool_use", "id": f"toolu_demo_{_h(name, key, json.dumps(data, sort_keys=True)) % 10**12}",
            "name": name, "input": dict(data)}


def _range(name: str, key: object) -> dict[str, float]:
    lowered = name.lower()
    if "usd" in lowered or "revenue" in lowered or "cost" in lowered:
        mode = 20000 + _h(key, name) % 180000
    elif "prob" in lowered:
        mode = 0.01 + (_h(key, name) % 40) / 1000
    elif "uptake" in lowered or "lift" in lowered:
        mode = 0.3 + (_h(key, name) % 40) / 100
    elif "month" in lowered:
        mode = 3 + _h(key, name) % 8
    elif "week" in lowered:
        mode = 20 + _h(key, name) % 70
    else:
        mode = 1 + _h(key, name) % 5
    return {"low": round(mode * 0.6, 4), "mode": round(mode, 4), "high": round(mode * 1.8, 4)}


def _forced(name: str, schema: Mapping[str, Any], key: str) -> dict[str, Any]:
    if name == "record_classification":
        tier = ["low", "medium", "high"][_h(key, "tier") % 3]
        credit = "credit" in key.lower() or "loan" in key.lower()
        return {"use_case_type": "other", "risk_tier": "high" if credit else tier, "delivery": ["vendor_saas", "custom_build"][_h(key) % 2],
                "customer_facing": credit or _h(key, "cf") % 2 == 0, "credit_decision": credit,
                "staff_genai_tool": "assistant" in key.lower(), "model_validation_required_by_policy": "Model Validation" in key,
                "human_review_in_design": True, "vendor_due_diligence_required_by_policy": "Vendor Due Diligence" in key,
                "rationale": "Classified from the proposal and current policy."}
    if name == "record_codes":
        return {"stance": 1 + _h(key, "s") % 5, "objection": {"objection": False, "kind": None}, "suspicion": False,
                "frameworks": [], "outcome_claims": []}
    if name == "issue_exam_results":
        return {"summary": "The review assessed governance, inventory, validation, and vendor oversight for AI.",
                "findings": [{"severity": "mra", "topic": "model validation", "description": "AI systems in use lack independent validation.",
                              "required_action": "Establish independent validation for customer-facing and credit models.",
                              "due_in_months": 6}] if _h(key) % 2 == 0 else [],
                "closed_finding_ids": [], "escalated_finding_ids": []}
    if name == "issue_board_memo":
        return {"subject": "Quarterly review of AI progress", "memo": "The Board reviewed the quarter's AI results and expects a "
                "clear plan for revenue and risk management at the next meeting.", "questions": ["What revenue do you expect next quarter?"],
                "replace_seat": "none", "replacement_reason": ""}
    if name == "write_email":
        return {"sender_name": "Owen Takahara", "sender_title": "Senior Credit Risk Analyst", "subject": "Update for the committee",
                "body": "Committee members,\n\nI wanted to share a short update from my team on how AI is showing up in our day-to-day "
                        "work and a few questions we would like the committee to consider.\n\nOwen Takahara"}
    if name == "write_news":
        return {"outlet": "Regional Banking Week", "headline": "Midwest lenders weigh AI spending against exam scrutiny",
                "body": "Regional banks across the Midwest are increasing technology budgets for AI while supervisors ask sharper "
                        "questions about oversight, according to executives interviewed this month."}
    result: dict[str, Any] = {}
    for prop, spec in schema.get("properties", {}).items():
        if spec.get("type") == "object" and set(spec.get("properties", {})) >= {"low", "mode", "high"}:
            result[prop] = _range(prop, key)
        elif spec.get("type") == "object" and set(spec.get("properties", {})) == {"low", "medium", "high"}:
            result[prop] = {"low": 0.6, "medium": 0.3, "high": 0.1}
        elif "enum" in spec:
            result[prop] = spec["enum"][_h(key, prop) % len(spec["enum"])]
        elif spec.get("type") == "array":
            result[prop] = ["integration with the core platform"]
        elif spec.get("type") in ("number", "integer"):
            result[prop] = 4
        elif spec.get("type") == "boolean":
            result[prop] = False
        else:
            result[prop] = "Estimate based on comparable regional bank programs."
    return result


def _committee(params: Mapping[str, Any]) -> list[dict[str, Any]]:
    messages = params["messages"]
    if isinstance(messages[-1]["content"], list):
        return [{"type": "text", "text": "Done."}]
    instruction = messages[0]["content"]
    system = params.get("system", [{"text": ""}])[0]["text"]
    who = system.split(",")[0]
    key = f"{who}|{instruction[:200]}"
    if "collecting items for the agenda" in instruction:
        roll = _h(key) % 10
        if roll < 3:
            return [_tool("propose_use_case", USE_CASES[_h(key, "uc") % len(USE_CASES)], key)]
        if roll < 6:
            section, text = POLICY_SECTIONS[_h(key, "pe") % len(POLICY_SECTIONS)]
            return [_tool("propose_policy_edit", {"section": section, "text": text,
                                                  "rationale": "We need clear, written requirements before we scale."}, key)]
        return [{"type": "text", "text": "Nothing to add to the agenda this month."}]
    items = re.findall(r"- ((?:UC|PE|SC|ADV|IT)-\d{3}):", instruction)
    if "confidential position" in instruction:
        return [_tool("submit_position", {"item_id": i, "support": 1 + _h(key, i) % 5, "summary": REMARKS[_h(key, i) % len(REMARKS)],
                                          "concerns": ["delivery capacity"], "conditions": ["quarterly reporting"]}, (key, i))
                for i in items] or [{"type": "text", "text": "Done."}]
    if "for discussion only" in instruction:
        return [_tool("submit_perspective", {
            "item_id": i, "stance": 1 + _h(key, i, "p") % 5, "position": REMARKS[_h(key, i) % len(REMARKS)],
            "key_concern": "Ownership is not settled and the inventory is incomplete.",
            "would_change_my_mind": "A written owner for every model and a completed inventory."}, (key, i))
            for i in items] or [{"type": "text", "text": "Done."}]
    if "Voting is open" in instruction:
        return [_tool("cast_vote", {"item_id": i, "vote": "yes" if _h(key, i, "v") % 10 < 7 else "no",
                                    "rationale": "Consistent with my position."}, (key, i)) for i in items] or [{"type": "text", "text": "Done."}]
    if "record the official minutes" in instruction:
        return [_tool("record_minutes", {"summary": "The committee discussed the AI pipeline, capacity, and policy requirements.",
                                         "key_points": ["Capacity is the binding constraint", "Policy guardrails come first"],
                                         "action_items": [{"owner": "Chief Information Officer", "action": "Report delivery capacity",
                                                           "due": "next meeting"}]}, key)]
    if "private working notes" in instruction:
        return [{"type": "text", "text": f"Notes: capacity and risk remain my focus. {REMARKS[_h(key) % len(REMARKS)]}"}]
    if "handover memo" in instruction:
        return [{"type": "text", "text": "Welcome to the committee. Here is where things stand and what I expect from the role."}]
    if "has recognized you" in instruction and _h(key) % 3 == 0:
        return [_tool("pass_turn", {}, key)]
    return [{"type": "text", "text": REMARKS[_h(key, "remark") % len(REMARKS)]}]


COMMITTEE_FORCED = {"cast_vote", "submit_position", "submit_perspective", "record_minutes"}


def _forced_committee(params: Mapping[str, Any], name: str) -> list[dict[str, Any]]:
    instruction = params["messages"][0]["content"]
    items = re.findall(r"- ((?:UC|PE|SC|ADV|IT)-\d{3}):", instruction)
    done = {b["input"].get("item_id") for m in params["messages"] if m["role"] == "assistant" and isinstance(m["content"], list)
            for b in m["content"] if b.get("type") == "tool_use" and b.get("name") == name}
    remaining = [i for i in items if i not in done] or items[:1]
    blocks = [b for b in _committee({**params, "messages": [params["messages"][0]]}) if b.get("name") == name]
    return [b for b in blocks if b["input"].get("item_id") in remaining] or blocks[:1] or \
        [_tool(name, {"summary": "Minutes.", "key_points": [], "action_items": []}, instruction)]


def respond(params: Mapping[str, Any]) -> Message:
    choice = params.get("tool_choice") or {}
    model = params["model"]
    if choice.get("type") == "tool" and choice.get("name") in COMMITTEE_FORCED:
        return _message(model, _forced_committee(params, choice["name"]), params)
    if choice.get("type") == "tool":
        schema = next(t["input_schema"] for t in params["tools"] if t["name"] == choice["name"])
        key = json.dumps(params["messages"], default=str)[:2000]
        return _message(model, [_tool(choice["name"], _forced(choice["name"], schema, key), key)], params)
    if params.get("tools"):
        return _message(model, _committee(params), params)
    return _message(model, [{"type": "text", "text": "Shortened notes: capacity, risk, and open commitments remain my focus."}], params)


@dataclass
class _Batches:
    store: dict[str, list[Mapping[str, Any]]] = field(default_factory=dict)

    def create(self, *, requests: list[Mapping[str, Any]]) -> MessageBatch:
        batch_id = f"msgbatch_demo_{len(self.store)}_{_h(json.dumps(requests, default=str)) % 10**8}"
        self.store[batch_id] = list(requests)
        return self.retrieve(batch_id)

    def retrieve(self, batch_id: str) -> MessageBatch:
        return MessageBatch.model_validate({
            "id": batch_id, "type": "message_batch", "processing_status": "ended",
            "request_counts": {"processing": 0, "succeeded": len(self.store[batch_id]), "errored": 0, "canceled": 0, "expired": 0},
            "created_at": "2026-01-01T00:00:00Z", "expires_at": "2026-01-02T00:00:00Z", "archived_at": None,
            "cancel_initiated_at": None, "ended_at": None, "results_url": None})

    def results(self, batch_id: str) -> list[MessageBatchIndividualResponse]:
        return [MessageBatchIndividualResponse.model_validate({
            "custom_id": r["custom_id"], "result": {"type": "succeeded", "message": respond(r["params"]).model_dump(mode="json")}})
            for r in self.store[batch_id]]


@dataclass
class _Messages:
    batches: _Batches = field(default_factory=_Batches)

    def create(self, **params: Any) -> Message:
        return respond(params)


@dataclass
class DemoAnthropic:
    messages: _Messages = field(default_factory=_Messages)
