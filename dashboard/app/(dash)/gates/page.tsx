import Link from "next/link";
import { visibleRuns } from "@/lib/auth/access";
import { first, type SearchParams } from "@/lib/params";
import { currentScope } from "@/lib/queries/product";
import { debateCalibration, gateCalls, gateSummary, safeThreshold, type GateCallRow } from "@/lib/queries/gates";
import { Chip, Fold, Icon } from "../reviews/parts";

const PURPOSE: Record<string, string> = { intake_triage: "Intake", debate_outcome: "Debate gate", smoke: "Smoke test" };
const QUESTION: Record<string, string> = { duplicate_of: "Duplicate of an open matter?", kind: "What kind of matter?", risk_tier: "What risk tier?",
  instruction_shaped: "Text aimed at the reviewers?", outcome: "Would the vote be unanimous?" };

type Answer = { type: string; noul?: number; choice?: string; probabilities?: Record<string, number>; confidence?: number; score?: number; legend?: Record<string, string> };

function parse<T>(s: string | null | undefined, fallback: T): T { try { return s ? (JSON.parse(s) as T) : fallback; } catch { return fallback; } }
function pct(x: number) { return `${Math.round(x * 100)}%`; }
function when(iso: string) { return iso.slice(0, 16).replace("T", " "); }

function Bars({ p, pick }: { p: Record<string, number>; pick?: string }) {
  const entries = Object.entries(p).sort((a, b) => b[1] - a[1]).slice(0, 6);
  return (
    <div className="rv-gt-bars">
      {entries.map(([k, v]) => (
        <div key={k} className="rv-gt-bar" data-pick={k === pick ? "" : undefined}>
          <span className="rv-gt-bar-k">{k}</span>
          <span className="rv-gt-bar-track"><span style={{ width: pct(v) }} /></span>
          <span className="rv-gt-bar-v">{pct(v)}</span>
        </div>
      ))}
    </div>
  );
}

function AnswerView({ id, a }: { id: string; a: Answer }) {
  if (a.type === "noul") {
    const v = a.noul ?? 0;
    return (
      <div className="rv-gt-q">
        <div className="rv-gt-qh"><span>{QUESTION[id] ?? id}</span><b data-tone={v >= 0.5 ? "no" : "ok"}>{v >= 0.5 ? "Yes" : "No"}, p {v.toFixed(2)}</b></div>
        <Bars p={{ yes: v, no: 1 - v }} pick={v >= 0.5 ? "yes" : "no"} />
      </div>
    );
  }
  if (a.type === "choice") {
    return (
      <div className="rv-gt-q">
        <div className="rv-gt-qh"><span>{QUESTION[id] ?? id}</span><b>{a.choice}<span className="muted font-normal"> · confidence {(a.confidence ?? 0).toFixed(2)}</span></b></div>
        <Bars p={a.probabilities ?? {}} pick={a.choice} />
      </div>
    );
  }
  const legend = a.legend ?? {};
  return (
    <div className="rv-gt-q">
      <div className="rv-gt-qh"><span>{QUESTION[id] ?? id}</span><b>{(a.score ?? 0).toFixed(2)}<span className="muted font-normal"> · confidence {(a.confidence ?? 0).toFixed(2)}</span></b></div>
      <Bars p={Object.fromEntries(Object.entries(a.probabilities ?? {}).map(([k, v]) => [legend[k] ?? k, v]))} />
    </div>
  );
}

function Acted({ row }: { row: GateCallRow }) {
  const a = parse<Record<string, unknown>>(row.acted, {});
  const flags = Array.isArray(a.flags) ? (a.flags as string[]) : [];
  if (row.status !== "ok") return <Chip tone="wait">Did not run: {row.error}</Chip>;
  if (row.purpose === "debate_outcome") return a.skipped === true ? <Chip tone="ai">Skipped the debate</Chip> : <Chip plain>Debate ran</Chip>;
  if (row.purpose === "intake_triage") {
    if (!flags.length && a.flagged_text !== true) return <Chip tone="ok" dot>Nothing to flag</Chip>;
    return <span className="flex flex-wrap gap-1">{flags.map((f) => <Chip key={f} tone="wait">{f}</Chip>)}{a.flagged_text === true ? <Chip tone="objection">Flagged text</Chip> : null}</span>;
  }
  return <Chip plain>{Object.keys(a).length ? JSON.stringify(a) : "Read only"}</Chip>;
}

