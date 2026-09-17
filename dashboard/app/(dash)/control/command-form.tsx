"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { ControlResult } from "@/lib/control/submit";
import { COMMAND_KINDS, INTERVENTION_KINDS } from "@/lib/control/schema";
import { EVENT_TYPES } from "@/lib/constants";
import { commandAction, interventionAction } from "./actions";

type RunOption = { run_id: string; label: string };

function ResultBox({ state }: { state: ControlResult | null }) {
  if (!state) return null;
  if (state.success) {
    return <p style={{ color: "var(--c-sev-low)" }}>Recorded{state.data.command_id ? ` command ${state.data.command_id} (pending)` : ""} and intervention {state.data.intervention_id}.</p>;
  }
  return (
    <div style={{ color: "var(--c-sev-high)" }}>
      <p>{state.error}</p>
      {state.issues ? <ul className="list-disc pl-5">{state.issues.map((i) => <li key={i}>{i}</li>)}</ul> : null}
    </div>
  );
}

function EventFields({ prefix }: { prefix: string }) {
  return (
    <>
      <label className="flex flex-col gap-1">
        <span className="muted">Event type</span>
        <select className="field" name={`${prefix}event_type`} required>
          {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="muted">Severity</span>
        <select className="field" name={`${prefix}severity`} defaultValue="medium">
          <option value="low">low</option><option value="medium">medium</option><option value="high">high</option>
        </select>
      </label>
      <label className="col-span-2 flex flex-col gap-1">
        <span className="muted">Event notes (template details)</span>
        <input className="field" name={`${prefix}notes`} required maxLength={2000} />
      </label>
    </>
  );
}

export function CommandForm({ runs }: { runs: RunOption[] }) {
  const [state, action, pending] = useActionState<ControlResult | null, FormData>(commandAction, null);
  const [kind, setKind] = useState<string>("pause");
  const [forkInject, setForkInject] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.success) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="grid grid-cols-2 gap-2">
      <label className="flex flex-col gap-1">
        <span className="muted">Run</span>
        <select className="field" name="run_id" required>
          {runs.map((r) => <option key={r.run_id} value={r.run_id}>{r.label}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="muted">Action</span>
        <select className="field" name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          {COMMAND_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </label>
      {kind === "advance" ? (
        <label className="flex flex-col gap-1">
          <span className="muted">Months (1-12)</span>
          <input className="field" type="number" name="months" min={1} max={12} step={1} defaultValue={1} required />
        </label>
      ) : null}
      {kind === "set_spend_cap" ? (
        <label className="flex flex-col gap-1">
          <span className="muted">USD per sim month</span>
          <input className="field" type="number" name="usd_per_sim_month" min={0.01} step={0.01} required />
        </label>
      ) : null}
      {kind === "inject_event" ? <EventFields prefix="" /> : null}
      {kind === "fork" ? (
        <>
          <label className="flex flex-col gap-1">
            <span className="muted">Fork from checkpoint month (YYYY-MM)</span>
            <input className="field" name="from_month" pattern="\d{4}-(0[1-9]|1[0-2])" placeholder="2027-03" required />
          </label>
          <label className="flex items-center gap-1 self-end">
            <input type="checkbox" name="fork_inject" checked={forkInject} onChange={(e) => setForkInject(e.target.checked)} />
            <span>Inject an event in the fork</span>
          </label>
          {forkInject ? <EventFields prefix="fork_" /> : null}
        </>
      ) : null}
      <label className="col-span-2 flex flex-col gap-1">
        <span className="muted">Reason (required, at least 10 characters; written to interventions)</span>
        <textarea className="field" name="reason" rows={2} minLength={10} maxLength={2000} required />
      </label>
      <div className="col-span-2 flex items-center gap-3">
        <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "Submitting..." : "Queue command"}</button>
        <ResultBox state={state} />
      </div>
    </form>
  );
}

export function InterventionForm({ runs }: { runs: RunOption[] }) {
  const [state, action, pending] = useActionState<ControlResult | null, FormData>(interventionAction, null);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.success) formRef.current?.reset();
  }, [state]);
  return (
    <form ref={formRef} action={action} className="grid grid-cols-2 gap-2">
      <label className="flex flex-col gap-1">
        <span className="muted">Run</span>
        <select className="field" name="run_id">
          <option value="">(all runs / global)</option>
          {runs.map((r) => <option key={r.run_id} value={r.run_id}>{r.label}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="muted">Kind</span>
        <select className="field" name="kind">
          {INTERVENTION_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </label>
      <label className="col-span-2 flex flex-col gap-1">
        <span className="muted">Description (at least 10 characters)</span>
        <textarea className="field" name="reason" rows={2} minLength={10} maxLength={2000} required />
      </label>
      <div className="col-span-2 flex items-center gap-3">
        <button className="btn" type="submit" disabled={pending}>{pending ? "Saving..." : "Log intervention"}</button>
        <ResultBox state={state} />
      </div>
    </form>
  );
}
