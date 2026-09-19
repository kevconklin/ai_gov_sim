"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import type { ControlResult } from "@/lib/control/submit";
import type { SeatRow } from "@/lib/queries/governance";
import { ageOf, initials, plural, seatCode, seatColor, type QueueEntry } from "@/lib/reviews/model";
import { attestAction, conveneAction, refreshCandidatesAction, setBriefAction } from "./actions";

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

const Chevron = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="rv-chev"><path d="M9 6l6 6-6 6" /></svg>
);

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

/** Escape closes the drawer, the way every other drawer does. */
export function EscClose({ href }: { href: string }) {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.push(href, { scroll: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [href, router]);
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
    <select className="rv-select" aria-label="Committee" value={current}
      onChange={(e) => router.push(`/reviews?run=${encodeURIComponent(e.currentTarget.value)}`)}>
      {orgs.length ? <optgroup label="Organisations">{orgs.map((s) => <option key={s.run_id} value={s.run_id}>{s.label}</option>)}</optgroup> : null}
      {sims.length ? <optgroup label="Simulated runs">{sims.map((s) => <option key={s.run_id} value={s.run_id}>{s.label}</option>)}</optgroup> : null}
    </select>
  );
}

export function RefreshRanking({ runId }: { runId: string }) {
  const [state, action, pending] = useActionState(refreshCandidatesAction, null);
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="run_id" value={runId} />
      <button className="rv-btn rv-btn-sm" type="submit" disabled={pending}>{pending ? "Ranking…" : "Re-rank"}</button>
      {state && !state.success ? <span className="rv-said is-bad" style={{ marginTop: 0 }}>{state.error}</span> : null}
    </form>
  );
}

const TIER_WORDS: Record<string, string> = { high: "High risk", medium: "Medium risk", low: "Low risk" };

