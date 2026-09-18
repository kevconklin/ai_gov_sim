"use client";

import { useActionState } from "react";
import type { ControlResult } from "@/lib/control/submit";
import type { AwaitingRow, DissentRow } from "@/lib/queries/governance";
import { ITEM_KINDS } from "@/lib/control/schema";
import type { SeatRow } from "@/lib/queries/governance";
import { attestAction, conveneAction, refreshCandidatesAction, setBriefAction, submitItemAction } from "./actions";

export interface Candidate {
  kind: string;
  ref_id: string;
  title: string;
  priority: number;
  reasons: string[];
  deferrals: number;
  escalated: boolean;
}

function ResultBox({ state }: { state: ControlResult | null }) {
  if (!state) return null;
  if (state.success) {
    return (
      <p style={{ color: "var(--c-sev-low)" }}>
        Queued command {state.data.command_id}. The worker answers it; this page shows the result once it has.
      </p>
    );
  }
  return (
    <div style={{ color: "var(--c-sev-high)" }}>
      <p>{state.error}</p>
      {state.issues ? <ul className="list-disc pl-5">{state.issues.map((i) => <li key={i}>{i}</li>)}</ul> : null}
    </div>
  );
}

export function RefreshCandidates({ runId }: { runId: string }) {
  const [state, action, pending] = useActionState(refreshCandidatesAction, null);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="run_id" value={runId} />
      <button className="btn w-fit" type="submit" disabled={pending}>
        {pending ? "Requesting…" : "Re-rank candidates"}
      </button>
      <ResultBox state={state} />
    </form>
  );
}

export function ConveneForm({ runId, candidates }: { runId: string; candidates: Candidate[] }) {
  const [state, action, pending] = useActionState(conveneAction, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="run_id" value={runId} />

      {candidates.length > 0 ? (
        <fieldset className="flex flex-col gap-1">
          <legend className="muted">Items for decision</legend>
          {candidates.map((c, i) => (
            <label key={c.ref_id} className="flex items-start gap-2">
              <input
                type="checkbox"
                name="item"
                value={JSON.stringify({
                  // The committee refers to a matter by the tail of its id (IT-004, UC-002).
                  item_id: c.ref_id.split("/").pop() ?? `ITEM-${i + 1}`,
                  kind: c.kind,
                  title: c.title,
                  ref_id: c.ref_id,
                })}
              />
              <span>
                {c.title} <span className="muted">· {c.kind} · priority {c.priority}</span>
                {c.escalated ? <span style={{ color: "var(--c-sev-high)" }}> · escalated</span> : null}
              </span>
            </label>
          ))}
        </fieldset>
      ) : (
        <p className="muted">No ranked candidates yet. Re-rank first, or call a discussion-only meeting.</p>
      )}

      <label className="flex flex-col gap-1">
        <span className="muted">Advisory questions, one per line (discussed, not voted on)</span>
        <textarea className="field" name="advisory" rows={3} placeholder="Where should model risk oversight sit?" />
      </label>

      <label className="flex flex-col gap-1">
        <span className="muted">Reason (recorded as an intervention, 10 characters minimum)</span>
        <input className="field" name="reason" required minLength={10} />
      </label>

      <button className="btn w-fit" type="submit" disabled={pending}>
        {pending ? "Queueing…" : "Convene"}
      </button>
      <ResultBox state={state} />
    </form>
  );
}

export function AttestForm({ runId, row, dissents }: { runId: string; row: AwaitingRow; dissents: DissentRow[] }) {
  const [state, action, pending] = useActionState(attestAction, null);
  return (
    <form action={action} className="flex flex-col gap-2 border-t pt-2" style={{ borderColor: "var(--border)" }}>
      <input type="hidden" name="run_id" value={runId} />
      <input type="hidden" name="decision_id" value={row.decision_id} />

      {dissents.length > 0 ? (
        <fieldset className="flex flex-col gap-1">
          <legend className="muted">
            Dissent — on a high-tier item every one of these must be answered before it applies
          </legend>
          {dissents.map((d) => (
            <label key={d.agent_id} className="flex items-start gap-2">
              <input type="checkbox" name="responded_to" value={d.agent_id} />
              <span>
                {d.name} <span className="muted">({d.seat}){d.rationale ? ` — ${d.rationale}` : ""}</span>
              </span>
            </label>
          ))}
        </fieldset>
      ) : (
        <p className="muted">No dissent recorded on this item.</p>
      )}

      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col gap-1">
          <span className="muted">Your decision</span>
          <select className="field" name="outcome" required defaultValue="">
            <option value="" disabled>Choose…</option>
            <option value="approved">Approve</option>
            <option value="rejected">Reject</option>
            <option value="deferred">Defer (counts toward escalation)</option>
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="muted">Your reasoning, in your own words</span>
        <textarea className="field" name="rationale" rows={2} required />
      </label>

      <label className="flex items-center gap-2">
        <input type="checkbox" name="apply" />
        <span>Apply the meeting once every item in it is attested</span>
      </label>

      <button className="btn w-fit" type="submit" disabled={pending}>
        {pending ? "Recording…" : "Record attestation"}
      </button>
      <ResultBox state={state} />
    </form>
  );
}

const KIND_LABELS: Record<(typeof ITEM_KINDS)[number], string> = {
  use_case: "AI use case",
  tool: "AI tool",
  vendor: "AI vendor",
  policy_change: "Policy change",
  exception: "Policy exception",
  incident: "AI incident",
  question: "Question for the committee (advice, no vote)",
};

export function IntakeForm({ runId }: { runId: string }) {
  const [state, action, pending] = useActionState(submitItemAction, null);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="run_id" value={runId} />
      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col gap-1">
          <span className="muted">What is it</span>
          <select className="field" name="kind" required defaultValue="use_case">
            {ITEM_KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="muted">Risk tier, if you know it</span>
          <select className="field" name="risk_tier" defaultValue="">
            <option value="">Not rated</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High (whole committee sits)</option>
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="muted">Title</span>
        <input className="field" name="title" required minLength={3} maxLength={200} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="muted">What the committee needs to know</span>
        <textarea className="field" name="description" rows={3} required minLength={10} />
      </label>
      <button className="btn w-fit" type="submit" disabled={pending}>{pending ? "Submitting…" : "Submit for review"}</button>
      <ResultBox state={state} />
    </form>
  );
}

export function BriefForm({ runId, seat }: { runId: string; seat: SeatRow }) {
  const [state, action, pending] = useActionState(setBriefAction, null);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="run_id" value={runId} />
      <input type="hidden" name="seat" value={seat.seat} />
      <textarea className="field" name="brief" rows={4} required minLength={40} defaultValue={seat.persona_text ?? ""} />
      <label className="flex flex-col gap-1">
        <span className="muted">Why it is changing (recorded as an intervention)</span>
        <input className="field" name="reason" required minLength={10} />
      </label>
      <button className="btn w-fit" type="submit" disabled={pending}>{pending ? "Saving…" : "Rewrite brief"}</button>
      <ResultBox state={state} />
    </form>
  );
}
