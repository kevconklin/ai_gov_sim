"use client";

import { useActionState, useState } from "react";
import { ITEM_KINDS } from "@/lib/control/schema";
import type { ControlResult } from "@/lib/control/submit";
import { submitItemAction } from "./actions";

type Kind = (typeof ITEM_KINDS)[number];

const KIND_CHOICES: Record<Kind, string> = {
  use_case: "A use case for AI",
  tool: "An AI tool staff want to use",
  vendor: "A vendor whose product uses AI",
  policy_change: "A change to our AI policy",
  exception: "An exception to our AI policy",
  incident: "Something that went wrong",
  question: "A question for the committee",
};

const DATA = ["personal data", "financial data", "health data", "employee data", "confidential business data", "public data only"];

type Field =
  | { key: string; label: string; type: "text" | "date" | "long"; placeholder?: string }
  | { key: string; label: string; type: "select"; options: string[] }
  | { key: string; label: string; type: "checks"; options: string[] }
  | { key: string; label: string; type: "tick" };

/** What is worth knowing differs by kind, so the form asks for it by kind. All of it is optional. */
const FIELDS: Record<Kind, Field[]> = {
  use_case: [
    { key: "business_goal", label: "What is it for?", type: "text", placeholder: "Cut call handling time by a fifth" },
    { key: "who_is_affected", label: "Who does it affect?", type: "select", options: ["customers", "employees", "customers and employees", "nobody directly"] },
    { key: "decides_or_advises", label: "Does it decide, or advise a person?", type: "select", options: ["advises a person who decides", "decides automatically"] },
    { key: "data_involved", label: "Data involved", type: "checks", options: DATA },
    { key: "customer_facing", label: "Customers interact with it directly", type: "tick" },
    { key: "human_oversight", label: "Who checks its output, and how?", type: "text" },
  ],
  tool: [
    { key: "tool_and_vendor", label: "Tool and vendor", type: "text", placeholder: "Copilot, from Microsoft" },
    { key: "who_will_use_it", label: "Who will use it?", type: "text", placeholder: "The four developers on the core team" },
    { key: "data_entered", label: "Data people will put into it", type: "checks", options: DATA },
    { key: "terms_reviewed", label: "Someone has read the vendor's terms", type: "tick" },
  ],
  vendor: [
    { key: "vendor", label: "Vendor", type: "text" },
    { key: "product", label: "Product", type: "text" },
    { key: "data_shared", label: "Data we would share", type: "checks", options: DATA },
    { key: "where_data_is_held", label: "Where is the data held?", type: "text", placeholder: "Vendor cloud, US region" },
    { key: "contract_stage", label: "Contract stage", type: "select", options: ["exploring", "in negotiation", "signed", "renewal"] },
    { key: "certifications", label: "Certifications or audits", type: "text", placeholder: "SOC 2 Type II, ISO 27001" },
  ],
  policy_change: [
    { key: "policy_section", label: "Which section?", type: "text" },
    { key: "proposed_wording", label: "Proposed wording", type: "long" },
    { key: "why_now", label: "Why now?", type: "text" },
  ],
  exception: [
    { key: "requirement_excepted", label: "Which requirement?", type: "text" },
    { key: "how_long", label: "For how long?", type: "text", placeholder: "Until 31 March" },
    { key: "compensating_controls", label: "What reduces the risk in the meantime?", type: "long" },
  ],
  incident: [
    { key: "when_it_happened", label: "When did it happen?", type: "date" },
    { key: "who_was_affected", label: "Who was affected?", type: "text", placeholder: "Three members" },
    { key: "contained", label: "It has been contained", type: "tick" },
    { key: "reported_to", label: "Reported to", type: "text", placeholder: "CISO, regulator" },
  ],
  question: [
    { key: "decision_this_informs", label: "What decision does this inform?", type: "text", placeholder: "Staff guidance due in October" },
    { key: "options_considered", label: "Options you are weighing", type: "long" },
  ],
};

