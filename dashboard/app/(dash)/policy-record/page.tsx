import Link from "next/link";
import { PolicyDiff } from "@/components/policy-diff";
import { first, href, type SearchParams } from "@/lib/params";
import { controlDelta, listControls } from "@/lib/policy-text";
import { currentScope, openPolicyMatters, policyHistory } from "@/lib/queries/product";
import { Chip, Drawer, Fold, Icon } from "../reviews/parts";
import { EscClose } from "../reviews/forms";

function parse<T>(raw: string | null | undefined, fallback: T): T {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * The customer's AI policy: what it says now, the numbered controls in it, and how it got here.
 * Changes to it arrive through intake as policy changes and exceptions, and land here once a
 * person has signed them, so this page reads and the Reviews page acts.
 */
export default async function PolicyRecordPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const scope = await currentScope(first(sp, "run"));
  if (!scope) return <div className="rv"><h1 className="rv-org">No committee yet</h1></div>;
  const [history, open] = await Promise.all([policyHistory(scope.run_id), openPolicyMatters(scope.run_id)]);
  const current = history[0];
  const controls = current ? parse<string[]>(current.controls, []) : [];
  const to = (o: Record<string, string | null>) => href("/policy-record", sp, o);
  const opened = first(sp, "open") ?? "";
  const closeHref = to({ open: null });

  let drawer = null;
  const [what, key] = opened.split(":");
  if (what === "version") {
    const i = history.findIndex((v) => v.git_sha === key);
    const v = history[i];
    const prev = history[i + 1];
    if (v) {
      const delta = controlDelta(prev ? parse<string[]>(prev.controls, []) : [], parse<string[]>(v.controls, []));
      drawer = (
        <Drawer wide closeHref={closeHref} title={`Policy as of ${v.sim_month}`} chips={<><Chip tone="ok">{v.control_count} controls</Chip><Chip plain>{v.word_count} words</Chip><Chip plain>{v.git_sha.slice(0, 8)}</Chip></>}>
          {delta.added.length || delta.removed.length ? (
            <section className="rv-card">
              <div className="rv-card-h">What changed in this version</div>
              <div className="flex flex-wrap gap-1.5">
                {delta.added.map((c) => <Chip key={c} tone="ok">+ {c}</Chip>)}
                {delta.removed.map((c) => <Chip key={c} tone="no">− {c}</Chip>)}
              </div>
            </section>
          ) : <p className="rv-hint">No controls were added or removed in this version.</p>}
          {prev ? <Fold title="Compare with the version before"><PolicyDiff before={prev.policy_text} after={v.policy_text} mode="lines" /></Fold> : null}
          <Fold title="Read the full text" open={!prev}><pre className="rv-prose" style={{ fontFamily: "inherit" }}>{v.policy_text}</pre></Fold>
        </Drawer>
      );
    }
  }

  return (
    <div className="rv">
      {drawer ? <EscClose href={closeHref} /> : null}
      <header className="rv-top">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="rv-org">AI policy</h1>
          <Chip plain>{scope.name}</Chip>
        </div>
        <Link href={`/reviews?run=${encodeURIComponent(scope.run_id)}&open=submit:policy_change`} className="rv-btn rv-btn-you"><Icon name="plus" /> Propose a change</Link>
      </header>

      <div className="rv-tiles">
        <span className="rv-tile" data-tone="ok"><span className="rv-tile-icon"><Icon name="check" /></span><span><span className="rv-tile-count">{controls.length}</span><span className="rv-tile-label">Numbered controls</span></span></span>
        <span className="rv-tile" data-tone="ai"><span className="rv-tile-icon"><Icon name="pen" /></span><span><span className="rv-tile-count">{history.length}</span><span className="rv-tile-label">Versions</span></span></span>
        <Link href={`/reviews?run=${encodeURIComponent(scope.run_id)}&tab=waiting`} className={`rv-tile${open.length ? " is-hot" : ""}`} data-tone="you"><span className="rv-tile-icon"><Icon name="inbox" /></span><span><span className="rv-tile-count">{open.length}</span><span className="rv-tile-label">Changes in progress</span></span></Link>
        <span className="rv-tile" data-tone="wait"><span className="rv-tile-icon"><Icon name="flag" /></span><span><span className="rv-tile-count">{current?.word_count ?? 0}</span><span className="rv-tile-label">Words</span></span></span>
      </div>

      <section className="rv-board">
        <nav className="rv-tabs" aria-label="Policy"><span className="rv-tab" aria-current="page">Current controls</span></nav>
        {!current ? (
          <div className="rv-empty"><span className="rv-empty-icon" data-tone="ai"><Icon name="pen" /></span><span>No policy yet. It grows as policy changes are reviewed and signed.</span></div>
        ) : controls.length === 0 ? (
          <div className="rv-empty"><span className="rv-empty-icon" data-tone="ai"><Icon name="pen" /></span><span>The policy has no numbered controls yet.</span></div>
        ) : (
          <div className="rv-rows">
            {listControls(current.policy_text).map((c, i) => (
              <div key={`${c.id}-${i}`} className="rv-rowline" style={{ cursor: "default" }}>
                <Chip tone="ok">{c.id}</Chip>
                <span className="min-w-0"><span className="rv-prose" style={{ whiteSpace: "normal" }}>{c.text}</span></span>
                <span />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rv-board">
        <nav className="rv-tabs" aria-label="History"><span className="rv-tab" aria-current="page">Versions<span className="rv-tab-count" data-tone="ai">{history.length}</span></span></nav>
        {history.length === 0 ? null : (
          <div className="rv-rows">
            {history.map((v, i) => {
              const prev = history[i + 1];
              const delta = controlDelta(prev ? parse<string[]>(prev.controls, []) : [], parse<string[]>(v.controls, []));
              return (
                <Link key={v.git_sha} href={to({ open: `version:${v.git_sha}` })} scroll={false} className="rv-rowline">
                  <span className="rv-riskmark" data-tone="ai" />
                  <span className="min-w-0">
                    <span className="rv-rowtitle">{v.sim_month}{i === 0 ? " (current)" : ""}</span>
                    <span className="rv-rowmeta">
                      <Chip plain>{v.control_count} controls</Chip>
                      {delta.added.length ? <Chip tone="ok">+{delta.added.length}</Chip> : null}
                      {delta.removed.length ? <Chip tone="no">−{delta.removed.length}</Chip> : null}
                    </span>
                  </span>
                  <span className="rv-rowend"><span className="is-wide">{v.git_sha.slice(0, 8)}</span><Icon name="chevron" className="rv-chev" /></span>
                </Link>
              );
            })}
          </div>
        )}
      </section>
      {drawer}
    </div>
  );
}
