"use client";

import { useActionState, useMemo, useState } from "react";
import type { ControlResult } from "@/lib/control/submit";
import {
  DATA_CLASSES, DECIDES, NEEDS, SOURCES, WHO, triage,
  type DataClass, type Decides, type Kind, type Need, type Source, type TriageAnswers, type Who,
} from "@/lib/intake/triage";
import { KIND_LABELS } from "@/lib/reviews/model";
import { submitItemAction } from "./actions";

const TIER_WORDS: Record<string, string> = { high: "High risk", medium: "Medium risk", low: "Low risk" };
const KINDS: Kind[] = ["use_case", "tool", "vendor", "policy_change", "exception", "incident", "question"];
// a preset from a link ("submit:tool", "submit:question") lands on the matching first question
const PRESET_NEED: Record<string, Need> = { tool: "use_tool", vendor: "use_tool", use_case: "project", incident: "problem", question: "question", policy_change: "policy", exception: "policy" };

function Choices<T extends string>({ name, value, onChange, options, columns, stack }: {
  name: string; value: T; onChange: (v: T) => void; options: [T, string, string?][]; columns?: number; stack?: boolean;
}) {
  return (
    <div className={`rv-choices${stack ? " is-stack" : ""}`} role="radiogroup" style={columns ? { gridTemplateColumns: `repeat(${columns}, 1fr)` } : undefined}>
      {options.map(([v, label, hint]) => (
        <label key={v} className={`rv-choice${hint ? " is-card" : ""}`} data-tone="you">
          <input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange(v)} />
          {hint ? <><span className="rv-choice-title">{label}</span><span className="rv-choice-text">{hint}</span></> : label}
        </label>
      ))}
    </div>
  );
}

/**
 * Submitting a matter in plain questions. The kind and the risk tier are worked out from the answers and
 * shown back with the reasons; anyone who knows the vocabulary can still set them by hand.
 */
export interface PrecedentOption {
  id: string;            // the short id, such as IT-001
  title: string;
  outcome: string;
  actor: string;
  when: string;
}

