"use client";

import { useActionState, useState } from "react";
import { FRAMEWORKS } from "@/lib/control/schema";
import type { ControlResult } from "@/lib/control/submit";
import { FRAMEWORK_LABELS } from "@/lib/reviews/model";
import { createCustomerAction } from "./actions";

export interface StanceView { label: string; text: string }
export interface KitView {
  id: string;
  label: string;
  summary: string;
  audience: string;
  framework: string;
  stances: Record<string, StanceView>;
  facts_template: string;
  business_goals: string;
  control_count: number;
  document_count: number;
}

const STANCES = ["cautious", "balanced", "ambitious"] as const;
const STEPS = ["Who you are", "How careful", "Create"] as const;
const BLANK = "";

function Said({ state, ok }: { state: ControlResult | null; ok: string }) {
  if (!state) return null;
  if (state.success) return <p className="rv-said is-ok" role="status">{ok}</p>;
  return <div className="rv-said is-bad" role="alert"><p>{state.error}</p>{state.issues ? <ul className="list-disc pl-5">{state.issues.map((i) => <li key={i}>{i}</li>)}</ul> : null}</div>;
}

/**
 * Three short steps from nothing to a committee with a policy, two documents, and its first matter waiting.
 * A kit fills in what a new organization has no time to write; the person can change any of it, now or later.
 */
