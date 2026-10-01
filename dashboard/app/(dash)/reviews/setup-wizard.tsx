"use client";

import { useActionState, useMemo, useState } from "react";
import type { ControlResult } from "@/lib/control/submit";
import { FRAMEWORK_LABELS } from "@/lib/reviews/model";
import {
  BOLDNESS, GOALS, REGIONS, SECTORS, SIZES, cleanTools, plan,
  type Boldness, type Goal, type Region, type Sector, type SetupAnswers, type Size, type Stance, type Starter,
} from "@/lib/setup/plan";
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

const STEPS = ["About you", "Your goals", "AI today", "Your setup"] as const;
const FRAMEWORK_CHOICES = ["nist_ai_rmf", "iso_42001", "eu_ai_act", "sr_11_7"] as const;
const STANCE_TONE: Record<Stance, string> = { cautious: "wait", balanced: "you", ambitious: "ai" };

function Said({ state, ok }: { state: ControlResult | null; ok: string }) {
  if (!state) return null;
  if (state.success) return <p className="rv-said is-ok" role="status">{ok}</p>;
  return <div className="rv-said is-bad" role="alert"><p>{state.error}</p>{state.issues ? <ul className="list-disc pl-5">{state.issues.map((i) => <li key={i}>{i}</li>)}</ul> : null}</div>;
}

function Choices<T extends string>({ name, value, onChange, options, tone, columns }: {
  name: string; value: T; onChange: (v: T) => void; options: [T, string][]; tone?: (v: T) => string; columns?: number;
}) {
  return (
    <div className="rv-choices" role="radiogroup" style={columns ? { gridTemplateColumns: `repeat(${columns}, 1fr)` } : undefined}>
      {options.map(([v, label]) => (
        <label key={v} className="rv-choice" data-tone={tone ? tone(v) : "you"}>
          <input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange(v)} />{label}
        </label>
      ))}
    </div>
  );
}

function Ticks<T extends string>({ name, values, onChange, options, max }: { name: string; values: T[]; onChange: (v: T[]) => void; options: [T, string][]; max?: number }) {
  return (
    <div className="rv-ticks">
      {options.map(([v, label]) => {
        const on = values.includes(v);
        const full = Boolean(max) && !on && values.length >= (max ?? 0);
        return (
          <label key={v} className={`rv-tick${on ? " is-on" : ""}${full ? " is-off" : ""}`}>
            <input type="checkbox" name={name} value={v} checked={on} disabled={full}
              onChange={(e) => onChange(e.currentTarget.checked ? [...values, v] : values.filter((x) => x !== v))} />
            <span>{label}</span>
          </label>
        );
      })}
    </div>
  );
}

/**
 * Setting up an organization that has never had AI governance: plain questions about who they are, what they
 * want, and what AI is already in use, and from the answers a setup they can read, change, and create.
 */
