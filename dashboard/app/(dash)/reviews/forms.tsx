"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { ITEM_KINDS } from "@/lib/control/schema";
import type { ControlResult } from "@/lib/control/submit";
import type { SeatRow } from "@/lib/queries/governance";
import { plural, type QueueEntry } from "@/lib/reviews/model";
import { attestAction, conveneAction, refreshCandidatesAction, setBriefAction, submitItemAction } from "./actions";

/** What the page says back. Every action is queued for the worker, so "done" means "asked", and says so. */
function Said({ state, ok }: { state: ControlResult | null; ok: string }) {
  if (!state) return null;
  if (state.success) return <p className="rv-said is-ok" role="status">{ok}</p>;
  return (
    <div className="rv-said is-bad" role="alert">
      <p>{state.error}</p>
      {state.issues ? <ul className="list-disc pl-5">{state.issues.map((i) => <li key={i}>{i}</li>)}</ul> : null}
    </div>
  );
}

/** Keeps the page current while the worker has something of yours in hand. */
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [active, router]);
  return null;
}

export interface Scope {
  run_id: string;
  label: string;
  workspace: boolean;
}

export function WorkspacePicker({ scopes, current }: { scopes: Scope[]; current: string }) {
  const router = useRouter();
  const orgs = scopes.filter((s) => s.workspace);
  const sims = scopes.filter((s) => !s.workspace);
  return (
    <label className="rv-picker">
      <span className="muted">Committee</span>
      <select
        className="field"
        value={current}
        onChange={(e) => router.push(`/reviews?run=${encodeURIComponent(e.currentTarget.value)}`)}
      >
        {orgs.length ? (
          <optgroup label="Organisations">
            {orgs.map((s) => <option key={s.run_id} value={s.run_id}>{s.label}</option>)}
          </optgroup>
        ) : null}
        {sims.length ? (
          <optgroup label="Simulated runs">
            {sims.map((s) => <option key={s.run_id} value={s.run_id}>{s.label}</option>)}
          </optgroup>
        ) : null}
      </select>
    </label>
  );
}

const KIND_CHOICES: Record<(typeof ITEM_KINDS)[number], string> = {
  use_case: "A use case for AI",
  tool: "An AI tool staff want to use",
  vendor: "A vendor whose product uses AI",
  policy_change: "A change to our AI policy",
  exception: "An exception to our AI policy",
  incident: "Something that went wrong",
  question: "A question (the committee advises, no vote)",
};

export function SubmitMatter({ runId }: { runId: string }) {
  const [state, action, pending] = useActionState(submitItemAction, null);
  return (
    <details className="rv-submit">
      <summary><span className="rv-btn rv-btn-line">Submit a matter</span></summary>
      <form action={action} className="rv-submit-form">
        <input type="hidden" name="run_id" value={runId} />
        <div className="rv-row">
          <label>
            <span className="rv-label">What is it?</span>
            <select className="rv-field" name="kind" required defaultValue="use_case">
              {ITEM_KINDS.map((k) => <option key={k} value={k}>{KIND_CHOICES[k]}</option>)}
            </select>
          </label>
          <label>
            <span className="rv-label">How risky is it?</span>
            <select className="rv-field" name="risk_tier" defaultValue="">
              <option value="">Not sure yet</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High (the whole committee sits)</option>
            </select>
          </label>
        </div>
        <label>
          <span className="rv-label">Name it</span>
          <input className="rv-field" name="title" required minLength={3} maxLength={200} placeholder="Lumen transcript analytics" />
        </label>
        <label>
          <span className="rv-label">What should the committee know?</span>
          <textarea className="rv-field" name="description" rows={4} required minLength={10}
            placeholder="What it does, whose data it touches, who wants it and why." />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button className="rv-btn rv-btn-ink" type="submit" disabled={pending}>{pending ? "Submitting…" : "Submit for review"}</button>
          <span className="rv-hint" style={{ marginTop: 0 }}>It joins the queue below. You choose when it is reviewed.</span>
        </div>
        <Said state={state} ok="Submitted. It will appear in the queue in a moment." />
      </form>
    </details>
  );
}

