"use client";

import Link from "next/link";
import { useState } from "react";
import { dataSeen, groupRegister, matches, type RegisterEntry } from "@/lib/register/group";
import { KIND_LABELS } from "@/lib/reviews/model";

const TIER_WORDS: Record<string, string> = { high: "High risk", medium: "Medium risk", low: "Low risk" };
const STATUS_WORDS: Record<string, string> = { submitted: "Waiting for review", in_review: "With the committee", recommended: "Waiting for a decision" };

function Row({ r, run, tone }: { r: RegisterEntry; run: string; tone: "ok" | "no" | "wait" }) {
  const data = dataSeen(r.details);
  const href = r.attestation_id ? `/reviews?run=${run}&tab=decided&open=record:${encodeURIComponent(r.attestation_id)}`
    : `/reviews?run=${run}&tab=waiting&open=matter:${encodeURIComponent(r.item_id)}`;
  return (
    <Link href={href} className="rv-rowline rv-reg">
      <span className="rv-riskmark" data-tone={tone} />
      <span className="min-w-0">
        <span className="rv-rowtitle">{r.title}</span>
        <span className="rv-rowmeta">
          <span className="rv-chip is-plain">{KIND_LABELS[r.kind] ?? r.kind}</span>
          {r.risk_tier ? <span className="rv-chip has-dot" data-tone={r.risk_tier}>{TIER_WORDS[r.risk_tier]}</span> : null}
          {tone === "wait" ? <span className="rv-chip" data-tone="wait">{STATUS_WORDS[r.status] ?? r.status}</span> : data.length ? <span className="muted text-xs">{data.join(", ")}</span> : null}
        </span>
        {r.rationale ? <span className="rv-reg-cond"><strong>{tone === "ok" ? "Conditions" : "Why not"}:</strong> {r.rationale}</span>
          : tone === "wait" ? <span className="rv-reg-cond muted">{r.description}</span> : null}
      </span>
      <span className="rv-rowend">
        {r.actor ? <span className="is-wide muted text-xs">Signed by {r.actor}{r.decided_on ? `, ${r.decided_on}` : ""}</span> : null}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="rv-chev" width="18" height="18"><path d="M9 6l6 6-6 6" /></svg>
      </span>
    </Link>
  );
}

/** The register with a search box. Staff type a tool's name and get an answer in one line. */
export function Register({ rows, run }: { rows: RegisterEntry[]; run: string }) {
  const [q, setQ] = useState("");
  const shown = rows.filter((r) => matches(r, q));
  const g = groupRegister(shown);
  const sections: [string, RegisterEntry[], "ok" | "no" | "wait", string][] = [
    ["You may use these", g.allowed, "ok", "Approved by a named person, on the conditions shown. Stay inside them."],
    ["Not allowed", g.notAllowed, "no", "Refused, with the reason. Ask the committee if circumstances have changed."],
    ["Being looked at", g.pending, "wait", "Submitted and not yet decided. Not approved until it appears above."],
  ];
  return (
    <>
      <div className="rv-card" data-tone="you">
        <label className="block">
          <span className="rv-label">Find a tool</span>
          <input className="rv-field rv-ask-box" value={q} onChange={(e) => setQ(e.currentTarget.value)} placeholder="ChatGPT, Copilot, Otter…" autoFocus />
        </label>
        <p className="rv-hint">Not listed? <Link href={`/reviews?run=${run}&open=submit:tool`}>Submit it</Link> or <Link href={`/ask?run=${run}`}>ask the policy</Link>.</p>
      </div>
      {sections.map(([title, list, tone, hint]) => (
        <section key={title} className="rv-board">
          <nav className="rv-tabs" aria-label={title}><span className="rv-tab" aria-current="page">{title}<span className="rv-tab-count" data-tone={list.length ? tone : undefined}>{list.length}</span></span><span className="rv-lead muted text-xs" title={hint}>{hint.split(".")[0]}</span></nav>
          {list.length === 0 ? <div className="rv-empty"><span className="muted">{q ? "Nothing matches here." : "Nothing yet."}</span></div> : <div className="rv-rows">{list.map((r) => <Row key={r.item_id} r={r} run={run} tone={tone} />)}</div>}
        </section>
      ))}
    </>
  );
}
