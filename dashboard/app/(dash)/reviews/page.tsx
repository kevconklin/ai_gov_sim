import Link from "next/link";
import type { ReactNode } from "react";
import { currentOperator } from "@/lib/auth/session";
import { BANK_LABELS } from "@/lib/constants";
import { first, href, type SearchParams } from "@/lib/params";
import {
  ballotsToSign,
  changeLog,
  committeeSeats,
  documentsInForce,
  panelOverrides,
  spendCap,
  decisionsToSign,
  latestCandidates,
  openWork,
  orgProfile,
  recentAttestations,
  recentSyntheses,
  reviewScopes,
  waitingMatters,
  type ScopeRow,
} from "@/lib/queries/governance";
import { AREA_LABELS, FRAMEWORK_LABELS, KIND_LABELS, PROFILE_LABELS, ageOf, benchFor, changeTitle, describeWork, firstSentence, mergeQueue, plural, tally, type Ranking } from "@/lib/reviews/model";
import { AutoRefresh, BriefForm, EscClose, RefreshRanking, SignDecision, WaitingRows, WorkspacePicker, type Scope } from "./forms";
import { SubmitMatterForm } from "./intake-form";
import { AddDocumentForm, BudgetForm, NewCustomerForm, PanelForm, ProfileFieldForm, RetireDocumentForm } from "./settings-forms";
import { Avatar, Chip, Drawer, Fold, Help, Icon, KindChip, RiskChip, SeatVotes, VoteBar } from "./parts";

