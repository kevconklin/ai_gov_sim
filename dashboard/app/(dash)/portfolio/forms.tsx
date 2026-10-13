"use client";

import { useActionState } from "react";
import type { ControlResult } from "@/lib/control/submit";
import { STAGE_HINT, STAGE_WORDS, TRANSITIONS, type Stage } from "@/lib/lifecycle/stages";
import { setOwnerAction, setStageAction } from "../reviews/actions";

function Said({ state, ok }: { state: ControlResult | null; ok: string }) {
  if (!state) return null;
  if (state.success) return <p className="rv-said is-ok" role="status">{ok}</p>;
  return <div className="rv-said is-bad" role="alert"><p>{state.error}</p>{state.issues ? <ul className="list-disc pl-5">{state.issues.map((i) => <li key={i}>{i}</li>)}</ul> : null}</div>;
}

export function MoveStageForm({ runId, itemId, stage }: { runId: string; itemId: string; stage: Stage }) {
  const [state, action, pending] = useActionState(setStageAction, null);
  const moves = TRANSITIONS[stage];
  if (!moves.length) return <p className="rv-hint">Retired use cases stay on the record and cannot be moved.</p>;
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="run_id" value={runId} />
      <input type="hidden" name="item_id" value={itemId} />
      <fieldset>
        <legend className="rv-label">Move it to</legend>
        <div className="rv-choices is-stack" role="radiogroup">
          {moves.map((m) => (
            <label key={m} className="rv-choice is-card" data-tone="you">
              <input type="radio" name="to" value={m} required />
              <span className="rv-choice-title">{STAGE_WORDS[m]}</span>
              <span className="rv-choice-text">{STAGE_HINT[m]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label><span className="rv-label">What happened?</span><input className="rv-field" name="why" required minLength={10} placeholder="Pilot on two wards from October" /></label>
      <div><button className="rv-btn rv-btn-you" type="submit" disabled={pending}>{pending ? "Moving…" : "Move"}</button></div>
      <Said state={state} ok="Moved. It is on the record with your name." />
    </form>
  );
}

export function OwnerForm({ runId, itemId, owner }: { runId: string; itemId: string; owner: string | null }) {
  const [state, action, pending] = useActionState(setOwnerAction, null);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="run_id" value={runId} />
      <input type="hidden" name="item_id" value={itemId} />
      <label><span className="rv-label">Who is accountable for it?</span><input className="rv-field" name="owner" required minLength={2} maxLength={200} defaultValue={owner ?? ""} placeholder="Priya Nair, Nursing Director" /></label>
      <div><button className="rv-btn" type="submit" disabled={pending}>{pending ? "Saving…" : owner ? "Change owner" : "Set owner"}</button></div>
      <Said state={state} ok="Saved." />
    </form>
  );
}
