"use client";

import { useActionState } from "react";
import { DOCUMENT_KINDS, FRAMEWORKS } from "@/lib/control/schema";
import type { ControlResult } from "@/lib/control/submit";
import { FRAMEWORK_LABELS } from "@/lib/reviews/model";
import { addDocumentAction, archiveWorkspaceAction, restoreWorkspaceAction, retireDocumentAction, setBudgetAction, setPanelAction, updateProfileAction } from "./actions";

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

export function ArchiveForm({ runId, name, archived }: { runId: string; name: string; archived: boolean }) {
  const [state, action, pending] = useActionState(archived ? restoreWorkspaceAction : archiveWorkspaceAction, null);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="run_id" value={runId} />
      {archived
        ? <p className="rv-prose">{name} is archived. Restoring it puts it back in the picker and lets reviews, questions, and submissions resume. Nothing was lost while it was away.</p>
        : <p className="rv-prose">Archiving puts {name} away: it leaves the picker, takes no new reviews, questions, or submissions, and keeps every record. It can be restored at any time. Nothing is deleted.</p>}
      <label><span className="rv-label">{archived ? "Why restore it?" : "Why archive it?"}</span><input className="rv-field" name="why" required minLength={10} placeholder={archived ? "The pilot is back on" : "Pilot ended; keeping the record"} /></label>
      <div><button className={`rv-btn ${archived ? "rv-btn-you" : ""}`} type="submit" disabled={pending}>{pending ? (archived ? "Restoring…" : "Archiving…") : archived ? "Restore organization" : "Archive organization"}</button></div>
      <Said state={state} ok={archived ? "Restored. It is back in the picker." : "Archived. It leaves the picker in a moment; find it under Archived to restore."} />
    </form>
  );
}