/** The waiting matters: tick to choose, click to read. The action bar names what it will do. */
export function WaitingRows({ runId, entries, openHrefs, askHref }: { runId: string; entries: QueueEntry[]; openHrefs: Record<string, string>; askHref: string }) {
  const [state, action, pending] = useActionState(conveneAction, null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const total = picked.size;

  function toggle(ref: string, on: boolean) {
    setPicked((before) => {
      const next = new Set(before);
      if (on) next.add(ref);
      else next.delete(ref);
      return next;
    });
  }

  return (
    <form action={action}>
      <input type="hidden" name="run_id" value={runId} />
      <div className="rv-rows">
        {entries.map((m) => (
          <div key={m.ref_id} className={`rv-rowline${picked.has(m.ref_id) ? " is-picked" : ""}`}>
            <span className="flex items-center gap-3">
              <input type="checkbox" name="item" aria-label={`Review ${m.title}`} value={JSON.stringify(m.agenda)}
                checked={picked.has(m.ref_id)} onChange={(e) => toggle(m.ref_id, e.currentTarget.checked)} />
              <span className="rv-riskmark" data-tone={m.risk_tier ?? undefined} />
            </span>
            <span className="min-w-0">
              <Link href={openHrefs[m.ref_id] ?? "#"} scroll={false} className="rv-rowtitle rv-rowlink">{m.title}</Link>
              <span className="rv-rowmeta">
                <span className="rv-chip is-plain">{m.advisory ? "Question" : m.label}</span>
                {m.risk_tier ? <span className="rv-chip has-dot" data-tone={m.risk_tier}>{TIER_WORDS[m.risk_tier]}</span> : null}
                {m.deferrals ? <span className="rv-chip" data-tone="objection">Deferred {m.deferrals === 1 ? "once" : `${m.deferrals}×`}</span> : null}
                {m.escalated ? <span className="rv-chip is-solid" data-tone="high">Escalated</span> : null}
                {m.priority === null ? <span className="rv-chip" data-tone="you">New</span> : null}
              </span>
            </span>
            <span className="rv-rowend">
              <span className="is-wide">{ageOf(m.since)}</span>
              {m.priority !== null ? <span className="is-wide" title="Priority out of 100. The committee never sees it.">P{m.priority}</span> : null}
              <Chevron />
            </span>
          </div>
        ))}
      </div>
      <div className="rv-actionbar">
        <Link href={askHref} scroll={false} className="rv-btn rv-btn-sm">Ask the committee a question</Link>
        <span className="flex flex-wrap items-center gap-3">
          <span className="rv-hint" style={{ marginTop: 0 }}>{total ? `${plural(total, "matter")} selected` : "Tick matters to review"}</span>
          <button className="rv-btn rv-btn-you" type="submit" disabled={pending || total === 0}>
            {pending ? "Convening…" : total ? `Convene a review of ${plural(total, "matter")}` : "Convene a review"}
          </button>
        </span>
      </div>
      {state ? <div className="px-4 pb-3"><Said state={state} ok="Convened. Recommendations will show under Needs you when the committee finishes." /></div> : null}
    </form>
  );
}

export interface DissentView {
  agent_id: string;
  seat: string;
  title: string;
  index: number;
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
  const [open, setOpen] = useState<Set<string>>(new Set(mustWeighAll ? dissents.map((d) => d.agent_id) : []));
  const left = reviewTotal - reviewSigned - 1;
  const choices: [string, string, string][] = [["approved", "Approve", "ok"], ["rejected", "Reject", "no"], ["deferred", "Defer", "wait"]];

  function flip(id: string) {
    setOpen((before) => {
      const next = new Set(before);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="run_id" value={runId} />
      <input type="hidden" name="decision_id" value={decisionId} />

      {dissents.length > 0 ? (
        <div>
          <div className="rv-card-h" style={{ marginBottom: "0.4rem" }}>
            <span>{plural(dissents.length, "objection")}</span>
            {mustWeighAll ? <span className="rv-chip" data-tone="high">Weigh all to sign</span> : null}
          </div>
          {dissents.map((d) => (
            <div key={d.agent_id} className={`rv-fold${open.has(d.agent_id) ? " is-open" : ""}`} data-tone="objection">
              <div className="rv-fold-head" style={{ cursor: "default" }}>
                <input type="checkbox" name="responded_to" value={d.agent_id} required={mustWeighAll} aria-label={`I have weighed the objection from ${d.title}`} />
                <span className="rv-avatar" style={{ "--seat": seatColor(d.index) } as React.CSSProperties}>{seatCode(d.seat)}</span>
                <button type="button" className="flex flex-1 items-center gap-2 text-left" style={{ font: "inherit", fontWeight: 600, background: "none", border: 0, color: "inherit", cursor: "pointer" }}
                  onClick={() => flip(d.agent_id)} aria-expanded={open.has(d.agent_id)}>
                  <span>{d.title}</span><Chevron />
                </button>
              </div>
              {open.has(d.agent_id) ? <div className="rv-fold-body rv-prose">{d.rationale || "No reason was recorded."}</div> : null}
            </div>
          ))}
          <p className="rv-hint">Tick an objection once you have weighed it.</p>
        </div>
      ) : null}

      <fieldset>
        <legend className="rv-label">Your decision</legend>
        <div className="rv-choices" role="radiogroup">
          {choices.map(([value, label, tone]) => (
            <label key={value} className="rv-choice" data-tone={tone}>
              <input type="radio" name="outcome" value={value} required checked={outcome === value} onChange={() => setOutcome(value)} />
              {label}
            </label>
          ))}
        </div>
        {outcome === "deferred" ? <p className="rv-hint" data-tone="wait">Goes back to Waiting. Two deferrals escalate it.</p>
          : outcome && outcome !== recommended ? <p className="rv-hint" data-tone="objection">This overrules the committee, and is recorded as an override.</p> : null}
      </fieldset>

      <label>
        <span className="rv-label">Your reasoning</span>
        <textarea className="rv-field" name="rationale" rows={3} required placeholder="In your own words. Nothing drafts this for you." />
      </label>

      <div className="rv-signrow">
        <span className="rv-signer" title="Your name goes on the record with this decision.">
          <span className="rv-avatar is-you">{initials(operator)}</span>
          <span className="rv-signer-name">{operator}</span>
        </span>
        <button className="rv-btn rv-btn-you" type="submit" disabled={pending}>{pending ? "Signing…" : "Sign decision"}</button>
      </div>
      {left > 0 ? <p className="rv-hint" style={{ marginTop: "-0.5rem" }}>Takes effect once the other {plural(left, "matter")} from this review {left === 1 ? "is" : "are"} signed.</p> : null}
      <Said state={state} ok="Signed. It is being recorded now." />
    </form>
  );
}

export function BriefForm({ runId, seat }: { runId: string; seat: SeatRow }) {
  const [state, action, pending] = useActionState(setBriefAction, null);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="run_id" value={runId} />
      <input type="hidden" name="seat" value={seat.seat} />
      <label>
        <span className="rv-label">Brief</span>
        <textarea className="rv-field" name="brief" rows={7} required minLength={40} defaultValue={seat.persona_text ?? ""} />
      </label>
      <label>
        <span className="rv-label">Why are you changing it?</span>
        <input className="rv-field" name="reason" required minLength={10} />
      </label>
      <div><button className="rv-btn" type="submit" disabled={pending}>{pending ? "Saving…" : "Save brief"}</button></div>
      <Said state={state} ok="Saved. It applies from the next review." />
    </form>
  );
}