export function RefreshRanking({ runId }: { runId: string }) {
  const [state, action, pending] = useActionState(refreshCandidatesAction, null);
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="run_id" value={runId} />
      <button className="rv-btn rv-btn-quiet" type="submit" disabled={pending}>{pending ? "Asking…" : "Refresh ranking"}</button>
      {state && !state.success ? <span className="rv-said is-bad" style={{ marginTop: 0 }}>{state.error}</span> : null}
    </form>
  );
}

function since(value: string): string {
  const day = value.length > 7 ? value : `${value}-01`;
  const days = Math.max(0, Math.floor((Date.now() - new Date(`${day}T00:00:00`).getTime()) / 86_400_000));
  if (days === 0) return "submitted today";
  if (days === 1) return "waiting 1 day";
  return `waiting ${days} days`;
}

export function Queue({ runId, entries }: { runId: string; entries: QueueEntry[] }) {
  const [state, action, pending] = useActionState(conveneAction, null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [question, setQuestion] = useState("");
  const questions = question.split("\n").filter((line) => line.trim()).length;
  const total = picked.size + questions;

  function toggle(ref: string, on: boolean) {
    setPicked((before) => {
      const next = new Set(before);
      if (on) next.add(ref);
      else next.delete(ref);
      return next;
    });
  }

  return (
    <form action={action} className="rv-queue">
      <input type="hidden" name="run_id" value={runId} />
      {entries.map((m) => (
        <label key={m.ref_id} className="rv-matter">
          <input type="checkbox" name="item" value={JSON.stringify(m.agenda)} checked={picked.has(m.ref_id)}
            onChange={(e) => toggle(m.ref_id, e.currentTarget.checked)} />
          {m.priority === null
            ? <span className="rv-rank is-new" title="Submitted since the last ranking">new</span>
            : <span className="rv-rank" title={`Priority ${m.priority} of 100`}>{m.priority}</span>}
          <span>
            <span className="rv-matter-title">{m.title}</span>
            <span className="rv-matter-meta">
              <span>{m.display}</span>
              <span>{m.advisory ? "Question, for advice only" : m.label}</span>
              {m.risk_tier ? <span className={m.risk_tier === "high" ? "rv-tier-high" : undefined}>{m.risk_tier} risk</span> : null}
              <span>{since(m.since)}</span>
              {m.deferrals ? <span className="rv-flag">deferred {m.deferrals === 1 ? "once" : `${m.deferrals} times`}</span> : null}
              {m.escalated ? <span className="rv-flag">escalated</span> : null}
            </span>
          </span>
        </label>
      ))}
      <div className="rv-queue-foot">
        <details className="rv-ask">
          <summary>Ask the committee a question as well</summary>
          <textarea className="rv-field" name="advisory" rows={2} value={question} onChange={(e) => setQuestion(e.currentTarget.value)}
            placeholder="One question per line. The committee advises on these and does not vote." />
        </details>
        <div className="rv-queue-act">
          <span className="rv-hint" style={{ marginTop: 0 }}>
            {total === 0 ? "Tick the matters you want reviewed." : "Only the seats these matters need will sit. High risk seats everyone."}
          </span>
          <button className="rv-btn rv-btn-ink" type="submit" disabled={pending || total === 0}>
            {pending ? "Convening…" : total === 0 ? "Convene a review" : `Convene a review of ${plural(total, "matter")}`}
          </button>
        </div>
        <Said state={state} ok="The committee has been convened. Its recommendations will appear above when it finishes." />
      </div>
    </form>
  );
}

export interface DissentView {
  agent_id: string;
  title: string;
  rationale: string | null;
}

export function SignDecision({ runId, decisionId, recommended, mustWeighAll, dissents, operator, reviewTotal, reviewSigned }: {
  runId: string;
  decisionId: string;
  recommended: string;
  mustWeighAll: boolean;
  dissents: DissentView[];
  operator: string;
  reviewTotal: number;
  reviewSigned: number;
}) {
  const [state, action, pending] = useActionState(attestAction, null);
  const [outcome, setOutcome] = useState("");
  const left = reviewTotal - reviewSigned - 1;

  return (
    <form action={action}>
      <input type="hidden" name="run_id" value={runId} />
      <input type="hidden" name="decision_id" value={decisionId} />

      {dissents.length > 0 ? (
        <div className="rv-dissents" style={{ marginTop: 0, marginBottom: "1.1rem" }}>
          {dissents.map((d) => (
            <div key={d.agent_id} className="rv-dissent">
              <span className="rv-dissent-who">{d.title} objected.</span>{" "}
              <span>{d.rationale || "No reason was recorded."}</span>
              <label className="rv-weighed">
                <input type="checkbox" name="responded_to" value={d.agent_id} required={mustWeighAll} />
                I have weighed this objection
              </label>
            </div>
          ))}
          {mustWeighAll ? <p className="rv-hint" style={{ marginTop: 0 }}>This is high risk, so every objection has to be weighed before you can sign.</p> : null}
        </div>
      ) : null}

      <fieldset>
        <legend className="rv-label">Your decision</legend>
        <div className="rv-choices" role="radiogroup">
          {[["approved", "Approve"], ["rejected", "Reject"], ["deferred", "Defer"]].map(([value, label]) => (
            <label key={value}>
              <input type="radio" name="outcome" value={value} required checked={outcome === value} onChange={() => setOutcome(value ?? "")} />
              {label}
            </label>
          ))}
        </div>
        {outcome === "deferred" ? (
          <p className="rv-hint is-ink">It goes back to the queue, and the deferral is counted. Two deferrals escalate it.</p>
        ) : outcome && outcome !== recommended ? (
          <p className="rv-hint is-ink">This overrules the committee. That is your call to make, and it is recorded as an override.</p>
        ) : null}
      </fieldset>

      <label className="mt-4 block">
        <span className="rv-label">Your reasoning</span>
        <textarea className="rv-field" name="rationale" rows={3} required placeholder="In your own words. Nothing drafts this for you." />
      </label>

      <div className="rv-sign">
        <div className="rv-signature">
          <div className="rv-signature-name">{operator}</div>
          <div className="rv-signature-caption">
            Your name goes on the record with this decision.
            {left > 0 ? ` It takes effect once the other ${plural(left, "matter")} from this review ${left === 1 ? "is" : "are"} signed.` : ""}
          </div>
        </div>
        <button className="rv-btn rv-btn-ink" type="submit" disabled={pending}>{pending ? "Signing…" : "Sign decision"}</button>
      </div>
      <Said state={state} ok="Signed. It is being recorded now." />
    </form>
  );
}

export function BriefForm({ runId, seat }: { runId: string; seat: SeatRow }) {
  const [state, action, pending] = useActionState(setBriefAction, null);
  return (
    <form action={action} className="mt-3 grid gap-3">
      <input type="hidden" name="run_id" value={runId} />
      <input type="hidden" name="seat" value={seat.seat} />
      <label>
        <span className="rv-label">Brief</span>
        <textarea className="rv-field" name="brief" rows={5} required minLength={40} defaultValue={seat.persona_text ?? ""} />
      </label>
      <label>
        <span className="rv-label">Why are you changing it?</span>
        <input className="rv-field" name="reason" required minLength={10} />
        <span className="rv-hint block">Recorded, because reviews held after this change are not comparable with those before it.</span>
      </label>
      <div><button className="rv-btn" type="submit" disabled={pending}>{pending ? "Saving…" : "Save brief"}</button></div>
      <Said state={state} ok="Saved. The new brief applies from the next review." />
    </form>
  );
}
