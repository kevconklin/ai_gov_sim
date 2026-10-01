import Link from "next/link";
import { atLeast, orgRole, visibleRuns } from "@/lib/auth/access";
import { first, href, type SearchParams } from "@/lib/params";
import { currentScope, rereviewsOf, stageHistory, useCases, type UseCaseRow } from "@/lib/queries/product";
import { dueSoon, INTAKE_WORDS, isOverdue, STAGE_HINT, STAGE_TONE, STAGE_WORDS, STAGES, type Stage } from "@/lib/lifecycle/stages";
import { EscClose } from "../reviews/forms";
import { Chip, Drawer, Help, Icon, RiskChip } from "../reviews/parts";
import { MoveStageForm, OwnerForm } from "./forms";

const who = (actor: string | null) => (actor ?? "").replace(/ <.*>$/, "");

/** Every AI use case across its life: waiting, with the committee, approved, building, piloting, live, paused, retired. */
export default async function PortfolioPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const scope = await currentScope(first(sp, "run"), await visibleRuns());
  if (!scope) return <div className="rv"><h1 className="rv-org">No committee yet</h1></div>;
  const [rows, role] = await Promise.all([useCases(scope.run_id), orgRole(scope.run_id)]);
  const canMove = atLeast(role, "decides");
  const today = new Date().toISOString().slice(0, 10);
  const run = encodeURIComponent(scope.run_id);
  const to = (o: Record<string, string | null>) => href("/portfolio", sp, o);
  const closeHref = to({ open: null });

  const before = rows.filter((r) => !r.stage);                         // no life yet: waiting, in review, or refused
  const inStage = (s: Stage) => rows.filter((r) => r.stage === s);
  const live = inStage("live").length;
  const building = inStage("building").length + inStage("piloting").length;
  const overdue = rows.filter((r) => r.stage && r.stage !== "retired" && r.stage !== "paused" && isOverdue(r.review_due, today)).length;
  const deciding = before.filter((r) => r.status === "recommended").length;

  const row = (r: UseCaseRow) => {
    const stage = r.stage as Stage | null;
    const late = stage && isOverdue(r.review_due, today);
    const soon = stage && dueSoon(r.review_due, today);
    return (
      <Link key={r.item_id} href={to({ open: r.item_id })} scroll={false} className="rv-rowline">
        <span className="rv-riskmark" data-tone={stage ? (late ? "no" : STAGE_TONE[stage] === "plain" ? undefined : STAGE_TONE[stage]) : r.status === "rejected" ? "no" : "wait"} />
        <span className="min-w-0">
          <span className="rv-rowtitle">{r.title}</span>
          <span className="rv-rowmeta">
            {late ? <Chip tone="no" dot>Review overdue</Chip> : soon ? <Chip tone="wait" dot>Review due {r.review_due}</Chip> : stage ? <RiskChip tier={r.risk_tier} /> : <Chip tone={r.status === "rejected" ? "no" : "wait"} dot>{INTAKE_WORDS[r.status] ?? r.status}</Chip>}
            <span className="muted text-xs">{r.owner ?? "No owner yet"}</span>
          </span>
        </span>
        <span className="rv-rowend"><span className="is-wide muted text-xs">{stage ? `${STAGE_WORDS[stage]} since ${r.stage_changed_on}` : `Submitted ${r.submitted_on}`}</span><Icon name="chevron" className="rv-chev" /></span>
      </Link>
    );
  };

  let drawer = null;
  const openId = first(sp, "open");
  const uc = openId ? rows.find((r) => r.item_id === openId) : undefined;
  if (uc) {
    const [history, rereviews] = await Promise.all([stageHistory(uc.item_id), rereviewsOf(scope.run_id, uc.item_id)]);
    const stage = uc.stage as Stage | null;
    const late = stage && isOverdue(uc.review_due, today);
    drawer = (
      <Drawer closeHref={closeHref} title={uc.title} chips={<><RiskChip tier={uc.risk_tier} />{stage ? <Chip tone={STAGE_TONE[stage] === "plain" ? undefined : STAGE_TONE[stage]} plain={STAGE_TONE[stage] === "plain"} dot>{STAGE_WORDS[stage]}</Chip> : <Chip tone="wait" dot>{INTAKE_WORDS[uc.status] ?? uc.status}</Chip>}<Chip plain>{uc.item_id.split("/").pop()}</Chip></>}>
        <p className="rv-prose">{uc.description}</p>
        <section className="rv-card">
          <dl className="rv-facts">
            <dt>Owner</dt><dd>{uc.owner ?? <span className="muted">Nobody yet</span>}</dd>
            <dt>Submitted</dt><dd>{uc.submitted_on} by {who(uc.submitted_by)}</dd>
            {uc.last_attestation ? <><dt>Decision</dt><dd><Link href={`/reviews?run=${run}&tab=decided&open=record:${encodeURIComponent(uc.last_attestation)}`}>{uc.last_outcome} by {who(uc.last_actor)}{uc.decided_on ? `, ${uc.decided_on}` : ""}</Link></dd></> : null}
            {stage ? <><dt>Next review</dt><dd>{uc.review_due ? <>{uc.review_due}{late ? <Chip tone="no" dot>Overdue</Chip> : null}</> : "Not set"}</dd></> : null}
            {rereviews.length ? <><dt>Re-reviews</dt><dd className="flex flex-wrap gap-1.5">{rereviews.map((x) => <Link key={x.item_id} href={`/reviews?run=${run}&tab=waiting&open=matter:${encodeURIComponent(x.item_id)}`} className="rv-chip" data-tone="ai">{x.submitted_on}: {INTAKE_WORDS[x.status] ?? x.status}</Link>)}</dd></> : null}
          </dl>
          {stage ? <p className="rv-hint">{STAGE_HINT[stage]}{late ? " It is overdue: the next ranking of Waiting opens its re-review." : ""}</p> : <p className="rv-hint">Its life begins when a person signs an approval. Until then it is a matter under Reviews.</p>}
        </section>
        {history.length ? (
          <section className="rv-card">
            <div className="rv-card-h">What has happened</div>
            <div className="rv-start">
              {history.map((h, i) => (
                <div key={i} className="rv-start-row" style={{ alignItems: "flex-start" }}>
                  <span className="rv-start-mark" data-done="true" aria-hidden>✓</span>
                  <span className="min-w-0"><span className="rv-start-title">{h.from_stage && h.from_stage !== h.to_stage ? `${STAGE_WORDS[h.from_stage as Stage] ?? h.from_stage} to ${STAGE_WORDS[h.to_stage as Stage] ?? h.to_stage}` : STAGE_WORDS[h.to_stage as Stage] ?? h.to_stage}</span><span className="rv-start-text">{h.changed_on}, {who(h.changed_by)}: {h.note}</span></span>
                </div>
              ))}
            </div>
          </section>
        ) : null}
        {stage && canMove ? <section className="rv-card" data-tone="you"><div className="rv-card-h">Move it</div><MoveStageForm runId={scope.run_id} itemId={uc.item_id} stage={stage} /></section> : null}
        {canMove ? <section className="rv-card"><div className="rv-card-h">Owner</div><OwnerForm runId={scope.run_id} itemId={uc.item_id} owner={uc.owner} /></section>
          : <p className="rv-hint">Someone who decides for this organization can move it or set its owner.</p>}
      </Drawer>
    );
  }

  const groups: [string, UseCaseRow[], string][] = [
    ["Not yet approved", before, "Waiting for review, with the committee, waiting for a decision, or not approved."],
    ...STAGES.map((s): [string, UseCaseRow[], string] => [STAGE_WORDS[s], inStage(s), STAGE_HINT[s]]),
  ];

  return (
    <div className="rv">
      {drawer}
      {drawer ? <EscClose href={closeHref} /> : null}
      <header className="rv-top">
        <div className="flex flex-wrap items-center gap-2.5"><h1 className="rv-org">Use cases</h1><Chip plain>{scope.name}</Chip><Help><p><strong>Every AI use case, across its life.</strong> Its life begins when a person signs an approval. Move it as work happens; it comes back for review every 6, 12, or 24 months by risk.</p></Help></div>
        <Link href={`/reviews?run=${run}&open=submit:use_case`} className="rv-btn rv-btn-you"><Icon name="plus" /> Propose a use case</Link>
      </header>
      <div className="rv-tiles">
        <span className="rv-tile" data-tone="ok"><span className="rv-tile-icon"><Icon name="check" /></span><span><span className="rv-tile-count">{live}</span><span className="rv-tile-label">Live</span></span></span>
        <span className="rv-tile" data-tone="ai"><span className="rv-tile-icon"><Icon name="refresh" /></span><span><span className="rv-tile-count">{building}</span><span className="rv-tile-label">In progress</span></span></span>
        <span className={`rv-tile${overdue ? " is-hot" : ""}`} data-tone={overdue ? "no" : "ok"}><span className="rv-tile-icon"><Icon name="alert" /></span><span><span className="rv-tile-count">{overdue}</span><span className="rv-tile-label">{overdue === 1 ? "Review overdue" : "Reviews overdue"}</span></span></span>
        <Link href={`/reviews?run=${run}&tab=needs`} className={`rv-tile${deciding ? " is-hot" : ""}`} data-tone="you"><span className="rv-tile-icon"><Icon name="pen" /></span><span><span className="rv-tile-count">{deciding}</span><span className="rv-tile-label">To sign</span></span></Link>
      </div>
      {groups.map(([title, list, hint]) => (
        list.length ? (
          <section key={title} className="rv-board">
            <nav className="rv-tabs" aria-label={title}><span className="rv-tab" aria-current="page">{title}<span className="rv-tab-count">{list.length}</span></span><span className="rv-lead"><Help right><p>{hint}</p></Help></span></nav>
            <div className="rv-rows">{list.map(row)}</div>
          </section>
        ) : null
      ))}
      {rows.length === 0 ? <div className="rv-empty"><span className="rv-empty-icon" data-tone="you"><Icon name="inbox" /></span><span>No use case yet. <Link href={`/reviews?run=${run}&open=submit:use_case`}>Propose one</Link>: what you want to do with AI, who it affects, and who owns it.</span></div> : null}
    </div>
  );
}
