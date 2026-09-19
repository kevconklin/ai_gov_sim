"use client";

import { useActionState } from "react";
import { DOCUMENT_KINDS, FRAMEWORKS } from "@/lib/control/schema";
import type { ControlResult } from "@/lib/control/submit";
import { FRAMEWORK_LABELS } from "@/lib/reviews/model";
import { addDocumentAction, createCustomerAction, retireDocumentAction, setBudgetAction, setPanelAction, updateProfileAction } from "./actions";

function Said({ state, ok }: { state: ControlResult | null; ok: string }) {
  if (!state) return null;
  if (state.success) return <p className="rv-said is-ok" role="status">{ok}</p>;
  return <div className="rv-said is-bad" role="alert"><p>{state.error}</p>{state.issues ? <ul className="list-disc pl-5">{state.issues.map((i) => <li key={i}>{i}</li>)}</ul> : null}</div>;
}

/** Every change asks why. The answer goes on the record beside your name. */
function Why() {
  return (
    <label>
      <span className="rv-label">Why are you changing it?</span>
      <input className="rv-field" name="why" required minLength={10} placeholder="Recorded with your name" />
    </label>
  );
}

const FrameworkSelect = ({ name, value }: { name: string; value?: string | null }) => (
  <select className="rv-field" name={name} defaultValue={value ?? "none"}>
    {FRAMEWORKS.map((f) => <option key={f} value={f}>{FRAMEWORK_LABELS[f]}</option>)}
  </select>
);

export function NewCustomerForm() {
  const [state, action, pending] = useActionState(createCustomerAction, null);
  return (
    <form action={action} className="grid gap-3">
      <label><span className="rv-label">Organisation</span><input className="rv-field" name="name" required minLength={2} maxLength={200} placeholder="Harbor Health" /></label>
      <label>
        <span className="rv-label">The board’s direction on AI</span>
        <textarea className="rv-field" name="risk_appetite" rows={3} required minLength={20}
          placeholder="Use AI to cut clinician admin time. Never let it make a clinical decision." />
        <span className="rv-hint block">The committee argues from this, so write it the way the board would say it.</span>
      </label>
      <label><span className="rv-label">Control framework</span><FrameworkSelect name="framework" /></label>
      <details className="rv-fold">
        <summary className="rv-fold-head"><span>More about them <span className="muted font-normal">optional, editable later</span></span></summary>
        <div className="rv-fold-body grid gap-3">
          <label><span className="rv-label">About the organisation</span><textarea className="rv-field" name="facts" rows={2} placeholder="Size, sector, regulators." /></label>
          <label><span className="rv-label">Business goals</span><textarea className="rv-field" name="business_goals" rows={2} /></label>
          <label><span className="rv-label">AI already in use</span><textarea className="rv-field" name="ai_tools" rows={2} /></label>
          <label><span className="rv-label">AI landscape</span><textarea className="rv-field" name="ai_landscape" rows={2} placeholder="What regulators, competitors and vendors are doing." /></label>
        </div>
      </details>
      <div><button className="rv-btn rv-btn-you" type="submit" disabled={pending}>{pending ? "Adding…" : "Add customer"}</button></div>
      <Said state={state} ok="Setting them up with a committee of eight. They will appear in the picker in a moment." />
    </form>
  );
}

export function ProfileFieldForm({ runId, field, value, kind }: { runId: string; field: string; value: string | null; kind: "short" | "long" | "framework" }) {
  const [state, action, pending] = useActionState(updateProfileAction, null);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="run_id" value={runId} />
      <input type="hidden" name="field" value={field} />
      <label>
        <span className="rv-label">New value</span>
        {kind === "framework" ? <FrameworkSelect name="value" value={value} />
          : kind === "short" ? <input className="rv-field" name="value" defaultValue={value ?? ""} />
          : <textarea className="rv-field" name="value" rows={6} defaultValue={value ?? ""} />}
      </label>
      <Why />
      <div><button className="rv-btn rv-btn-you" type="submit" disabled={pending}>{pending ? "Saving…" : "Save change"}</button></div>
      <Said state={state} ok="Saved. It applies from the next review, and the change is on the record." />
    </form>
  );
}

