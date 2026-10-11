"use client";

import Link from "next/link";
import { useState } from "react";
import { dataSeen, groupRegister, matches, type RegisterEntry } from "@/lib/register/group";
import { KIND_LABELS } from "@/lib/reviews/model";

const TIER_WORDS: Record<string, string> = { high: "High risk", medium: "Medium risk", low: "Low risk" };
const STATUS_WORDS: Record<string, string> = { submitted: "Waiting for review", in_review: "With the committee", recommended: "Waiting for a decision" };

function Table({ rows, run, tone }: { rows: RegisterEntry[]; run: string; tone: "ok" | "no" | "wait" }) {
  return (
    <div className="rv-table-wrap">
      <table className="rv-table">
        <thead><tr><th>Tool</th><th>Kind</th><th>Risk</th><th>{tone === "ok" ? "Conditions" : tone === "no" ? "Why not" : "Status"}</th><th>Signed by</th><th /></tr></thead>
        <tbody>
          {rows.map((r) => {
            const data = dataSeen(r.details);
            return (
              <tr key={r.item_id}>
                <td><Link href={`/matter?run=${run}&id=${encodeURIComponent(r.item_id)}`} className="rv-cell"><span className="rv-dot" data-tone={tone} />{r.title}</Link>{data.length ? <span className="rv-sub">Sees: {data.join(", ")}</span> : null}</td>
                <td className="muted">{KIND_LABELS[r.kind] ?? r.kind}</td>
                <td>{r.risk_tier ? <span className="rv-chip has-dot" data-tone={r.risk_tier}>{TIER_WORDS[r.risk_tier]}</span> : <span className="muted">Not rated</span>}</td>
                <td>{tone === "wait" ? <span className="rv-chip" data-tone="wait">{STATUS_WORDS[r.status] ?? r.status}</span> : <span className="rv-sub" style={{ marginTop: 0 }}>{r.rationale}</span>}</td>
                <td className="muted">{r.actor ? `${r.actor.replace(/ <.*>$/, "")}${r.decided_on ? `, ${r.decided_on}` : ""}` : "—"}</td>
                <td><Link href={`/matter?run=${run}&id=${encodeURIComponent(r.item_id)}`} className="rv-btn rv-btn-sm">Story</Link></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
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
          {list.length === 0 ? <div className="rv-empty"><span className="muted">{q ? "Nothing matches here." : "Nothing yet."}</span></div> : <Table rows={list} run={run} tone={tone} />}
        </section>
      ))}
    </>
  );
}