function Outcome({ row }: { row: GateCallRow }) {
  // what the person did after: the gate's reading set against the record
  if (row.purpose !== "intake_triage" || row.status !== "ok") return null;
  const a = parse<Record<string, unknown>>(row.acted, {});
  const flags = Array.isArray(a.flags) ? (a.flags as string[]) : [];
  const answers = parse<Record<string, Answer>>(row.answers, {});
  const out: string[] = [];
  if (flags.some((f) => f.startsWith("possible duplicate"))) out.push(row.item_status === "withdrawn" ? "Withdrawn, as the gate suggested" : "Kept despite the duplicate flag");
  const tierFlag = flags.find((f) => f.startsWith("reads as ") && f.includes(" risk"));
  if (tierFlag) out.push(row.item_tier === answers.risk_tier?.choice ? "Tier changed to the gate's reading" : `Tier kept at ${row.item_tier ?? "unset"}`);
  return out.length ? <span className="rv-gt-outcome">{out.join(" · ")}</span> : null;
}

export default async function GatesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const scope = await currentScope(first(sp, "run"), await visibleRuns());
  if (!scope) return <div className="rv"><h1 className="rv-org">No committee yet</h1></div>;
  const [rows, s, cal] = await Promise.all([gateCalls(scope.run_id), gateSummary(scope.run_id), debateCalibration(scope.run_id)]);
  const THRESHOLD = 0.9;   // config/classify.yaml debate_skip.threshold
  const MIN_REVIEWS = 20;  // below this the safe threshold is a reading of noise, not of the gate
  const run = encodeURIComponent(scope.run_id);
  return (
    <div className="rv">
      <header className="rv-top">
        <div className="flex flex-wrap items-center gap-2.5"><h1 className="rv-org">Gates</h1><Chip plain>{scope.name}</Chip></div>
        <p className="rv-sub">Typed decisions a fast model makes before the expensive steps: it flags a duplicate, reads a kind and a tier, spots text aimed at the reviewers, and says whether a debate would change anything. It decides nothing; every answer is here with its probabilities and what the code did next.</p>
      </header>

      <div className="rv-tiles">
        <span className="rv-tile" data-tone="ai"><span className="rv-tile-icon"><Icon name="flag" /></span><span><span className="rv-tile-count">{s.calls}</span><span className="rv-tile-label">Decisions{s.ok < s.calls ? `, ${s.calls - s.ok} did not run` : ""}</span></span></span>
        <span className="rv-tile"><span className="rv-tile-icon"><Icon name="check" /></span><span><span className="rv-tile-count">{s.acted}</span><span className="rv-tile-label">Changed something or flagged</span></span></span>
        <span className="rv-tile"><span className="rv-tile-icon"><Icon name="refresh" /></span><span><span className="rv-tile-count">{s.avg_latency} ms</span><span className="rv-tile-label">Average answer time</span></span></span>
        <span className="rv-tile" data-tone="ok"><span className="rv-tile-icon"><Icon name="users" /></span><span><span className="rv-tile-count">${s.cost.toFixed(4)}</span><span className="rv-tile-label">Total cost</span></span></span>
      </div>

      <section className="rv-card">
        <div className="rv-card-h"><span>Did people agree with it</span><span className="muted font-normal">the gate's reading against what was done after</span></div>
        <div className="rv-brief">
          <div className="rv-brief-row"><span>Duplicates</span><span>{s.dup_flagged} flagged, {s.dup_withdrawn} then withdrawn{s.dup_flagged ? ` (${pct(s.dup_withdrawn / s.dup_flagged)})` : ""}</span></div>
          <div className="rv-brief-row"><span>Risk tier</span><span>{s.tier_disagreed} read differently from how they were filed, {s.tier_followed} then changed to the gate's tier{s.tier_disagreed ? ` (${pct(s.tier_followed / s.tier_disagreed)})` : ""}</span></div>
          <div className="rv-brief-row"><span>Debates</span><span>{s.debates_skipped} skipped on the gate's word. <Link href={`/reviews?run=${run}&tab=decided`}>Check the decided tab</Link> for any where a debate would have changed a vote; <code>sim replay-gate</code> sets the threshold from the record.</span></div>
        </div>
      </section>

      <section className="rv-card">
        <div className="rv-card-h"><span>Debate gate, checked against the record</span><span className="muted font-normal">{cal.rows.length} closed {cal.rows.length === 1 ? "review" : "reviews"} with positions and ballots</span></div>
        <p className="rv-hint" style={{ marginTop: 0 }}>Each gate says how likely a unanimous vote is before the debate. The dangerous case is a skip on a review where the debate moved a seat to the other side. The safe threshold for a gate is the lowest one that never skips such a review on this record; the gate acts at {THRESHOLD}.</p>
        {cal.rows.length === 0 ? <p className="muted">No closed reviews yet.</p> : (
          <>
            <div className="rv-brief">
              {cal.providers.map((name) => { const t = safeThreshold(cal.rows, name); return (
                <div key={name} className="rv-brief-row"><span>{name === "positions" ? "Positions reader (free)" : name === "jev" ? "Jev" : name}</span>
                  <span>{t ? <>Safe threshold on this record: <b>{t.threshold.toFixed(2)}</b>, which would skip {t.skips} of {t.of} debates{t.threshold > THRESHOLD ? <> <Chip tone="objection">above the {THRESHOLD} it acts at</Chip></> : null}{t.of < MIN_REVIEWS ? <> <Chip tone="wait">{t.of} of the {MIN_REVIEWS} reviews needed before this means anything</Chip></> : null}</> : "No readings yet"}</span></div>
              ); })}
            </div>
            <div className="rv-table-wrap"><table className="rv-table">
              <thead><tr><th>Review</th><th>Items</th>{cal.providers.map((n) => <th key={n}>{n} p(unanimous)</th>)}<th>Vote</th><th>Debate moved a seat</th><th>Debate</th></tr></thead>
              <tbody>
                {cal.rows.map((r) => (
                  <tr key={r.meeting_id}>
                    <td><Link href={`/reviews?run=${run}&tab=reviews&open=trail:${encodeURIComponent(r.meeting_id)}`}>{r.meeting_date}</Link><span className="block text-xs muted">{r.meeting_id.split("/").pop()}</span></td>
                    <td>{r.items}</td>
                    {cal.providers.map((n) => { const v = r.p[n]; return <td key={n}>{v == null ? <span className="muted">—</span> : <span className="rv-gt-p" data-tone={v >= THRESHOLD ? (r.moved ? "no" : "ok") : undefined}>{v.toFixed(2)}{v >= THRESHOLD ? (r.moved ? " would skip, wrongly" : " would skip") : ""}</span>}</td>; })}
                    <td>{r.unanimous ? <Chip tone="ok" dot>Unanimous</Chip> : <Chip plain>Split</Chip>}</td>
                    <td>{r.moved ? <Chip tone="wait">Yes</Chip> : <span className="muted">No</span>}</td>
                    <td>{r.skipped ? <Chip tone="ai">Skipped</Chip> : <span className="muted">Held</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </>
        )}
      </section>

      <section className="rv-card">
        <div className="rv-card-h"><span>Every decision</span><span className="muted font-normal">{rows.length} newest first</span></div>
        {rows.length === 0 ? <p className="muted">No gate has run yet. Submit a matter: the intake gate reads it the moment the worker picks it up.</p> : (
          <div className="rv-table-wrap"><table className="rv-table rv-gt">
            <thead><tr><th>When</th><th>Gate</th><th>About</th><th>What it read</th><th>What happened</th><th>Cost</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const answers = parse<Record<string, Answer>>(r.answers, {});
                const short = r.item_id?.split("/").pop();
                return (
                  <tr key={r.call_id}>
                    <td className="muted whitespace-nowrap">{when(r.created_at)}<span className="block text-xs">{r.latency_ms} ms</span></td>
                    <td><Chip plain>{PURPOSE[r.purpose] ?? r.purpose}</Chip></td>
                    <td>{r.item_id ? <Link href={`/matter?run=${run}&id=${encodeURIComponent(r.item_id)}`}>{short} {r.item_title}</Link> : r.meeting_id ? <span className="muted">Review {r.meeting_id.split("/").pop()}</span> : <span className="muted">—</span>}
                      {r.item_kind ? <span className="block text-xs muted">filed as {r.item_kind.replace(/_/g, " ")}{r.item_tier ? `, ${r.item_tier} risk` : ""}</span> : null}</td>
                    <td className="rv-gt-answers">{r.status === "ok" ? Object.entries(answers).map(([id, a]) => <AnswerView key={id} id={id} a={a} />) : <span className="muted">—</span>}
                      <Fold title="What it was shown"><pre className="rv-gt-state">{r.state.slice(0, 4000)}</pre></Fold></td>
                    <td><Acted row={r} /><Outcome row={r} /></td>
                    <td className="muted whitespace-nowrap">${r.cost_usd.toFixed(5)}<span className="block text-xs">{r.input_tokens} tok</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
