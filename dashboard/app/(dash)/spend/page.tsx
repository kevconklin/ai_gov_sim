import Link from "next/link";
import { first, type SearchParams } from "@/lib/params";
import { currentScope, recentProblems, spendByModel, spendByMonth } from "@/lib/queries/product";
import { spendCap } from "@/lib/queries/governance";
import { Chip, Icon } from "../reviews/parts";

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); };

/** What the committee is costing and whether its models are answering. Reframed from the research Health page for one customer. */
export default async function SpendPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const scope = await currentScope(first(sp, "run"));
  if (!scope) return <div className="rv"><h1 className="rv-org">No committee yet</h1></div>;
  const thisMonth = new Date().toISOString().slice(0, 7);
  const [months, byModel, problems, cap] = await Promise.all([
    spendByMonth(scope.run_id), spendByModel(scope.run_id, thisMonth), recentProblems(scope.run_id), spendCap(scope.run_id),
  ]);
  const now = months.find((m) => m.month === thisMonth) ?? { month: thisMonth, calls: 0, cost: 0, failed: 0, retried: 0 };
  const used = cap ? Math.min(100, (now.cost / cap) * 100) : 0;
  const tone = cap && used >= 100 ? "no" : cap && used >= 80 ? "wait" : "ok";

  return (
    <div className="rv">
      <header className="rv-top">
        <div className="flex flex-wrap items-center gap-2.5"><h1 className="rv-org">Spend &amp; health</h1><Chip plain>{scope.name}</Chip></div>
        <Link href={`/reviews?run=${encodeURIComponent(scope.run_id)}&tab=settings&open=budget`} className="rv-btn">Change the budget</Link>
      </header>

      <div className="rv-tiles">
        <span className="rv-tile" data-tone={tone}><span className="rv-tile-icon"><Icon name="flag" /></span><span><span className="rv-tile-count">{usd(now.cost)}</span><span className="rv-tile-label">This month{cap ? ` of ${usd(cap)}` : ""}</span></span></span>
        <span className="rv-tile" data-tone="ai"><span className="rv-tile-icon"><Icon name="users" /></span><span><span className="rv-tile-count">{now.calls}</span><span className="rv-tile-label">Model calls this month</span></span></span>
        <span className={`rv-tile${now.failed ? " is-hot" : ""}`} data-tone={now.failed ? "no" : "ok"}><span className="rv-tile-icon"><Icon name="alert" /></span><span><span className="rv-tile-count">{now.failed}</span><span className="rv-tile-label">Failed this month</span></span></span>
        <span className="rv-tile" data-tone="wait"><span className="rv-tile-icon"><Icon name="refresh" /></span><span><span className="rv-tile-count">{now.retried}</span><span className="rv-tile-label">Needed a retry</span></span></span>
      </div>

      {cap ? (
        <div className="rv-riskbar">
          <span>Budget used</span>
          <span className="rv-riskbar-track" role="img" aria-label={`${Math.round(used)}% of the monthly budget used`}><span data-tone={tone} style={{ flex: used }} /><span style={{ flex: 100 - used }} /></span>
          <span className="rv-key" data-tone={tone}>{Math.round(used)}%</span>
          {used >= 100 ? <span className="rv-key" data-tone="no">Reviews are refused until the budget is raised or the month ends</span> : null}
        </div>
      ) : null}

      <section className="rv-board">
        <nav className="rv-tabs" aria-label="By model"><span className="rv-tab" aria-current="page">By model, this month</span></nav>
        {byModel.length === 0 ? <div className="rv-empty"><span className="rv-empty-icon" data-tone="ai"><Icon name="users" /></span><span>No model calls yet this month.</span></div> : (
          <div className="rv-rows">
            {byModel.map((m) => (
              <div key={m.model} className="rv-rowline" style={{ cursor: "default" }}>
                <span className="rv-riskmark" data-tone={m.failed ? "no" : "ai"} />
                <span className="min-w-0"><span className="rv-rowtitle">{m.model}</span><span className="rv-rowmeta"><Chip plain>{m.calls} calls</Chip>{m.failed ? <Chip tone="no">{m.failed} failed</Chip> : null}</span></span>
                <span className="rv-rowend"><strong>{usd(m.cost)}</strong></span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rv-board">
        <nav className="rv-tabs" aria-label="Months"><span className="rv-tab" aria-current="page">Month by month</span></nav>
        <div className="rv-rows">
          {months.map((m) => (
            <div key={m.month} className="rv-rowline" style={{ cursor: "default" }}>
              <span className="rv-riskmark" data-tone="ai" />
              <span className="min-w-0"><span className="rv-rowtitle">{m.month}</span><span className="rv-rowmeta"><Chip plain>{m.calls} calls</Chip>{m.failed ? <Chip tone="no">{m.failed} failed</Chip> : null}{m.retried ? <Chip tone="wait">{m.retried} retried</Chip> : null}</span></span>
              <span className="rv-rowend"><strong>{usd(m.cost)}</strong></span>
            </div>
          ))}
        </div>
      </section>

      <section className="rv-board">
        <nav className="rv-tabs" aria-label="Problems"><span className="rv-tab" aria-current="page">Problems<span className="rv-tab-count" data-tone={problems.length ? "no" : undefined}>{problems.length}</span></span></nav>
        {problems.length === 0 ? <div className="rv-empty"><span className="rv-empty-icon" data-tone="ok"><Icon name="check" /></span><span>Every model call has answered first time.</span></div> : (
          <div className="rv-rows">
            {problems.map((p) => (
              <Link key={p.call_id} href={`/logs?call=${encodeURIComponent(p.call_id)}`} className="rv-rowline">
                <span className="rv-riskmark" data-tone={p.status === "ok" ? "wait" : "no"} />
                <span className="min-w-0"><span className="rv-rowtitle">{p.error ?? `Answered on attempt ${p.attempt}`}</span><span className="rv-rowmeta"><Chip plain>{p.model}</Chip><Chip plain>{p.purpose.replace(/_/g, " ")}</Chip></span></span>
                <span className="rv-rowend"><span className="is-wide">{when(p.created_at)}</span><Icon name="chevron" className="rv-chev" /></span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