export function AddDocumentForm({ runId }: { runId: string }) {
  const [state, action, pending] = useActionState(addDocumentAction, null);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="run_id" value={runId} />
      <div className="rv-grid2">
        <label><span className="rv-label">Title</span><input className="rv-field" name="title" required minLength={3} placeholder="Acceptable use of AI tools" /></label>
        <label>
          <span className="rv-label">Kind</span>
          <select className="rv-field" name="kind" defaultValue="policy">{DOCUMENT_KINDS.map((k) => <option key={k} value={k}>{k.replace(/_/g, " ")}</option>)}</select>
        </label>
      </div>
      <label>
        <span className="rv-label">Text</span>
        <textarea className="rv-field" name="body" rows={10} required minLength={20} maxLength={60000} placeholder="Paste the document. The committee can read and cite it." />
      </label>
      <label><span className="rv-label">Why are you adding it?</span><input className="rv-field" name="why" required minLength={10} placeholder="Adopted by the board in September" /></label>
      <div><button className="rv-btn rv-btn-you" type="submit" disabled={pending}>{pending ? "Adding…" : "Add document"}</button></div>
      <Said state={state} ok="Added. The committee can read it from the next review." />
    </form>
  );
}

export function RetireDocumentForm({ runId, documentId }: { runId: string; documentId: string }) {
  const [state, action, pending] = useActionState(retireDocumentAction, null);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="run_id" value={runId} />
      <input type="hidden" name="document_id" value={documentId} />
      <label><span className="rv-label">Why is it being retired?</span><input className="rv-field" name="why" required minLength={10} placeholder="Superseded by the 2027 policy" /></label>
      <div><button className="rv-btn" type="submit" disabled={pending}>{pending ? "Retiring…" : "Retire document"}</button></div>
      <p className="rv-hint">It is kept, not deleted, so past reviews can still be read against it.</p>
      <Said state={state} ok="Retired. The committee will no longer see it." />
    </form>
  );
}

export function PanelForm({ runId, kind, seats, chosen }: { runId: string; kind: string; seats: { seat: string; title: string }[]; chosen: string[] | null }) {
  const [state, action, pending] = useActionState(setPanelAction, null);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="run_id" value={runId} />
      <input type="hidden" name="kind" value={kind} />
      <fieldset>
        <legend className="rv-label">Seats that review these</legend>
        <div className="grid gap-1.5">
          {seats.map((s) => (
            <label key={s.seat} className="flex items-center gap-2">
              <input type="checkbox" name="seat" value={s.seat} defaultChecked={chosen ? chosen.includes(s.seat) : false} /><span>{s.title}</span>
            </label>
          ))}
        </div>
        <p className="rv-hint">The chair always sits. Anything high risk seats everyone regardless.</p>
      </fieldset>
      <Why />
      <div><button className="rv-btn rv-btn-you" type="submit" disabled={pending}>{pending ? "Saving…" : "Save panel"}</button></div>
      <Said state={state} ok="Saved. It applies from the next review." />
    </form>
  );
}

export function BudgetForm({ runId, current }: { runId: string; current: number | null }) {
  const [state, action, pending] = useActionState(setBudgetAction, null);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="run_id" value={runId} />
      <label><span className="rv-label">Monthly cap, US dollars</span><input className="rv-field" name="usd" type="number" min={1} step="any" required defaultValue={current ?? undefined} /></label>
      <Why />
      <div><button className="rv-btn rv-btn-you" type="submit" disabled={pending}>{pending ? "Saving…" : "Save budget"}</button></div>
      <Said state={state} ok="Saved. The change is on the record." />
    </form>
  );
}
