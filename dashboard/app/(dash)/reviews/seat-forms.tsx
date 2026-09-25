"use client";

import { useActionState } from "react";
import type { ControlResult } from "@/lib/control/submit";
import type { ModelRow, SeatRow } from "@/lib/queries/governance";
import { STANCE_WORDS } from "@/lib/reviews/model";
import { addSeatAction, removeSeatAction, updateSeatAction } from "./actions";

function Said({ state, ok }: { state: ControlResult | null; ok: string }) {
  if (!state) return null;
  if (state.success) return <p className="rv-said is-ok" role="status">{ok}</p>;
  return <div className="rv-said is-bad" role="alert"><p>{state.error}</p>{state.issues ? <ul className="list-disc pl-5">{state.issues.map((i) => <li key={i}>{i}</li>)}</ul> : null}</div>;
}

const Why = ({ label = "Why are you changing it?" }: { label?: string }) => (
  <label><span className="rv-label">{label}</span><input className="rv-field" name="why" required minLength={10} placeholder="Recorded with your name" /></label>
);

/** Grouped by provider. A model whose provider has no key on the worker is shown, but cannot be chosen. */
function ModelSelect({ catalog, value }: { catalog: ModelRow[]; value: string | null }) {
  const providers = [...new Set(catalog.map((m) => m.provider))];
  return (
    <label>
      <span className="rv-label">Model</span>
      <select className="rv-field" name="model" defaultValue={value ?? ""}>
        <option value="">Platform default</option>
        {providers.map((provider) => (
          <optgroup key={provider} label={provider === "huggingface" ? "Hugging Face" : provider === "openai" ? "OpenAI" : provider === "anthropic" ? "Anthropic" : "Self-hosted"}>
            {catalog.filter((m) => m.provider === provider).map((m) => (
              <option key={m.model_id} value={m.model_id} disabled={!m.available && m.model_id !== value}>
                {m.label}{m.available ? "" : " (no key on the worker)"}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {catalog.length === 0 ? <span className="rv-hint block">The worker has not published its models yet. Start it, then reload.</span> : null}
    </label>
  );
}

/**
 * Editing a seat, the first option keeps the leaning as it is and sends nothing. A stored
 * leaning can sit between two labels (2.5), so preselecting the nearest one would change it
 * every time the form was saved for some other reason.
 */
const StanceSelect = ({ value }: { value?: number }) => (
  <label>
    <span className="rv-label">Leaning</span>
    <select className="rv-field" name="stance" defaultValue={value === undefined ? "3" : ""}>
      {value === undefined ? null : <option value="">Keep as it is ({STANCE_WORDS[Math.round(value)]?.toLowerCase()}, {value})</option>}
      {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{STANCE_WORDS[n]}</option>)}
    </select>
  </label>
);

export function AddSeatForm({ runId, catalog }: { runId: string; catalog: ModelRow[] }) {
  const [state, action, pending] = useActionState(addSeatAction, null);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="run_id" value={runId} />
      <div className="rv-grid2">
        <label><span className="rv-label">Title</span><input className="rv-field" name="title" required minLength={2} maxLength={120} placeholder="Data Protection Officer" /></label>
        <label><span className="rv-label">Short name</span><input className="rv-field" name="name" maxLength={60} placeholder="Privacy" /></label>
      </div>
      <label>
        <span className="rv-label">What this adviser answers for, and aims for</span>
        <textarea className="rv-field" name="brief" rows={6} required minLength={40}
          placeholder="You answer for member data: what is collected, where it goes, and whether members would expect it. You push for… Your blind spot is…" />
        <span className="rv-hint block">Say what it looks at, what it wants, and the blind spot others should challenge.</span>
      </label>
      <div className="rv-grid2"><StanceSelect /><ModelSelect catalog={catalog} value={null} /></div>
      <Why label="Why is this seat being added?" />
      <div><button className="rv-btn rv-btn-you" type="submit" disabled={pending}>{pending ? "Seating…" : "Add adviser"}</button></div>
      <Said state={state} ok="Seated. They speak last, from the next review." />
    </form>
  );
}

export function SeatForm({ runId, seat, catalog }: { runId: string; seat: SeatRow; catalog: ModelRow[] }) {
  const [state, action, pending] = useActionState(updateSeatAction, null);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="run_id" value={runId} />
      <input type="hidden" name="seat" value={seat.seat} />
      <div className="rv-grid2">
        <label><span className="rv-label">Title</span><input className="rv-field" name="title" required defaultValue={seat.title} /></label>
        <label><span className="rv-label">Short name</span><input className="rv-field" name="name" defaultValue={seat.name} /></label>
      </div>
      <div className="rv-grid2"><StanceSelect value={Number(seat.stance_baseline)} /><ModelSelect catalog={catalog} value={seat.model} /></div>
      <Why />
      <div><button className="rv-btn rv-btn-you" type="submit" disabled={pending}>{pending ? "Saving…" : "Save seat"}</button></div>
      <Said state={state} ok="Saved. It applies from the next review, and the change is on the record." />
    </form>
  );
}

export function RemoveSeatForm({ runId, seat }: { runId: string; seat: SeatRow }) {
  const [state, action, pending] = useActionState(removeSeatAction, null);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="run_id" value={runId} />
      <input type="hidden" name="seat" value={seat.seat} />
      <Why label="Why is this seat being removed?" />
      <div><button className="rv-btn" type="submit" disabled={pending}>{pending ? "Removing…" : "Remove from the committee"}</button></div>
      <p className="rv-hint">Past reviews still show that it sat. It can be added back later.</p>
      <Said state={state} ok="Removed. It will not sit on the next review." />
    </form>
  );
}
