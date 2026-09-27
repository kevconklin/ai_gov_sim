import Link from "next/link";
import { first, type SearchParams } from "@/lib/params";
import { currentScope, openAsks, recentAsks, unansweredCount } from "@/lib/queries/product";
import { describeWork } from "@/lib/reviews/model";
import { AutoRefresh } from "../reviews/forms";
import { Chip, Icon } from "../reviews/parts";
import { AskForm, SendToCommittee } from "./ask-forms";

function parseControls(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function errorOf(result: string | null): string {
  try {
    const v = JSON.parse(result ?? "{}");
    return String(v?.error ?? v?.message ?? result ?? "No reason was recorded.");
  } catch {
    return result ?? "No reason was recorded.";
  }
}

function questionOf(payload: string | null): string {
  try {
    return String(JSON.parse(payload ?? "{}")?.question ?? "");
  } catch {
    return "";
  }
}

export default async function AskPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const scope = await currentScope(first(sp, "run"));
  if (!scope) return <div className="rv"><h1 className="rv-org">No committee yet</h1></div>;
  const [asks, work, unanswered] = await Promise.all([recentAsks(scope.run_id), openAsks(scope.run_id), unansweredCount(scope.run_id)]);
  const pending = work.filter((w) => w.status !== "failed");
  const failed = work.filter((w) => w.status === "failed");
  const run = encodeURIComponent(scope.run_id);
  const covered = asks.filter((a) => Boolean(a.covered)).length;

  return (
    <div className="rv">
      <AutoRefresh active={pending.length > 0} />
      <header className="rv-top">
        <div className="flex flex-wrap items-center gap-2.5"><h1 className="rv-org">Ask</h1><Chip plain>{scope.name}</Chip></div>
        <span className="flex gap-2"><Link href={`/approved?run=${run}`} className="rv-btn">Approved tools</Link><Link href={`/policy-record?run=${run}`} className="rv-btn">Read the policy</Link></span>
      </header>

      <section className="rv-card" data-tone="you"><AskForm runId={scope.run_id} /></section>

      {pending.map((w) => (
        <div key={w.command_id} className="rv-banner" data-tone="ai" aria-live="polite"><span className="rv-dot is-live" /><span>{describeWork(w.kind, w.payload)}{questionOf(w.payload) ? `: “${questionOf(w.payload)}”` : ""}…</span></div>
      ))}
      {failed.map((w) => (
        <div key={w.command_id} className="rv-banner" data-tone="no"><Icon name="alert" /><span className="flex-1">{describeWork(w.kind, w.payload)} did not go through: {errorOf(w.result)}</span></div>
      ))}

      <div className="rv-tiles">
        <span className="rv-tile" data-tone="ai"><span className="rv-tile-icon"><Icon name="chat" /></span><span><span className="rv-tile-count">{asks.length}</span><span className="rv-tile-label">Questions asked</span></span></span>
        <span className="rv-tile" data-tone="ok"><span className="rv-tile-icon"><Icon name="check" /></span><span><span className="rv-tile-count">{covered}</span><span className="rv-tile-label">Answered by the policy</span></span></span>
        <Link href={`/reviews?run=${run}&tab=waiting`} className={`rv-tile${unanswered ? " is-hot" : ""}`} data-tone={unanswered ? "wait" : "ok"}><span className="rv-tile-icon"><Icon name="inbox" /></span><span><span className="rv-tile-count">{unanswered}</span><span className="rv-tile-label">{unanswered === 1 ? "Gap the committee has not heard" : "Gaps the committee has not heard"}</span></span></Link>
      </div>

      <section className="rv-board">
        <nav className="rv-tabs" aria-label="Questions"><span className="rv-tab" aria-current="page">Questions and answers</span></nav>
        {asks.length === 0 && pending.length === 0 ? (
          <div className="rv-empty"><span className="rv-empty-icon" data-tone="ai"><Icon name="chat" /></span><span>Nothing has been asked yet. The first answer takes a few seconds.</span></div>
        ) : (
          <div className="rv-asks">
            {asks.map((a) => {
              const controls = parseControls(a.controls);
              const isCovered = Boolean(a.covered);
              return (
                <article key={a.ask_id} className="rv-askcard" data-tone={isCovered ? "ok" : a.item_id ? "ai" : "wait"}>
                  <div className="rv-askq">
                    <span className="rv-riskmark" data-tone={isCovered ? "ok" : "wait"} />
                    <span className="min-w-0">
                      <span className="rv-rowtitle">{a.question}</span>
                      <span className="rv-rowmeta"><Chip plain>{a.asked_by}</Chip><Chip plain>{a.asked_at}</Chip>
                        {isCovered ? <Chip tone="ok" dot>Answered by the policy</Chip> : <Chip tone="wait" dot>Not covered</Chip>}
                        {a.item_id ? <Chip tone="ai">With the committee</Chip> : null}
                      </span>
                    </span>
                  </div>
                  <div className="rv-aska">
                    <p className="rv-prose" style={{ whiteSpace: "pre-wrap" }}>{a.answer}</p>
                    <div className="rv-askfoot">
                      <span className="flex flex-wrap items-center gap-1.5">
                        {controls.map((c) => <Link key={c} href={`/policy-record?run=${run}#${c}`} className="rv-chip" data-tone="ok">{c}</Link>)}
                        {!controls.length ? <span className="rv-hint" style={{ marginTop: 0 }}>No control cited.</span> : null}
                      </span>
                      {a.item_id ? <Link href={`/reviews?run=${run}&open=matter:${encodeURIComponent(a.item_id)}`} className="rv-btn rv-btn-sm">See it in Waiting</Link>
                        : <SendToCommittee runId={scope.run_id} askId={a.ask_id} />}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