export function SetupWizard({ kits }: { kits: KitView[] }) {
  const [state, action, pending] = useActionState(createCustomerAction, null);
  const [step, setStep] = useState(0);
  const [kitId, setKitId] = useState(kits[0]?.id ?? BLANK);
  const [name, setName] = useState("");
  const [facts, setFacts] = useState("");
  const [framework, setFramework] = useState(kits[0]?.framework ?? "none");
  const [frameworkTouched, setFrameworkTouched] = useState(false);
  const [stance, setStance] = useState<string>("balanced");
  const [appetite, setAppetite] = useState(kits[0]?.stances.balanced?.text ?? "");

  const kit = kits.find((k) => k.id === kitId) ?? null;
  const orgName = name.trim() || "your organization";

  function pickKit(id: string) {
    const next = kits.find((k) => k.id === id) ?? null;
    setKitId(id);
    if (!frameworkTouched || (next && framework === "none")) setFramework(next?.framework ?? "none");
    if (next) setAppetite(next.stances[stance]?.text ?? "");
  }
  function pickStance(s: string) {
    setStance(s);
    if (kit) setAppetite(kit.stances[s]?.text ?? "");
  }

  const canLeaveStep0 = name.trim().length >= 2;
  const canLeaveStep1 = appetite.trim().length >= 20;

  return (
    <form action={action} className="grid gap-4">
      <ol className="rv-steps" aria-label="Setup steps">
        {STEPS.map((label, i) => (
          <li key={label} className="rv-step" aria-current={i === step ? "step" : undefined} data-done={i < step ? "true" : undefined}>
            <span className="rv-step-n">{i + 1}</span><span>{label}</span>
          </li>
        ))}
      </ol>

      {/* what gets submitted, whatever step is showing */}
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="facts" value={facts} />
      <input type="hidden" name="framework" value={framework} />
      <input type="hidden" name="risk_appetite" value={appetite} />
      {kit ? <input type="hidden" name="starter" value={kit.id} /> : null}

      {step === 0 ? (
        <div className="grid gap-4">
          <fieldset>
            <legend className="rv-label">Start from</legend>
            <div className="rv-choices is-stack" role="radiogroup">
              {kits.map((k) => (
                <label key={k.id} className="rv-choice is-card" data-tone="you">
                  <input type="radio" name="kit" value={k.id} checked={kitId === k.id} onChange={() => pickKit(k.id)} />
                  <span className="rv-choice-title">{k.label}<span className="rv-chip is-plain">{k.control_count} controls</span></span>
                  <span className="rv-choice-text">{k.summary}</span>
                </label>
              ))}
              <label className="rv-choice is-card">
                <input type="radio" name="kit" value={BLANK} checked={kitId === BLANK} onChange={() => pickKit(BLANK)} />
                <span className="rv-choice-title">Blank</span>
                <span className="rv-choice-text">No policy or documents. The committee starts from the board’s direction alone.</span>
              </label>
            </div>
            {kit ? <p className="rv-hint">{kit.audience}</p> : null}
          </fieldset>
          <label>
            <span className="rv-label">Organization</span>
            <input className="rv-field" value={name} onChange={(e) => setName(e.currentTarget.value)} minLength={2} maxLength={200} placeholder="Harbor Health" autoFocus />
          </label>
          <label>
            <span className="rv-label">About you <span className="muted font-normal">optional</span></span>
            <textarea className="rv-field" rows={3} value={facts} onChange={(e) => setFacts(e.currentTarget.value)} maxLength={4000}
              placeholder={kit?.facts_template || "Size, sector, where you operate, who your customers are."} />
            <span className="rv-hint block">The committee reads this before every review. You can add to it later.</span>
          </label>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="grid gap-4">
          <label>
            <span className="rv-label">Control framework</span>
            <select className="rv-field" value={framework} onChange={(e) => { setFramework(e.currentTarget.value); setFrameworkTouched(true); }}>
              {FRAMEWORKS.filter((f) => !kit || f !== "none").map((f) => <option key={f} value={f}>{FRAMEWORK_LABELS[f]}</option>)}
            </select>
            {kit ? <span className="rv-hint block">Each control in the starter policy is tagged with this framework’s clause.</span> : null}
          </label>
          {kit ? (
            <fieldset>
              <legend className="rv-label">How careful should the committee be?</legend>
              <div className="rv-choices" role="radiogroup">
                {STANCES.map((s) => (
                  <label key={s} className="rv-choice" data-tone={s === "cautious" ? "wait" : s === "ambitious" ? "ai" : "you"}>
                    <input type="radio" name="stance" value={s} checked={stance === s} onChange={() => pickStance(s)} />
                    {kit.stances[s]?.label ?? s}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          <label>
            <span className="rv-label">The board’s direction on AI</span>
            <textarea className="rv-field" rows={5} value={appetite} onChange={(e) => setAppetite(e.currentTarget.value)} minLength={20} maxLength={4000}
              placeholder="Use AI to cut clinician admin time. Never let it make a clinical decision." />
            <span className="rv-hint block">The committee argues from this, so make it say what your board would say. {kit ? "Picking a stance rewrites it; edit freely after." : ""}</span>
          </label>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="grid gap-4">
          <section className="rv-card">
            <div className="rv-card-h">What {orgName} gets</div>
            <ul className="rv-list">
              <li><strong>A committee of eight AI advisers</strong>, each with a brief you can rewrite.</li>
              {kit ? <li><strong>A policy of {kit.control_count} controls</strong>, mapped to {FRAMEWORK_LABELS[framework] ?? framework}.</li> : null}
              {kit ? <li><strong>A committee charter and an acceptable-use document</strong>, both in {orgName}’s name.</li> : null}
              {kit ? <li><strong>One matter already waiting</strong>: “Does the starter AI policy fit {orgName}?” Convene it, read the recommendation, and sign your first decision.</li>
                : <li><strong>An empty queue.</strong> Submit the first matter yourself.</li>}
            </ul>
            {kit ? <p className="rv-hint">The starter policy is a starting point, not legal advice. It says so in its own first paragraph.</p> : null}
          </section>
          <p className="rv-hint">Everything above is recorded as a change under your name, so it reads like any other configuration later.</p>
        </div>
      ) : null}

      <div className="rv-wizard-nav">
        {step > 0 ? <button type="button" className="rv-btn rv-btn-sm" onClick={() => setStep(step - 1)}>Back</button> : <span />}
        {step === 0 ? <button type="button" className="rv-btn rv-btn-you" disabled={!canLeaveStep0} onClick={() => setStep(1)}>Next</button> : null}
        {step === 1 ? <button type="button" className="rv-btn rv-btn-you" disabled={!canLeaveStep1} onClick={() => setStep(2)}>Next</button> : null}
        {step === 2 ? <button type="submit" className="rv-btn rv-btn-you" disabled={pending}>{pending ? "Creating…" : `Create ${orgName === "your organization" ? "committee" : orgName}`}</button> : null}
      </div>
      <Said state={state} ok={kit ? "Setting them up: committee, policy, documents, and the first matter. They appear in the picker in a moment." : "Setting them up with a committee of eight. They appear in the picker in a moment."} />
    </form>
  );
}