function parse<T>(raw: string | null | undefined, fallback: T): T {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function scopeLabel(s: ScopeRow): string {
  if (s.condition === "workspace") return s.org_name ?? s.experiment_name;
  return `${BANK_LABELS[s.bank_id] ?? s.bank_id}, ${s.condition} (${s.experiment_name})`;
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function errorOf(result: string | null): string {
  return (parse<{ error?: string }>(result, {}).error ?? "It did not go through.").replace(/^\w+(Error|Invalid): /, "");
}

const STALE_MS = 45_000;
const OUTCOME: Record<string, [string, string | undefined]> = { approved: ["Approved", "ok"], rejected: ["Rejected", "no"], deferred: ["Deferred", undefined] };
type Tab = "needs" | "waiting" | "decided" | "advice" | "committee" | "settings" | "changes";
const PANEL_KINDS = ["use_case", "tool", "vendor", "policy_change", "exception", "incident"] as const;
const PROFILE_FIELDS: [string, "short" | "long" | "framework"][] = [["name", "short"], ["risk_appetite", "long"], ["framework", "framework"], ["facts", "long"], ["business_goals", "long"], ["ai_tools", "long"], ["ai_landscape", "long"]];

function EmptyState({ icon, tone, children }: { icon: string; tone: string; children: ReactNode }) {
  return (
    <div className="rv-empty">
      <span className="rv-empty-icon" data-tone={tone}><Icon name={icon} /></span>
      <span>{children}</span>
    </div>
  );
}

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const scopes = await reviewScopes();
  if (scopes.length === 0) {
    return (
      <div className="rv">
        <h1 className="rv-org">No committee yet</h1>
        <p className="muted mt-2">Create one, then reload: <code>python -m sim workspace --name &quot;Your organisation&quot; --risk-appetite &quot;…&quot;</code></p>
      </div>
    );
  }
  const scope = scopes.find((s) => s.run_id === first(sp, "run")) ?? scopes[0]!;
  const runId = scope.run_id;

  const [operator, org, decisions, ballots, waiting, ranked, work, syntheses, record, seats, docs, panels, changes, cap] = await Promise.all([
    currentOperator(),
    orgProfile(runId),
    decisionsToSign(runId),
    ballotsToSign(runId),
    waitingMatters(runId),
    latestCandidates(runId),
    openWork(runId),
    recentSyntheses(runId),
    recentAttestations(runId),
    committeeSeats(runId),
    documentsInForce(runId),
    panelOverrides(runId),
    changeLog(runId),
    spendCap(runId),
  ]);

  const order = parse<string[]>(org?.seats, []);
  const committee = [...seats].sort((a, b) => (order.indexOf(a.seat) + 1 || 99) - (order.indexOf(b.seat) + 1 || 99));
  const seatIndex = new Map(committee.map((c, i) => [c.seat, i]));
  const titleOf = (seat: string) => committee.find((c) => c.seat === seat)?.title ?? seat.replace(/_/g, " ");
  const ranking = parse<{ candidates?: Ranking[] }>(JSON.stringify(ranked?.result ?? {}), {}).candidates ?? [];
  const queue = mergeQueue(waiting, ranking);
  const pending = work.filter((w) => w.status !== "failed");
  const failed = work.filter((w) => w.status === "failed");
  const reviewing = pending.filter((w) => w.kind === "convene").length;
  const stale = pending.some((w) => Date.now() - new Date(w.created_at).getTime() > STALE_MS);
  const settled = record.filter((r) => r.outcome !== "deferred");
  const overrides = settled.filter((r) => r.outcome !== r.recommended).length;

  const wanted = first(sp, "tab") as Tab | undefined;
  const tab: Tab = wanted && ["needs", "waiting", "decided", "advice", "committee", "settings", "changes"].includes(wanted)
    ? wanted : decisions.length ? "needs" : queue.length ? "waiting" : "decided";
  const open = first(sp, "open") ?? "";
  const to = (overrides_: Record<string, string | null>) => href("/reviews", sp, overrides_);
  const closeHref = to({ open: null });
  const scopeOptions: Scope[] = scopes.map((s) => ({ run_id: s.run_id, label: scopeLabel(s), workspace: s.condition === "workspace" }));

  const openRisk = [...queue.map((q) => q.risk_tier), ...decisions.map((d) => d.risk_tier)];
  const riskCount = (tier: string | null) => openRisk.filter((t) => t === tier).length;
  const tiles: { tab: Tab; tone: string; icon: string; count: number; label: string }[] = [
    { tab: "needs", tone: "you", icon: "pen", count: decisions.length, label: decisions.length === 1 ? "Needs your decision" : "Need your decision" },
    { tab: "waiting", tone: "wait", icon: "inbox", count: queue.length, label: "Waiting for review" },
    { tab: "needs", tone: "ai", icon: "users", count: reviewing, label: "With the committee" },
    { tab: "decided", tone: "ok", icon: "check", count: record.length, label: "Signed" },
  ];
  const tabs: { id: Tab; label: string; count: number; tone: string }[] = [
    { id: "needs", label: "Needs you", count: decisions.length, tone: "you" },
    { id: "waiting", label: "Waiting", count: queue.length, tone: "wait" },
    { id: "decided", label: "Signed", count: record.length, tone: "ok" },
    { id: "advice", label: "Advice", count: syntheses.length, tone: "ai" },
    { id: "committee", label: "Committee", count: committee.length, tone: "ai" },
    { id: "settings", label: "Settings", count: docs.length + panels.length, tone: "you" },
    { id: "changes", label: "Changes", count: changes.length, tone: "you" },
  ];
  const profileValue = (field: string): string | null => (org ? ((org as unknown as Record<string, string | null>)[field] ?? null) : null);
  const shown = (field: string): string => field === "framework" ? (FRAMEWORK_LABELS[profileValue(field) ?? "none"] ?? "None chosen") : (profileValue(field) ?? "");
  const panelFor = (kind: string): string[] | null => { const row = panels.find((x) => x.kind === kind && x.risk_tier === "*"); return row ? parse<string[]>(row.seats, []) : null; };

  // ---- the drill-down ----------------------------------------------------------------------
  let drawer: ReactNode = null;
  const [what, ...rest] = open.split(":");
  const key = rest.join(":");

  if (what === "submit") {
    drawer = (
      <Drawer closeHref={closeHref} title={key === "question" ? "Ask the committee" : "Submit a matter"} chips={<Chip tone="you">It joins Waiting</Chip>}>
        <SubmitMatterForm runId={runId} preset={key || undefined} />
      </Drawer>
    );
  } else if (what === "customer") {
    drawer = <Drawer closeHref={closeHref} title="Add a customer" chips={<Chip tone="ai">Gets a committee of eight AI advisers</Chip>}><NewCustomerForm /></Drawer>;
  } else if (what === "setting" && org) {
    const spec = PROFILE_FIELDS.find(([f]) => f === key);
    if (spec) {
      drawer = (
        <Drawer closeHref={closeHref} title={PROFILE_LABELS[key] ?? key} chips={<Chip tone="you">Organisation</Chip>}>
          {shown(key) ? <section className="rv-card"><div className="rv-card-h">Now</div><p className="rv-prose">{shown(key)}</p></section> : null}
          <ProfileFieldForm runId={runId} field={key} value={profileValue(key)} kind={spec[1]} />
        </Drawer>
      );
    }
  } else if (what === "document") {
    const doc = docs.find((x) => x.document_id === key);
    drawer = key === "new" ? (
      <Drawer closeHref={closeHref} title="Add a governing document" chips={<Chip tone="ai">The committee can read and cite it</Chip>}><AddDocumentForm runId={runId} /></Drawer>
    ) : doc ? (
      <Drawer closeHref={closeHref} title={doc.title} chips={<><Chip plain>{doc.kind.replace(/_/g, " ")}</Chip><Chip tone="ok" dot>In force</Chip></>}>
        <p className="rv-hint" style={{ marginTop: 0 }}>Added by {doc.added_by}, {when(doc.added_at)}</p>
        <Fold title="Read it"><p className="rv-prose">{doc.body}</p></Fold>
        <Fold title="Retire this document"><RetireDocumentForm runId={runId} documentId={doc.document_id} /></Fold>
      </Drawer>
    ) : null;
  } else if (what === "panel" && (PANEL_KINDS as readonly string[]).includes(key)) {
    drawer = (
      <Drawer closeHref={closeHref} title={`Who reviews: ${KIND_LABELS[key] ?? key}`} chips={<Chip tone="ai">Review panel</Chip>}>
        <PanelForm runId={runId} kind={key} seats={committee.map((c) => ({ seat: c.seat, title: c.title }))} chosen={panelFor(key)} />
      </Drawer>
    );
  } else if (what === "budget") {
    drawer = <Drawer closeHref={closeHref} title="Monthly budget" chips={<Chip tone="you">Budget</Chip>}><BudgetForm runId={runId} current={cap} /></Drawer>;
  } else if (what === "change") {
    const c = changes.find((x) => x.change_id === key);
    if (c) {
      drawer = (
        <Drawer closeHref={closeHref} title={changeTitle(c.area, c.target)} chips={<><Chip tone="you">{AREA_LABELS[c.area] ?? c.area}</Chip><Chip plain>{when(c.changed_at)}</Chip></>}>
          <section className="rv-card" data-tone="you">
            <div className="rv-card-h"><span className="inline-flex items-center gap-2"><Avatar name={c.actor} you /> {c.actor}</span></div>
            <p className="rv-prose">{c.reason}</p>
            <p className="rv-hint">{c.source === "dashboard_session" ? "Signed in here under this name." : c.source === "cli_asserted" ? "Name given at the command line, not verified." : "How this name was established was not recorded."}</p>
          </section>
          <div className="rv-diff">
            <div className="rv-diff-side" data-tone="no"><span className="rv-diff-tag">Before</span><p className="rv-prose">{c.before_value ?? "Nothing set"}</p></div>
            <div className="rv-diff-side" data-tone="ok"><span className="rv-diff-tag">After</span><p className="rv-prose">{c.after_value ?? "Nothing set"}</p></div>
          </div>
        </Drawer>
      );
    }
  } else if (what === "decision") {
    const d = decisions.find((x) => x.decision_id === key);
    if (d) {
      const mine = ballots.filter((b) => b.decision_id === d.decision_id);
      const bench = benchFor(committee, mine, d.recommended);
      const t = tally(bench);
      const agentOf = new Map(mine.map((b) => [b.seat, b.agent_id]));
      const dissents = bench.filter((s) => s.dissent).map((s) => ({ agent_id: agentOf.get(s.seat) ?? s.seat, seat: s.seat, title: s.title, index: seatIndex.get(s.seat) ?? 0, rationale: s.rationale }));
      drawer = (
        <Drawer closeHref={closeHref} title={d.title} chips={<><RiskChip tier={d.risk_tier} /><KindChip kind={d.item_kind ?? d.kind} /><Chip plain>{d.item_id}</Chip></>}>
          {d.description ? <p className="rv-prose">{d.description}</p> : null}
          <section className="rv-card" data-tone="ai">
            <div className="rv-card-h">
              <span className="inline-flex items-center gap-2"><Icon name="users" /> The committee recommends {d.recommended === "approved" ? "approving" : "rejecting"}</span>
              <VoteBar yes={t.yes} no={t.no} abstain={t.abstain} />
            </div>
            <SeatVotes bench={bench} />
            <p className="rv-hint">Advice from AI advisers. {t.sat < t.of ? `${t.sat} of ${t.of} seats sat on this one. ` : ""}You decide.</p>
          </section>
          <section className="rv-card" data-tone="you">
            <SignDecision runId={runId} decisionId={d.decision_id} recommended={d.recommended} mustWeighAll={d.risk_tier === "high"}
              dissents={dissents} operator={operator ?? "You"} reviewTotal={Number(d.review_total)} reviewSigned={Number(d.review_signed)} />
          </section>
        </Drawer>
      );
    }
  } else if (what === "matter") {
    const m = queue.find((x) => x.ref_id === key);
    if (m) {
      drawer = (
        <Drawer closeHref={closeHref} title={m.title} chips={<><RiskChip tier={m.risk_tier} /><Chip plain>{m.advisory ? "Question" : m.label}</Chip><Chip plain>{m.display}</Chip></>}>
          {m.description ? <p className="rv-prose">{m.description}</p> : null}
          <section className="rv-card">
            <dl className="rv-facts">
              {m.submitted_by ? <><dt>From</dt><dd>{m.submitted_by}</dd></> : null}
              <dt>Waiting</dt><dd>{ageOf(m.since)}</dd>
              {Object.entries(parse<Record<string, unknown>>(m.details, {})).map(([k, v]) => (
                <span key={k} className="contents"><dt>{k.replace(/_/g, " ").replace(/^./, (ch) => ch.toUpperCase())}</dt><dd>{Array.isArray(v) ? v.join(", ") : v === true ? "Yes" : v === false ? "No" : String(v)}</dd></span>
              ))}
              <dt>Priority</dt>
              <dd className="flex flex-wrap items-center gap-1.5">
                {m.priority === null ? <Chip tone="you">Not ranked yet</Chip> : <strong>{m.priority} of 100</strong>}
                {m.reasons.map((r) => <Chip key={r} plain>{r}</Chip>)}
              </dd>
            </dl>
          </section>
          <p className="rv-hint">{m.advisory ? "A question gets advice, not a vote. " : ""}Tick it under Waiting to include it in a review.</p>
        </Drawer>
      );
    }
  } else if (what === "record") {
    const r = record.find((x) => x.attestation_id === key);
    if (r) {
      const [label, tone] = OUTCOME[r.outcome] ?? [r.outcome, undefined];
      const overruled = r.outcome !== "deferred" && r.outcome !== r.recommended;
      drawer = (
        <Drawer closeHref={closeHref} title={r.title}
          chips={<>{tone ? <Chip tone={tone} solid>{label}</Chip> : <Chip plain>{label}</Chip>}{overruled ? <Chip tone="objection">Overruled the committee</Chip> : null}<RiskChip tier={r.risk_tier} /><Chip plain>{r.item_id}</Chip></>}>
          <section className="rv-card" data-tone="you">
            <div className="rv-card-h"><span className="inline-flex items-center gap-2"><Avatar name={r.actor} you /> {r.actor}</span><span className="muted font-normal">{when(r.created_at)}</span></div>
            <p className="rv-prose">{r.rationale}</p>
            <p className="rv-hint">{r.source === "dashboard_session" ? "Signed in here under this name." : r.source === "cli_asserted" ? "Name given at the command line, not verified." : "How this name was established was not recorded."}</p>
          </section>
          <section className="rv-card" data-tone="ai">
            <div className="rv-card-h"><span>The committee recommended {r.recommended === "approved" ? "approving" : "rejecting"}</span><VoteBar yes={Number(r.yes_votes)} no={Number(r.no_votes)} /></div>
          </section>
        </Drawer>
      );
    }
  } else if (what === "advice") {
    const s = syntheses.find((x) => x.synthesis_id === key);
    if (s) {
      const question = parse<{ item_id: string; title: string }[]>(s.agenda, []).find((i) => i.item_id === s.item_id)?.title ?? s.item_id;
      const sides: [string, string, string[]][] = [["In favour", "ok", parse<string[]>(s.for_seats, [])], ["Against", "no", parse<string[]>(s.against_seats, [])], ["Undecided", "", parse<string[]>(s.undecided_seats, [])]];
      drawer = (
        <Drawer closeHref={closeHref} title={question} chips={<>{s.split ? <Chip tone="wait">Committee divided</Chip> : <Chip tone="ok">Committee agreed</Chip>}<Chip plain>{s.item_id}</Chip><Chip plain>{s.sim_month}</Chip></>}>
          {s.narrative ? <p className="rv-prose">{s.narrative}</p> : null}
          <section className="rv-card" data-tone="ai">
            <div className="grid gap-3">
              {sides.map(([label, tone, list]) => (
                <div key={label} className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2"><Chip tone={tone || undefined} plain={!tone}>{label}</Chip><span className="muted">{list.length}</span></span>
                  <span className="rv-stack">{list.map((seat) => <Avatar key={seat} name={titleOf(seat)} seat={seat} index={seatIndex.get(seat)} />)}</span>
                </div>
              ))}
            </div>
          </section>
          <div>
            <div className="rv-card-h">What would change each mind</div>
            {parse<[string, string][]>(s.checks, []).map(([seat, check]) => (
              <Fold key={seat} title={titleOf(seat)} lead={<Avatar name={titleOf(seat)} seat={seat} index={seatIndex.get(seat)} />}><p className="rv-prose">{check}</p></Fold>
            ))}
          </div>
        </Drawer>
      );
    }
  } else if (what === "seat") {
    const seat = committee.find((x) => x.seat === key);
    if (seat) {
      drawer = (
        <Drawer closeHref={closeHref} title={seat.title} chips={<><Chip tone="ai">AI adviser</Chip><Chip plain>{seat.seat.replace(/_/g, " ")}</Chip></>}>
          {seat.persona_text === null ? (
            <p className="muted">Briefed from a file, because this is a simulated run. It cannot be edited here.</p>
          ) : (
            <>
              <p className="rv-prose">{seat.persona_text}</p>
              <Fold title="Edit this brief"><BriefForm runId={runId} seat={seat} /></Fold>
            </>
          )}
        </Drawer>
      );
    }
  }

  return (
    <div className="rv">
      <AutoRefresh active={pending.length > 0} />
      {drawer ? <EscClose href={closeHref} /> : null}

      <header className="rv-top">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="rv-org">{org?.name ?? scopeLabel(scope)}</h1>
          {org ? (
            <details className="rv-pop">
              <summary><span className="rv-btn rv-btn-sm">Board direction</span></summary>
              <div className="rv-pop-card"><p style={{ fontStyle: "italic" }}>“{org.risk_appetite}”</p><p className="rv-hint">The committee argues from this.</p></div>
            </details>
          ) : <Chip plain>Simulated run</Chip>}
        </div>
        <div className="rv-top-actions">
          {scopes.length > 1 ? <WorkspacePicker scopes={scopeOptions} current={runId} /> : null}
          <Link href={to({ open: "customer" })} scroll={false} className="rv-btn">New customer</Link>
          <Link href={to({ open: "submit" })} scroll={false} className="rv-btn rv-btn-you"><Icon name="plus" /> Submit a matter</Link>
        </div>
      </header>

      <div className="rv-tiles">
        {tiles.map((t) => (
          <Link key={t.label} href={to({ tab: t.tab, open: null })} scroll={false} data-tone={t.tone}
            className={`rv-tile${t.count > 0 && t.tone === "you" ? " is-hot" : ""}`} aria-current={tab === t.tab && t.tone !== "ai" ? "true" : undefined}>
            <span className="rv-tile-icon"><Icon name={t.icon} /></span>
            <span><span className="rv-tile-count">{t.count}</span><span className="rv-tile-label">{t.label}</span></span>
          </Link>
        ))}
      </div>

      {openRisk.length > 0 ? (
        <div className="rv-riskbar">
          <span>Open risk</span>
          <span className="rv-riskbar-track" role="img" aria-label={`${riskCount("high")} high, ${riskCount("medium")} medium, ${riskCount("low")} low, ${riskCount(null)} not rated`}>
            {(["high", "medium", "low"] as const).map((tier) => riskCount(tier) ? <span key={tier} data-tone={tier} style={{ flex: riskCount(tier) }} /> : null)}
            {riskCount(null) ? <span style={{ flex: riskCount(null), background: "var(--border)" }} /> : null}
          </span>
          {(["high", "medium", "low"] as const).map((tier) => riskCount(tier) ? <span key={tier} className="rv-key" data-tone={tier}>{riskCount(tier)} {tier}</span> : null)}
          {riskCount(null) ? <span className="rv-key">{riskCount(null)} not rated</span> : null}
        </div>
      ) : null}

      {pending.map((w) => (
        <div key={w.command_id} className="rv-banner" data-tone="ai" aria-live="polite"><span className="rv-dot is-live" /><span>{describeWork(w.kind, w.payload)}…</span></div>
      ))}
      {stale ? <div className="rv-banner" data-tone="wait"><Icon name="alert" /><span>Still waiting. Is the worker running? <code>python -m sim serve</code></span></div> : null}
      {failed.map((w) => (
        <div key={w.command_id} className="rv-banner" data-tone="no">
          <Icon name="alert" /><span className="flex-1">{describeWork(w.kind, w.payload)} did not go through.</span>
          <details className="rv-pop"><summary><span className="rv-btn rv-btn-sm">Why</span></summary><div className="rv-pop-card is-right"><p>{errorOf(w.result)}</p><p className="rv-hint">{when(w.created_at)}</p></div></details>
        </div>
      ))}

      <section className="rv-board">
        <nav className="rv-tabs" aria-label="Matters">
          {tabs.map((t) => (
            <Link key={t.id} href={to({ tab: t.id, open: null })} scroll={false} className="rv-tab" aria-current={tab === t.id ? "page" : undefined}>
              {t.label}<span className="rv-tab-count" data-tone={t.count ? t.tone : undefined}>{t.count}</span>
            </Link>
          ))}
          <span className="ml-auto flex items-center gap-2 pb-1.5 pr-1">
            {tab === "waiting" && queue.length ? <><span className="muted text-xs">{ranked ? `Ranked ${when(ranked.at)}` : "Not ranked"}</span><RefreshRanking runId={runId} /></> : null}
            {tab === "waiting" ? <Help right><p><strong>Most urgent first.</strong> Priority weighs risk, how long it has waited, and earlier deferrals. The committee never sees it.</p></Help> : null}
            {tab === "needs" ? <Help right><p><strong>The committee only recommends.</strong> Open a matter to see how each seat voted, weigh objections, and sign. Nothing takes effect until you do.</p></Help> : null}
            {tab === "decided" && settled.length ? <span className="muted text-xs" title="Never overruling can mean advice is being waved through.">Overruled {overrides} of {settled.length}</span> : null}
            {tab === "settings" ? <Help right><p><strong>Everything the committee is told, and who reviews what.</strong> Every change asks why, and lands under Changes with your name.</p></Help> : null}
            {tab === "changes" ? <Help right><p><strong>The record of every configuration change.</strong> Who, when, what it was, what it became, and why. Nothing here can be edited or removed.</p></Help> : null}
            {tab === "committee" ? <Help right><p><strong>Each seat is an AI adviser with its own lens.</strong> A review seats only the ones a matter needs. High risk seats everyone, and the chair always sits.</p></Help> : null}
          </span>
        </nav>

        {tab === "needs" ? (
          decisions.length === 0 ? <EmptyState icon="check" tone="ok">Nothing needs you right now.</EmptyState> : (
            <div className="rv-rows">
              {decisions.map((d) => {
                const objections = d.recommended === "approved" ? Number(d.no_votes) : Number(d.yes_votes);
                return (
                  <Link key={d.decision_id} href={to({ open: `decision:${d.decision_id}` })} scroll={false} className="rv-rowline">
                    <span className="rv-riskmark" data-tone={d.risk_tier ?? undefined} />
                    <span className="min-w-0">
                      <span className="rv-rowtitle">{d.title}</span>
                      <span className="rv-rowmeta">
                        <KindChip kind={d.item_kind ?? d.kind} /><RiskChip tier={d.risk_tier} />
                        <Chip tone="ai">Recommends {d.recommended === "approved" ? "approve" : "reject"}</Chip>
                        {objections ? <Chip tone="objection">{plural(objections, "objection")}</Chip> : null}
                      </span>
                    </span>
                    <span className="rv-rowend"><span className="is-wide"><VoteBar yes={Number(d.yes_votes)} no={Number(d.no_votes)} abstain={Number(d.abstentions)} /></span><Chip tone="you" solid>Sign</Chip><Icon name="chevron" className="rv-chev" /></span>
                  </Link>
                );
              })}
            </div>
          )
        ) : null}

        {tab === "waiting" ? (
          queue.length === 0 ? <EmptyState icon="inbox" tone="wait">Nothing is waiting. Submit a matter, or <Link href={to({ open: "submit:question" })} scroll={false}>ask the committee a question</Link>.</EmptyState>
            : <WaitingRows runId={runId} entries={queue} askHref={to({ open: "submit:question" })} openHrefs={Object.fromEntries(queue.map((m) => [m.ref_id, to({ open: `matter:${m.ref_id}` })]))} />
        ) : null}

        {tab === "decided" ? (
          record.length === 0 ? <EmptyState icon="pen" tone="you">Nothing has been signed yet.</EmptyState> : (
            <div className="rv-rows">
              {record.map((r) => {
                const [label, tone] = OUTCOME[r.outcome] ?? [r.outcome, undefined];
                return (
                  <Link key={r.attestation_id} href={to({ open: `record:${r.attestation_id}` })} scroll={false} className="rv-rowline">
                    <span className="rv-riskmark" data-tone={r.risk_tier ?? undefined} />
                    <span className="min-w-0">
                      <span className="rv-rowtitle">{r.title}</span>
                      <span className="rv-rowmeta">
                        {tone ? <Chip tone={tone} dot>{label}</Chip> : <Chip plain>{label}</Chip>}
                        {r.outcome !== "deferred" && r.outcome !== r.recommended ? <Chip tone="objection">Overruled</Chip> : null}
                        <KindChip kind={r.item_kind ?? r.kind} />
                      </span>
                    </span>
                    <span className="rv-rowend"><span className="is-wide inline-flex items-center gap-2"><Avatar name={r.actor} you />{r.actor}</span><span className="is-wide">{when(r.created_at)}</span><Icon name="chevron" className="rv-chev" /></span>
                  </Link>
                );
              })}
            </div>
          )
        ) : null}

        {tab === "advice" ? (
          syntheses.length === 0 ? <EmptyState icon="chat" tone="ai">No questions asked yet. Submit one as “A question”.</EmptyState> : (
            <div className="rv-rows">
              {syntheses.map((s) => {
                const question = parse<{ item_id: string; title: string }[]>(s.agenda, []).find((i) => i.item_id === s.item_id)?.title ?? s.item_id;
                return (
                  <Link key={s.synthesis_id} href={to({ open: `advice:${s.synthesis_id}` })} scroll={false} className="rv-rowline">
                    <span className="rv-riskmark" data-tone="ai" />
                    <span className="min-w-0">
                      <span className="rv-rowtitle">{question}</span>
                      <span className="rv-rowmeta">{s.split ? <Chip tone="wait">Divided</Chip> : <Chip tone="ok">Agreed</Chip>}<Chip plain>Question</Chip></span>
                    </span>
                    <span className="rv-rowend">
                      <span className="is-wide"><VoteBar yes={parse<string[]>(s.for_seats, []).length} no={parse<string[]>(s.against_seats, []).length} abstain={parse<string[]>(s.undecided_seats, []).length} /></span>
                      <span className="is-wide">{s.sim_month}</span><Icon name="chevron" className="rv-chev" />
                    </span>
                  </Link>
                );
              })}
            </div>
          )
        ) : null}

        {tab === "committee" ? (
          <div className="rv-seatgrid">
            {committee.map((seat, i) => (
              <Link key={seat.seat} href={to({ open: `seat:${seat.seat}` })} scroll={false} className="rv-seatcard"
                style={{ "--seat": `var(--border)` } as React.CSSProperties}>
                <Avatar name={seat.title} seat={seat.seat} index={i} large />
                <span className="min-w-0">
                  <span className="block font-semibold">{seat.title}</span>
                  <span className="muted block truncate text-xs">{firstSentence(seat.persona_text, 60) || "Briefed from a file"}</span>
                </span>
              </Link>
            ))}
          </div>
        ) : null}
        {tab === "settings" ? (
          !org ? <EmptyState icon="flag" tone="ai">A simulated run is configured from files, not here.</EmptyState> : (
            <div className="rv-settings">
              <div className="rv-group-h">Organisation</div>
              <div className="rv-setgrid">
                {PROFILE_FIELDS.map(([field]) => (
                  <Link key={field} href={to({ open: `setting:${field}` })} scroll={false} className="rv-set">
                    <span className="min-w-0"><span className="rv-set-label">{PROFILE_LABELS[field]}</span><span className="rv-set-value">{firstSentence(shown(field), 70) || "Not set"}</span></span>
                    <Icon name="chevron" className="rv-chev" />
                  </Link>
                ))}
                <Link href={to({ open: "budget" })} scroll={false} className="rv-set">
                  <span className="min-w-0"><span className="rv-set-label">Monthly budget</span><span className="rv-set-value">{cap === null ? "Not set" : `$${cap.toLocaleString("en-US")}`}</span></span>
                  <Icon name="chevron" className="rv-chev" />
                </Link>
              </div>

              <div className="rv-group-h"><span>Governing documents</span><Link href={to({ open: "document:new" })} scroll={false} className="rv-btn rv-btn-sm"><Icon name="plus" /> Add document</Link></div>
              {docs.length === 0 ? <p className="muted px-1 pb-2">None yet. Add your acceptable use policy or committee charter so the committee can cite it.</p> : (
                <div className="rv-setgrid">
                  {docs.map((d) => (
                    <Link key={d.document_id} href={to({ open: `document:${d.document_id}` })} scroll={false} className="rv-set">
                      <span className="min-w-0"><span className="rv-set-label">{d.kind.replace(/_/g, " ")}</span><span className="rv-set-value">{d.title}</span></span>
                      <Icon name="chevron" className="rv-chev" />
                    </Link>
                  ))}
                </div>
              )}

              <div className="rv-group-h">Who reviews what</div>
              <div className="rv-setgrid">
                {PANEL_KINDS.map((kind) => {
                  const chosen = panelFor(kind);
                  return (
                    <Link key={kind} href={to({ open: `panel:${kind}` })} scroll={false} className="rv-set">
                      <span className="min-w-0">
                        <span className="rv-set-label">{KIND_LABELS[kind]}</span>
                        <span className="rv-set-value">{chosen ? <span className="rv-stack">{chosen.map((seat) => <Avatar key={seat} name={titleOf(seat)} seat={seat} index={seatIndex.get(seat)} />)}</span> : "Standard panel"}</span>
                      </span>
                      <Icon name="chevron" className="rv-chev" />
                    </Link>
                  );
                })}
              </div>
            </div>
          )
        ) : null}

        {tab === "changes" ? (
          changes.length === 0 ? <EmptyState icon="flag" tone="you">No configuration changes yet.</EmptyState> : (
            <div className="rv-rows">
              {changes.map((c) => (
                <Link key={c.change_id} href={to({ open: `change:${c.change_id}` })} scroll={false} className="rv-rowline">
                  <Avatar name={c.actor} you />
                  <span className="min-w-0">
                    <span className="rv-rowtitle">{changeTitle(c.area, c.target)}</span>
                    <span className="rv-rowmeta"><Chip tone="you">{AREA_LABELS[c.area] ?? c.area}</Chip><span className="muted truncate text-xs">{c.reason}</span></span>
                  </span>
                  <span className="rv-rowend"><span className="is-wide">{c.actor}</span><span className="is-wide">{when(c.changed_at)}</span><Icon name="chevron" className="rv-chev" /></span>
                </Link>
              ))}
            </div>
          )
        ) : null}
      </section>

      {drawer}
    </div>
  );
}