const COMMON: Field[] = [
  { key: "accountable_owner", label: "Who is accountable for it?", type: "text", placeholder: "Dana Lee, Head of Member Services" },
  { key: "needed_by", label: "Decision needed by", type: "date" },
  { key: "links", label: "Links or evidence", type: "text", placeholder: "Vendor deck, DPIA, ticket" },
];

function Input({ field }: { field: Field }) {
  const name = `d_${field.key}`;
  if (field.type === "tick") {
    return <label className="flex items-center gap-2"><input type="checkbox" name={name} /><span>{field.label}</span></label>;
  }
  if (field.type === "checks") {
    return (
      <fieldset>
        <legend className="rv-label">{field.label}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {field.options.map((o) => <label key={o} className="flex items-center gap-1.5"><input type="checkbox" name={`${name}[]`} value={o} /><span>{o}</span></label>)}
        </div>
      </fieldset>
    );
  }
  return (
    <label>
      <span className="rv-label">{field.label}</span>
      {field.type === "select" ? (
        <select className="rv-field" name={name} defaultValue=""><option value="">Not sure</option>{field.options.map((o) => <option key={o} value={o}>{o}</option>)}</select>
      ) : field.type === "long" ? (
        <textarea className="rv-field" name={name} rows={3} />
      ) : (
        <input className="rv-field" type={field.type} name={name} placeholder={"placeholder" in field ? field.placeholder : undefined} />
      )}
    </label>
  );
}

export function SubmitMatterForm({ runId, preset }: { runId: string; preset?: string }) {
  const [state, action, pending] = useActionState<ControlResult | null, FormData>(submitItemAction, null);
  const [kind, setKind] = useState<Kind>((ITEM_KINDS as readonly string[]).includes(preset ?? "") ? (preset as Kind) : "use_case");
  const question = kind === "question";
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="run_id" value={runId} />
      <div className="rv-grid2">
        <label>
          <span className="rv-label">What is it?</span>
          <select className="rv-field" name="kind" required value={kind} onChange={(e) => setKind(e.currentTarget.value as Kind)}>
            {ITEM_KINDS.map((k) => <option key={k} value={k}>{KIND_CHOICES[k]}</option>)}
          </select>
        </label>
        {question ? <p className="rv-hint self-end" data-tone="ai">The committee advises on a question. It does not vote.</p> : (
          <label>
            <span className="rv-label">Risk</span>
            <select className="rv-field" name="risk_tier" defaultValue="">
              <option value="">Not sure yet</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
            </select>
          </label>
        )}
      </div>
      <label>
        <span className="rv-label">{question ? "Your question" : "Name"}</span>
        <input className="rv-field" name="title" required minLength={3} maxLength={200}
          placeholder={question ? "May staff use public chat assistants?" : "Lumen transcript analytics"} />
      </label>
      <label>
        <span className="rv-label">{question ? "Background the committee needs" : "What should the committee know?"}</span>
        <textarea className="rv-field" name="description" rows={4} required minLength={10}
          placeholder={question ? "Why you are asking, and what you already know." : "What it does, whose data it touches, who wants it and why."} />
      </label>

      <details className="rv-fold" open>
        <summary className="rv-fold-head"><span>More detail <span className="muted font-normal">helps the committee, all optional</span></span></summary>
        <div className="rv-fold-body grid gap-3" key={kind}>
          {FIELDS[kind].map((f) => <Input key={f.key} field={f} />)}
          {COMMON.map((f) => <Input key={f.key} field={f} />)}
        </div>
      </details>

      <div><button className="rv-btn rv-btn-you" type="submit" disabled={pending}>{pending ? "Submitting…" : question ? "Ask the committee" : "Submit for review"}</button></div>
      {state ? (state.success
        ? <p className="rv-said is-ok" role="status">Submitted. It will show under Waiting in a moment.</p>
        : <div className="rv-said is-bad" role="alert"><p>{state.error}</p>{state.issues ? <ul className="list-disc pl-5">{state.issues.map((i) => <li key={i}>{i}</li>)}</ul> : null}</div>) : null}
    </form>
  );
}