export function SubmitMatterForm({ runId, preset, precedents = [] }: { runId: string; preset?: string; precedents?: PrecedentOption[] }) {
  const [state, action, pending] = useActionState<ControlResult | null, FormData>(submitItemAction, null);
  const [need, setNeed] = useState<Need>(PRESET_NEED[preset ?? ""] ?? "use_tool");
  const [who, setWho] = useState<Who>("staff");
  const [data, setData] = useState<DataClass[]>([]);
  const [decides, setDecides] = useState<Decides>("no");
  const [source, setSource] = useState<Source>("bought");
  const [connected, setConnected] = useState(false);
  const [policyKind, setPolicyKind] = useState<"change" | "exception">(preset === "exception" ? "exception" : "change");
  const [kindOverride, setKindOverride] = useState<Kind | null>(null);
  const [cited, setCited] = useState<string[]>([]);
  const [tierOverride, setTierOverride] = useState<string | null>(null);

  const answers: TriageAnswers = useMemo(() => ({ need, who, data: data.length ? data : ["none"], decides, source, connected, policy_kind: policyKind }),
    [need, who, data, decides, source, connected, policyKind]);
  const filed = useMemo(() => triage(answers), [answers]);
  const kind = kindOverride ?? filed.kind;
  const tier = tierOverride ?? filed.risk_tier ?? "";
  const question = kind === "question";
  const aboutAThing = need === "use_tool" || need === "project";

  function toggleData(d: DataClass, on: boolean) {
    setData((before) => (on ? [...before.filter((x) => x !== d), d] : before.filter((x) => x !== d)));
  }

  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="run_id" value={runId} />
      <input type="hidden" name="kind" value={kind} />
      {!question && tier ? <input type="hidden" name="risk_tier" value={tier} /> : null}
      {Object.entries(filed.details).map(([k, v]) =>
        Array.isArray(v) ? v.map((x) => <input key={`${k}-${x}`} type="hidden" name={`d_${k}[]`} value={x} />)
          : <input key={k} type="hidden" name={`d_${k}`} value={v === true ? "on" : String(v)} />)}
      <input type="hidden" name="d_filed_because" value={filed.why.join(" ")} />

      <fieldset>
        <legend className="rv-label">What do you need?</legend>
        <Choices name="need" value={need} onChange={(v) => { setNeed(v); setKindOverride(null); setTierOverride(null); }} stack
          options={(Object.entries(NEEDS) as [Need, { label: string; hint: string }][]).map(([v, n]) => [v, n.label, n.hint])} />
      </fieldset>

      {need === "policy" ? (
        <fieldset>
          <legend className="rv-label">Which is it?</legend>
          <Choices name="policy_kind" value={policyKind} onChange={(v) => { setPolicyKind(v); setKindOverride(null); }} columns={2}
            options={[["change", "Change the rule for everyone"], ["exception", "An exception for us, for a while"]]} />
        </fieldset>
      ) : null}

      <label>
        <span className="rv-label">{question ? "Your question" : need === "problem" ? "What happened, in a line" : need === "policy" ? "Which rule, in a line" : "What is it called?"}</span>
        <input className="rv-field" name="title" required minLength={3} maxLength={200}
          placeholder={question ? "May staff use public chat assistants?" : need === "problem" ? "Copilot summarized a client email to the wrong client" : need === "policy" ? "AI-GOV-010, data entered into AI tools" : "Otter.ai for meeting notes"} />
      </label>
      <label>
        <span className="rv-label">{question ? "Why you are asking, and what you already know" : "Tell the committee about it in your own words"}</span>
        <textarea className="rv-field" name="description" rows={4} required minLength={10}
          placeholder={question ? "What decision this informs, and the options you are weighing." : need === "problem" ? "When, who was affected, what has been done so far." : need === "policy" ? "What should change and why now, or what you need excepted and for how long." : "What it does, who wants it and why, and how you would use it."} />
      </label>

      {aboutAThing ? (
        <div className="grid gap-4">
          <fieldset>
            <legend className="rv-label">Where does it come from?</legend>
            <Choices name="source" value={source} onChange={(v) => { setSource(v); setKindOverride(null); }} columns={3}
              options={(Object.entries(SOURCES) as [Source, string][])} />
          </fieldset>
          <fieldset>
            <legend className="rv-label">Who would use it or be affected by it?</legend>
            <Choices name="who" value={who} onChange={(v) => { setWho(v); setKindOverride(null); setTierOverride(null); }} columns={3}
              options={(Object.entries(WHO) as [Who, string][])} />
          </fieldset>
        </div>
      ) : null}

      {need !== "question" && need !== "policy" ? (
        <fieldset>
          <legend className="rv-label">{need === "problem" ? "What information was involved?" : "What information would it see?"} <span className="muted font-normal">tick all that apply</span></legend>
          <div className="rv-ticks">
            {(Object.entries(DATA_CLASSES) as [DataClass, string][]).filter(([v]) => v !== "none").map(([v, label]) => (
              <label key={v} className={`rv-tick${data.includes(v) ? " is-on" : ""}`}>
                <input type="checkbox" checked={data.includes(v)} onChange={(e) => { toggleData(v, e.currentTarget.checked); setTierOverride(null); }} /><span>{label}</span>
              </label>
            ))}
          </div>
          {!data.length ? <p className="rv-hint">Nothing ticked means nothing sensitive, or public information only.</p> : null}
        </fieldset>
      ) : null}

      {need !== "question" && need !== "policy" ? (
        <fieldset>
          <legend className="rv-label">{need === "problem" ? "Was it part of a decision about a person?" : "Does it help decide anything about a person?"} <span className="muted font-normal">hiring, credit, care, claims, pricing, access</span></legend>
          <Choices name="decides" value={decides} onChange={(v) => { setDecides(v); setTierOverride(null); }} columns={3}
            options={(Object.entries(DECIDES) as [Decides, string][])} />
        </fieldset>
      ) : null}

      {aboutAThing && source !== "built" ? (
        <label className="rv-tick is-wide"><input type="checkbox" checked={connected} onChange={(e) => { setConnected(e.currentTarget.checked); setKindOverride(null); }} /><span>It connects to our systems, or our data flows into it on its own</span></label>
      ) : null}

      {aboutAThing ? (
        <div className="rv-grid2">
          <label>
            <span className="rv-label">Who is accountable for it?{need === "project" ? "" : <span className="muted font-normal"> optional</span>}</span>
            <input className="rv-field" name="d_accountable_owner" required={need === "project"} maxLength={200} placeholder="Priya Nair, Nursing Director" />
            <span className="rv-hint block">Named on the record. If it is approved, they own it through its life.</span>
          </label>
          {need === "project" ? (
            <label>
              <span className="rv-label">What would success look like?</span>
              <input className="rv-field" name="d_business_goal" maxLength={300} placeholder="Discharge summaries out the same day" />
            </label>
          ) : null}
        </div>
      ) : null}

      <div className="rv-filed" aria-live="polite">
        <div className="rv-filed-h">
          <span>Filed as</span>
          <span className="rv-chip is-plain">{KIND_LABELS[kind] ?? kind}</span>
          {question ? <span className="rv-chip" data-tone="ai">The committee advises, it does not vote</span>
            : tier ? <span className="rv-chip has-dot" data-tone={tier}>{TIER_WORDS[tier]}</span> : <span className="rv-chip is-plain">Not rated</span>}
          {kindOverride || tierOverride ? <span className="rv-chip" data-tone="you">Set by you</span> : null}
        </div>
        <ul>{filed.why.map((w) => <li key={w}>{w}</li>)}</ul>
        <details className="rv-fold" style={{ marginTop: "0.3rem" }}>
          <summary className="rv-fold-head"><span>Not right? Set it yourself</span></summary>
          <div className="rv-fold-body rv-grid2">
            <label>
              <span className="rv-label">Kind</span>
              <select className="rv-field" value={kind} onChange={(e) => setKindOverride(e.currentTarget.value as Kind)}>
                {KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k] ?? k}</option>)}
              </select>
            </label>
            {!question ? (
              <label>
                <span className="rv-label">Risk</span>
                <select className="rv-field" value={tier} onChange={(e) => setTierOverride(e.currentTarget.value)}>
                  <option value="">Not rated</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
                </select>
              </label>
            ) : null}
          </div>
        </details>
      </div>

      {precedents.length ? (
        <fieldset>
          <legend className="rv-label">Related to an earlier decision? <span className="muted font-normal">the committee reads it as precedent</span></legend>
          <div className="rv-ticks">
            {precedents.map((p) => (
              <label key={p.id} className={`rv-tick${cited.includes(p.id) ? " is-on" : ""}`} title={`${p.outcome} by ${p.actor}, ${p.when}`}>
                <input type="checkbox" name="d_related_decisions[]" value={p.id} checked={cited.includes(p.id)}
                  onChange={(e) => setCited(e.currentTarget.checked ? [...cited, p.id] : cited.filter((x) => x !== p.id))} />
                <span><span className="rv-chip is-plain" style={{ marginRight: "0.35rem" }}>{p.id}</span>{p.title}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <details className="rv-fold">
        <summary className="rv-fold-head"><span>Anything else <span className="muted font-normal">optional</span></span></summary>
        <div className="rv-fold-body grid gap-3">
          <label><span className="rv-label">Decision needed by</span><input className="rv-field" type="date" name="d_needed_by" /></label>
          <label><span className="rv-label">Links or evidence</span><input className="rv-field" name="d_links" placeholder="Vendor page, contract, ticket" /></label>
        </div>
      </details>

      <div><button className="rv-btn rv-btn-you" type="submit" disabled={pending}>{pending ? "Submitting…" : question ? "Ask the committee" : "Submit for review"}</button></div>
      {state ? (state.success
        ? <p className="rv-said is-ok" role="status">Submitted. It will show under Waiting in a moment.</p>
        : <div className="rv-said is-bad" role="alert"><p>{state.error}</p>{state.issues ? <ul className="list-disc pl-5">{state.issues.map((i) => <li key={i}>{i}</li>)}</ul> : null}</div>) : null}
    </form>
  );
}
