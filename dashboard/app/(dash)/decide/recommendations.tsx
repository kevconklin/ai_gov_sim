"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { ControlResult } from "@/lib/control/submit";
import type { RecommendationRow } from "@/lib/queries/governance";
import { addDocumentAction } from "../reviews/actions";

const KIND_WORDS: Record<string, string> = { owner: "Who should own it", condition: "Conditions for approval", document: "Documents to adopt", policy_wording: "Policy wording to propose", follow_up: "Follow-ups" };
const ORDER = ["owner", "condition", "document", "policy_wording", "follow_up"];

function AdoptDocument({ runId, rec, canRun }: { runId: string; rec: RecommendationRow; canRun: boolean }) {
  const [state, action, pending] = useActionState(addDocumentAction, null);
  if (!canRun) return null;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="run_id" value={runId} />
      <input type="hidden" name="kind" value="standard" />
      <input type="hidden" name="title" value={rec.title.replace(/^Adopt (an? )?/i, "")} />
      <input type="hidden" name="body" value={rec.body} />
      <input type="hidden" name="why" value={`Recommended by the ${rec.seat_title} on ${rec.item_id}; adopted as drafted.`} />
      <button className="rv-btn rv-btn-sm" type="submit" disabled={pending || Boolean(state?.success)}>{state?.success ? "Added to documents" : pending ? "Adding…" : "Adopt as a document"}</button>
      {state && !state.success ? <span className="rv-said is-bad" style={{ marginTop: 0 }}>{(state as ControlResult & { error: string }).error}</span> : null}
    </form>
  );
}

/** The committee's recommendations on one matter, grouped, each with the one thing a person can do about it. */
export function Recommendations({ runId, itemId, rows, canRun, canDecide }: { runId: string; itemId: string; rows: RecommendationRow[]; canRun: boolean; canDecide: boolean }) {
  const onUseConditions = canDecide ? (text: string) => window.dispatchEvent(new CustomEvent("rv:fill-reasoning", { detail: text })) : undefined;
  if (!rows.length) return null;
  const run = encodeURIComponent(runId);
  const groups = ORDER.map((k) => [k, rows.filter((r) => r.kind === k)] as const).filter(([, list]) => list.length);
  const conditions = rows.filter((r) => r.kind === "condition");
  return (
    <section className="rv-card" data-tone="ai">
      <div className="rv-card-h"><span>What the committee recommends you do</span><span className="muted font-normal">{rows.length} {rows.length === 1 ? "recommendation" : "recommendations"}</span></div>
      <div className="rv-recs">
        {groups.map(([kind, list]) => (
          <div key={kind} className="rv-rec-group">
            <div className="rv-seat-label">{KIND_WORDS[kind] ?? kind}</div>
            {list.map((r) => (
              <article key={r.rec_id} className="rv-rec">
                <div className="rv-rec-title">{r.title}<span className="rv-brief-who">{r.seat_title}{r.due ? `, by ${r.due}` : ""}</span></div>
                <p className="rv-prose">{r.body}</p>
                <div className="rv-rec-act">
                  {kind === "document" ? <AdoptDocument runId={runId} rec={r} canRun={canRun} /> : null}
                  {kind === "policy_wording" ? <Link href={`/reviews?run=${run}&open=submit:policy_change&title=${encodeURIComponent(r.title)}&text=${encodeURIComponent(r.body)}&cite=${encodeURIComponent(itemId)}`} className="rv-btn rv-btn-sm">Propose this wording</Link> : null}
                  {kind === "owner" ? <span className="rv-hint" style={{ marginTop: 0 }}>Name them when you sign; for a use case, set the owner on its page after approval.</span> : null}
                </div>
              </article>
            ))}
          </div>
        ))}
      </div>
      {conditions.length && onUseConditions ? (
        <button type="button" className="rv-btn rv-btn-sm" style={{ marginTop: "0.6rem" }}
          onClick={() => onUseConditions("Approved on these conditions:\n" + conditions.map((c, i) => `${i + 1}. ${c.title}: ${c.body}`).join("\n"))}>
          Use these conditions in my reasoning
        </button>
      ) : null}
    </section>
  );
}