export function SetupWizard({ kits }: { kits: KitView[] }) {
  const [state, action, pending] = useActionState(createCustomerAction, null);
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [sector, setSector] = useState<Sector>("professional");
  const [size, setSize] = useState<Size>("50_250");
  const [regions, setRegions] = useState<Region[]>(["us"]);
  const [regulated, setRegulated] = useState<"yes" | "no" | "unsure">("no");
  const [shipsAi, setShipsAi] = useState(false);
  const [customers, setCustomers] = useState("");
  const [goals, setGoals] = useState<Goal[]>([]);
  const [boldness, setBoldness] = useState<Boldness>("steady");
  const [decides, setDecides] = useState(false);
  const [toolsText, setToolsText] = useState("");

  const answers: SetupAnswers = useMemo(() => ({
    name, sector, size, regions, regulated, ships_ai: shipsAi, goals, boldness, decides_about_people: decides, tools: cleanTools(toolsText), customers,
  }), [name, sector, size, regions, regulated, shipsAi, goals, boldness, decides, toolsText, customers]);
  const suggested = useMemo(() => plan(answers), [answers]);

  // what the person changed on the last step, on top of the suggestion; null means "as suggested"
  const [starterPick, setStarterPick] = useState<Starter | "blank" | null>(null);
  const [frameworkPick, setFrameworkPick] = useState<string | null>(null);
  const [stancePick, setStancePick] = useState<Stance | null>(null);
  const [appetiteEdit, setAppetiteEdit] = useState<string | null>(null);

  const starter = starterPick ?? suggested.starter;
  const kit = starter === "blank" ? null : (kits.find((k) => k.id === starter) ?? null);
  const framework = frameworkPick ?? suggested.framework;
  const stance = stancePick ?? suggested.stance;
  const appetite = appetiteEdit ?? (kit?.stances[stance]?.text ?? BOLDNESS[boldness].text);
  const orgName = name.trim() || "your organization";
  const reasonFor = (field: "starter" | "framework" | "stance") => suggested.reasons.find((r) => r.field === field)?.because ?? "";

  return (
    <form action={action} className="grid gap-4">
      <ol className="rv-steps" aria-label="Setup steps">
        {STEPS.map((label, i) => (
          <li key={label} className="rv-step" aria-current={i === step ? "step" : undefined} data-done={i < step ? "true" : undefined}>
            <span className="rv-step-n">{i + 1}</span><span>{label}</span>
          </li>
        ))}
      </ol>

      {/* what gets created, whatever step is showing */}
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="facts" value={suggested.facts} />
      <input type="hidden" name="business_goals" value={suggested.business_goals} />
      <input type="hidden" name="ai_tools" value={suggested.ai_tools} />
      <input type="hidden" name="framework" value={framework} />
      <input type="hidden" name="risk_appetite" value={appetite} />
      {kit ? <input type="hidden" name="starter" value={kit.id} /> : null}
      <input type="hidden" name="first_matters" value={JSON.stringify(suggested.first_matters)} />
      <input type="hidden" name="answers" value={JSON.stringify({ sector, size, regions, regulated, ships_ai: shipsAi, goals, boldness, decides_about_people: decides, tools: answers.tools, customers })} />

      {step === 0 ? (
        <div className="grid gap-4">
          <label>
            <span className="rv-label">What is the organization called?</span>
            <input className="rv-field" value={name} onChange={(e) => setName(e.currentTarget.value)} maxLength={200} placeholder="Harbor Health" autoFocus />
          </label>
          <label>
            <span className="rv-label">What does it do?</span>
            <select className="rv-field" value={sector} onChange={(e) => setSector(e.currentTarget.value as Sector)}>
              {(Object.entries(SECTORS) as [Sector, string][]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <fieldset>
            <legend className="rv-label">How many people work there?</legend>
            <Choices name="size" value={size} onChange={setSize} options={Object.entries(SIZES) as [Size, string][]} columns={4} />
          </fieldset>
          <fieldset>
            <legend className="rv-label">Where do you operate or sell?</legend>
            <Ticks name="regions" values={regions} onChange={setRegions} options={Object.entries(REGIONS) as [Region, string][]} />
          </fieldset>
          <fieldset>
            <legend className="rv-label">Does a regulator or examiner review how you handle data?</legend>
            <Choices name="regulated" value={regulated} onChange={setRegulated} options={[["yes", "Yes"], ["no", "No"], ["unsure", "Not sure"]]} />
          </fieldset>
          <label className="rv-tick is-wide"><input type="checkbox" checked={shipsAi} onChange={(e) => setShipsAi(e.currentTarget.checked)} /><span>We sell software with AI features in it</span></label>
          <label>
            <span className="rv-label">Who are your customers? <span className="muted font-normal">optional</span></span>
            <input className="rv-field" value={customers} onChange={(e) => setCustomers(e.currentTarget.value)} maxLength={300} placeholder="Small businesses in the Midwest" />
          </label>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="grid gap-4">
          <fieldset>
            <legend className="rv-label">What do you want from AI? <span className="muted font-normal">pick up to three</span></legend>
            <Ticks name="goals" values={goals} onChange={setGoals} options={Object.entries(GOALS) as [Goal, string][]} max={3} />
          </fieldset>
          <fieldset>
            <legend className="rv-label">Which sounds most like your leadership?</legend>
            <div className="rv-choices is-stack" role="radiogroup">
              {(Object.entries(BOLDNESS) as [Boldness, { label: string; text: string }][]).map(([v, b]) => (
                <label key={v} className="rv-choice is-card" data-tone={v === "careful" ? "wait" : v === "fast" ? "ai" : "you"}>
                  <input type="radio" name="boldness" value={v} checked={boldness === v} onChange={() => setBoldness(v)} />
                  <span className="rv-choice-title">{b.label}</span>
                  <span className="rv-choice-text">{b.text}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="rv-label">Does AI already help decide things about people here? <span className="muted font-normal">hiring, credit, care, claims, pricing</span></legend>
            <Choices name="decides" value={decides ? "yes" : "no"} onChange={(v) => setDecides(v === "yes")} options={[["no", "No, or not that we know of"], ["yes", "Yes"]]} columns={2} />
          </fieldset>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="grid gap-4">
          <label>
            <span className="rv-label">Which AI tools do people already use? <span className="muted font-normal">one per line, as best you know</span></span>
            <textarea className="rv-field" rows={6} value={toolsText} onChange={(e) => setToolsText(e.currentTarget.value)} maxLength={4000}
              placeholder={"ChatGPT\nMicrosoft Copilot\nOtter.ai in meetings\nThe AI summaries in our CRM"} />
            <span className="rv-hint block">Each one becomes a matter for the committee: may it stay in use, for what, and on what conditions. Nothing is switched off.</span>
          </label>
          {answers.tools.length ? <p className="rv-hint">{answers.tools.length === 1 ? "1 tool" : `${answers.tools.length} tools`} will be waiting for the committee: {answers.tools.join(", ")}.</p> : <p className="rv-hint">Leave it empty if you do not know yet. You can add tools any time.</p>}
        </div>
      ) : null}

      {step === 3 ? (
        <div className="grid gap-4">
          <p className="rv-hint" style={{ marginTop: 0 }}>From your answers. Each line says why; change anything that is wrong.</p>

          <section className="rv-card">
            <div className="rv-card-h"><span>Starting point</span>{starterPick && starterPick !== suggested.starter ? <span className="rv-chip" data-tone="you">Changed</span> : null}</div>
            <select className="rv-field" value={starter} onChange={(e) => { setStarterPick(e.currentTarget.value as Starter | "blank"); setAppetiteEdit(null); }}>
              {kits.map((k) => <option key={k.id} value={k.id}>{k.label}: {k.control_count} controls</option>)}
              <option value="blank">Blank: no policy or documents</option>
            </select>
            <p className="rv-hint">{reasonFor("starter")}</p>
          </section>

          <section className="rv-card">
            <div className="rv-card-h"><span>Framework</span>{frameworkPick && frameworkPick !== suggested.framework ? <span className="rv-chip" data-tone="you">Changed</span> : null}</div>
            <select className="rv-field" value={framework} onChange={(e) => setFrameworkPick(e.currentTarget.value)}>
              {FRAMEWORK_CHOICES.map((f) => <option key={f} value={f}>{FRAMEWORK_LABELS[f]}</option>)}
            </select>
            <p className="rv-hint">{reasonFor("framework")}{kit ? " Every control in the policy is tagged with this framework’s clause." : ""}</p>
          </section>

          <section className="rv-card">
            <div className="rv-card-h"><span>How careful the committee is</span>{stancePick && stancePick !== suggested.stance ? <span className="rv-chip" data-tone="you">Changed</span> : null}</div>
            <Choices name="stance" value={stance} onChange={(v) => { setStancePick(v); setAppetiteEdit(null); }} tone={(v) => STANCE_TONE[v]}
              options={[["cautious", kit?.stances.cautious?.label ?? "Cautious"], ["balanced", kit?.stances.balanced?.label ?? "Balanced"], ["ambitious", kit?.stances.ambitious?.label ?? "Ambitious"]]} />
            <p className="rv-hint">{reasonFor("stance")}</p>
            <label className="block" style={{ marginTop: "0.6rem" }}>
              <span className="rv-label">The board’s direction on AI, as the committee will read it</span>
              <textarea className="rv-field" rows={4} value={appetite} onChange={(e) => setAppetiteEdit(e.currentTarget.value)} minLength={20} maxLength={4000} />
              <span className="rv-hint block">The committee argues from this. Edit it into your board’s words.</span>
            </label>
          </section>

          <section className="rv-card">
            <div className="rv-card-h">What the committee will be told about {orgName}</div>
            <p className="rv-prose">{suggested.facts}</p>
            <p className="rv-prose" style={{ marginTop: "0.5rem" }}><strong>Goals:</strong> {suggested.business_goals}</p>
            <p className="rv-hint">Written from your answers. Both can be edited later under Settings.</p>
          </section>

          <section className="rv-card" data-tone="you">
            <div className="rv-card-h">What happens when you create it</div>
            <ul className="rv-list">
              <li><strong>A committee of eight AI advisers</strong>, each with a brief you can rewrite.</li>
              {kit ? <li><strong>A policy of {kit.control_count} controls</strong> mapped to {FRAMEWORK_LABELS[framework] ?? framework}, a committee charter, and an acceptable-use document, all in {orgName}’s name.</li> : <li><strong>No policy yet.</strong> The committee starts from the board’s direction alone.</li>}
              {kit ? <li><strong>One matter waiting</strong>: “Does the starter AI policy fit {orgName}?”</li> : null}
              {suggested.first_matters.length ? <li><strong>{suggested.first_matters.length === 1 ? "1 tool" : `${suggested.first_matters.length} tools`} waiting</strong> for the committee to look at: {answers.tools.join(", ")}.</li> : null}
              <li><strong>Your answers on the record</strong>, so anyone can see later why the setup is what it is.</li>
            </ul>
            {kit ? <p className="rv-hint">The starter policy is a starting point, not legal advice. It says so in its own first paragraph.</p> : null}
          </section>
        </div>
      ) : null}

      <div className="rv-wizard-nav">
        {step > 0 ? <button type="button" className="rv-btn rv-btn-sm" onClick={() => setStep(step - 1)}>Back</button> : <span />}
        {step < 3 ? <button type="button" className="rv-btn rv-btn-you" disabled={step === 0 && name.trim().length < 2} onClick={() => setStep(step + 1)}>Next</button>
          : <button type="submit" className="rv-btn rv-btn-you" disabled={pending || appetite.trim().length < 20}>{pending ? "Creating…" : `Create ${orgName === "your organization" ? "committee" : orgName}`}</button>}
      </div>
      <Said state={state} ok="Setting them up. They appear in the picker in a moment, with their first matters waiting." />
    </form>
  );
}
