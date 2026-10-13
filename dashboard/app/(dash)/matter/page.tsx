import Link from "next/link";
import { visibleRuns } from "@/lib/auth/access";
import { first, type SearchParams } from "@/lib/params";
import { currentScope, matterStory, type Event } from "@/lib/queries/product";
import { voteHistory } from "@/lib/queries/votes";
import { VoteChart } from "@/components/vote-chart";
import { INTAKE_WORDS, STAGE_WORDS, type Stage } from "@/lib/lifecycle/stages";
import { KIND_LABELS } from "@/lib/reviews/model";
import { Chip, Icon, RiskChip } from "../reviews/parts";

const ICON: Record<string, string> = { submitted: "plus", cited: "flag", flagged: "alert", convened: "users", reviewed: "users", signed: "pen", sent_back: "refresh", applied: "check", stage: "chevron", owner: "pen", rereview: "refresh", ask: "chat", waiting: "pen" };

/** One matter, from the day it arrived to today: the page that answers "how did we get here". */
export default async function MatterPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const scope = await currentScope(first(sp, "run"), await visibleRuns());
  if (!scope) return <div className="rv"><h1 className="rv-org">No committee yet</h1></div>;
  const id = first(sp, "id") ?? "";
  const [{ item, events }, ballots] = await Promise.all([matterStory(scope.run_id, id), voteHistory(scope.run_id, id)]);
  const run = encodeURIComponent(scope.run_id);
  if (!item) return <div className="rv"><h1 className="rv-org">No such matter</h1><p className="muted mt-2"><Link href={`/reviews?run=${run}`}>Back to Reviews</Link></p></div>;
  const stage = item.stage as Stage | null;
  const status = String(item.status);
  const now = stage ? `${STAGE_WORDS[stage]}${item.review_due ? `, review due ${item.review_due}` : ""}` : (INTAKE_WORDS[status] ?? status.replace(/_/g, " "));
  const nowTone = stage ? (stage === "live" || stage === "approved" ? "ok" : stage === "retired" || stage === "paused" ? "wait" : "ai") : status === "approved" ? "ok" : status === "rejected" ? "no" : "wait";
  const last = events[events.length - 1];

  return (
    <div className="rv">
      <header className="rv-top">
        <div className="min-w-0">
          <Link href={`/reviews?run=${run}`} className="rv-back"><Icon name="chevron" className="rv-chev is-back" /> {scope.name}</Link>
          <h1 className="rv-org" style={{ marginTop: "0.2rem" }}>{String(item.title)}</h1>
          <div className="rv-rowmeta" style={{ marginTop: "0.4rem" }}>
            <Chip plain>{KIND_LABELS[String(item.kind)] ?? String(item.kind)}</Chip><RiskChip tier={item.risk_tier as string | null} /><Chip plain>{id.split("/").pop()}</Chip>
            {item.owner ? <Chip plain>Owner: {String(item.owner)}</Chip> : null}
          </div>
        </div>
        <div className="rv-top-actions">
          {status === "recommended" && last?.kind === "waiting" ? <Link href={last.href ?? "#"} className="rv-btn rv-btn-you">Decide</Link> : null}
          {String(item.kind) === "use_case" ? <Link href={`/portfolio?run=${run}&open=${encodeURIComponent(id)}`} className="rv-btn">Use case page</Link> : null}
        </div>
      </header>

      <section className="rv-card" data-tone={nowTone}>
        <div className="rv-card-h"><span>Where it is today</span><Chip tone={nowTone} dot>{now}</Chip></div>
        {last ? <p className="rv-prose">Last: {last.title.toLowerCase()}{last.who ? `, ${last.who}` : ""}, {last.when}.{last.href ? <> <Link href={last.href}>Open it</Link>.</> : null}</p> : null}
      </section>

      {ballots.length ? (
        <section className="rv-card">
          <div className="rv-card-h"><span>How the votes went</span><span className="muted font-normal">{ballots.length === 1 ? "one review" : `${ballots.length} reviews`}</span></div>
          <VoteChart reviews={ballots} />
        </section>
      ) : null}

      <section className="rv-card">
        <div className="rv-card-h"><span>How it got here</span><span className="muted font-normal">{events.length} {events.length === 1 ? "event" : "events"}, oldest first</span></div>
        <ol className="rv-story">
          {events.map((e: Event, i) => (
            <li key={i} className="rv-story-row" data-tone={e.tone ?? undefined}>
              <span className="rv-story-mark"><Icon name={ICON[e.kind] ?? "flag"} /></span>
              <div className="rv-story-body">
                <div className="rv-story-head">
                  <span className="rv-story-title">{e.title}</span>
                  <span className="rv-story-meta">{e.who ? `${e.who}, ` : ""}{e.when}</span>
                </div>
                {e.body ? <p className="rv-prose rv-story-text">{e.body}</p> : null}
                {e.href ? <Link href={e.href} className="rv-story-link">Read it <Icon name="chevron" className="rv-chev" /></Link> : null}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
