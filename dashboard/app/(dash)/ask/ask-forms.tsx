"use client";

import { useActionState } from "react";
import type { ControlResult } from "@/lib/control/submit";
import { askPolicyAction, escalateAskAction } from "../reviews/actions";

function Said({ state, ok }: { state: ControlResult | null; ok: string }) {
  if (!state) return null;
  if (state.success) return <p className="rv-said is-ok" role="status">{ok}</p>;
  return <div className="rv-said is-bad" role="alert"><p>{state.error}</p>{state.issues ? <ul className="list-disc pl-5">{state.issues.map((i) => <li key={i}>{i}</li>)}</ul> : null}</div>;
}

/** One box. The answer comes from the policy, a few seconds later, with the controls it relied on. */
export function AskForm({ runId }: { runId: string }) {
  const [state, action, pending] = useActionState(askPolicyAction, null);
  return (
    <form action={action} className="rv-ask" key={state?.success ? String(Date.now()) : "ask"}>
      <input type="hidden" name="run_id" value={runId} />
      <label className="block">
        <span className="rv-label">Ask the policy</span>
        <textarea className="rv-field rv-ask-box" name="question" rows={3} required minLength={10} maxLength={2000} autoFocus
          placeholder="Can I paste a customer's email into ChatGPT to draft a reply?" />
      </label>
      <div className="rv-ask-row">
        <span className="rv-hint" style={{ marginTop: 0 }}>Answered from the policy, with the controls cited. Not legal advice.</span>
        <button className="rv-btn rv-btn-you" type="submit" disabled={pending}>{pending ? "Asking…" : "Ask"}</button>
      </div>
      <Said state={state} ok="Reading the policy. The answer appears below in a moment." />
    </form>
  );
}

export function SendToCommittee({ runId, askId }: { runId: string; askId: string }) {
  const [state, action, pending] = useActionState(escalateAskAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="run_id" value={runId} />
      <input type="hidden" name="ask_id" value={askId} />
      <button className="rv-btn rv-btn-sm" type="submit" disabled={pending || Boolean(state?.success)}>{pending ? "Sending…" : state?.success ? "Sent" : "Send to the committee"}</button>
      {state && !state.success ? <span className="rv-said is-bad" style={{ marginTop: 0 }}>{state.error}</span> : null}
    </form>
  );
}
