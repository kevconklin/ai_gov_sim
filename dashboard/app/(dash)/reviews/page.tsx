import Link from "next/link";
import type { ReactNode } from "react";
import { currentOperator } from "@/lib/auth/session";
import { atLeast, isOperator, orgRole, visibleRuns } from "@/lib/auth/access";
import { BANK_LABELS } from "@/lib/constants";
import { first, href, type SearchParams } from "@/lib/params";
import {
  ballotsToSign,
  changeLog,
  committeeSeats,
  documentsInForce,
  modelCatalog,
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
  inventoryStarted,
  starterKits,
} from "@/lib/queries/governance";
import { meetingDetail } from "@/lib/queries/meetings";
import { citedBy } from "@/lib/queries/governance";
import { unansweredCount } from "@/lib/queries/product";
import { convenerOf, perspectivesFor, reviewsHeld, signaturesFor } from "@/lib/queries/trail";
import { AREA_LABELS, FRAMEWORK_LABELS, PROVIDER_TONES, STANCE_WORDS, KIND_LABELS, PROFILE_LABELS, ageOf, benchFor, changeTitle, describeWork, firstSentence, mergeQueue, plural, tally, type Ranking } from "@/lib/reviews/model";
import { AutoRefresh, BriefForm, EscClose, RefreshRanking, SignDecision, WaitingRows, WorkspacePicker, type Scope } from "./forms";
import { SubmitMatterForm } from "./intake-form";
import { AddSeatForm, RemoveSeatForm, SeatForm } from "./seat-forms";
import { Trail } from "./trail";
import { AddDocumentForm, ArchiveForm, BudgetForm, PanelForm, ProfileFieldForm, RetireDocumentForm } from "./settings-forms";
import { SetupWizard, type KitView } from "./setup-wizard";
import { InviteForm, RemoveMemberForm } from "./people-forms";
import { membersOf } from "@/lib/auth/users";
import { ROLE_WORDS } from "@/lib/auth/roles";
import { Avatar, Chip, Drawer, Fold, Help, Icon, KindChip, RiskChip, SeatVotes, Term, VoteBar } from "./parts";
import { decisionBrief, plain } from "@/lib/reviews/brief";

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
type Tab = "needs" | "waiting" | "decided" | "advice" | "reviews" | "committee" | "settings" | "changes";
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
  const operatorAccount = await isOperator();
  const scopes = await reviewScopes(await visibleRuns());
  const wantsNew = first(sp, "open") === "customer" && operatorAccount;
  if (scopes.length === 0 && !wantsNew) {
    return (
      <div className="rv">
        <h1 className="rv-org">{operatorAccount ? "No organization yet" : "Nothing to show yet"}</h1>
        {operatorAccount
          ? <p className="muted mt-2"><Link href="/reviews?open=customer" className="rv-btn rv-btn-you">Set one up</Link></p>
          : <p className="muted mt-2">You are not a member of any organization. Ask the person who runs governance to add you.</p>}
      </div>
    );
  }
  const scope = scopes.find((s) => s.run_id === first(sp, "run")) ?? scopes[0];
  if (!scope) {
    // an operator with no organization yet, opening the setup drawer
    return (
      <div className="rv">
        <h1 className="rv-org">No organization yet</h1>
        <Drawer closeHref="/organizations" title="Set up a new organization" chips={<Chip tone="ai">About five minutes</Chip>}>
          <SetupWizard kits={(await starterKits()).map((k) => ({
            id: k.starter_id, label: k.label, summary: k.summary, audience: k.audience, framework: k.framework,
            stances: parse<Record<string, { label: string; text: string }>>(k.stances, {}),
            facts_template: k.facts_template, business_goals: k.business_goals, control_count: Number(k.control_count), document_count: Number(k.document_count),
          }))} />
        </Drawer>
      </div>
    );
  }
  const runId = scope.run_id;
  const role = await orgRole(runId);
  const canDecide = atLeast(role, "decides");
  const canRun = atLeast(role, "runs");
  const people = scope.condition === "workspace" ? await membersOf(runId) : [];

  const [operator, org, decisions, ballots, waiting, ranked, work, syntheses, record, seats, docs, panels, changes, cap, held, catalog, kitRows, inventoried, unansweredAsks] = await Promise.all([
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
    reviewsHeld(runId),
    modelCatalog(),
    starterKits(),
    inventoryStarted(runId),
    unansweredCount(runId),
  ]);
  const kits: KitView[] = kitRows.map((k) => ({
    id: k.starter_id, label: k.label, summary: k.summary, audience: k.audience, framework: k.framework,
    stances: parse<Record<string, { label: string; text: string }>>(k.stances, {}),
    facts_template: k.facts_template, business_goals: k.business_goals, control_count: Number(k.control_count), document_count: Number(k.document_count),
  }));

  const order = parse<string[]>(org?.seats, []);
  const committee = [...seats].sort((a, b) => (order.indexOf(a.seat) + 1 || 99) - (order.indexOf(b.seat) + 1 || 99));
  const chairSeat = org?.chair_seat;
  const seatIndex = new Map(committee.map((c, i) => [c.seat, i]));
  const titleOf = (seat: string) => committee.find((c) => c.seat === seat)?.title ?? seat.replace(/_/g, " ");
  const ranking = parse<{ candidates?: Ranking[] }>(JSON.stringify(ranked?.result ?? {}), {}).candidates ?? [];
  const queue = mergeQueue(waiting, ranking);
  const pending = work.filter((w) => w.status !== "failed");
  const failed = work.filter((w) => w.status === "failed");
  const reviewing = pending.filter((w) => w.kind === "convene").length;
  // a command still 'pending' after this long has not been picked up: no worker is running. Once it is
  // 'processing' the worker has it, and a live review takes minutes, so that is not a warning.
  const stale = pending.some((w) => w.status === "pending" && Date.now() - new Date(w.created_at).getTime() > STALE_MS);
  const reviewingLive = pending.some((w) => w.kind === "convene" && w.status === "processing");
  const settled = record.filter((r) => r.outcome !== "deferred");
  const overrides = settled.filter((r) => r.outcome !== r.recommended).length;

  const wanted = first(sp, "tab") as Tab | undefined;
  const tab: Tab = wanted && ["needs", "waiting", "decided", "advice", "reviews", "committee", "settings", "changes"].includes(wanted)
    ? wanted : decisions.length ? "needs" : queue.length ? "waiting" : "decided";
  const open = first(sp, "open") ?? "";
  const to = (overrides_: Record<string, string | null>) => href("/reviews", sp, overrides_);
  const closeHref = to({ open: null });
  const scopeOptions: Scope[] = scopes.map((s) => ({ run_id: s.run_id, label: scopeLabel(s), workspace: s.condition === "workspace", archived: s.status === "archived" }));
  const archived = scope.condition === "workspace" && scope.status === "archived";

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
    { id: "reviews", label: "Reviews", count: held.length, tone: "ai" },
    { id: "committee", label: "Committee", count: committee.length, tone: "ai" },
    { id: "settings", label: "Settings", count: docs.length + panels.length, tone: "you" },
    { id: "changes", label: "Changes", count: changes.length, tone: "you" },
  ];
  const fromKit = changes.some((c) => c.area === "starter");
  const shortId = (id: string) => id.split("/").pop() ?? id;
  const signedById = new Map(record.filter((r) => r.outcome !== "deferred").map((r) => [shortId(r.item_id), r]));
  const precedentOptions = [...signedById.entries()].map(([id, r]) => ({ id, title: r.title, outcome: r.outcome, actor: r.actor, when: when(r.created_at) }));
  const flaggedIn = (detailsJson: string | null | undefined): string[] => {
    const v = parse<Record<string, unknown>>(detailsJson ?? null, {}).flagged_text;
    return Array.isArray(v) ? v.map(String) : [];
  };
  const citedIn = (detailsJson: string | null | undefined): string[] => {
    const v = parse<Record<string, unknown>>(detailsJson ?? null, {}).related_decisions;
    return Array.isArray(v) ? v.map(String) : [];
  };
  const precedentChips = (ids: string[]) => ids.map((id) => {
    const r = signedById.get(id);
    return r ? <Link key={id} href={to({ open: `record:${r.attestation_id}` })} scroll={false} className="rv-chip" data-tone={r.outcome === "approved" ? "ok" : "no"} title={`${r.outcome} by ${r.actor}`}>{id} {r.title}</Link>
      : <Chip key={id} plain>{id}</Chip>;
  });
  const modelOf = (ref: string | null) => catalog.find((m) => m.model_id === ref);
  const modelChip = (ref: string | null) => {
    const m = modelOf(ref);
    return ref ? <Chip tone={PROVIDER_TONES[m?.provider ?? ""] ?? undefined} plain={!m}>{m?.label ?? ref}</Chip> : <Chip plain>Default model</Chip>;
  };
  const profileValue = (field: string): string | null => (org ? ((org as unknown as Record<string, string | null>)[field] ?? null) : null);
  const shown = (field: string): string => field === "framework" ? (FRAMEWORK_LABELS[profileValue(field) ?? "none"] ?? "None chosen") : (profileValue(field) ?? "");
  const panelFor = (kind: string): string[] | null => { const row = panels.find((x) => x.kind === kind && x.risk_tier === "*"); return row ? parse<string[]>(row.seats, []) : null; };

  // ---- the drill-down ----------------------------------------------------------------------
  let drawer: ReactNode = null;
  const [whatAsked, ...rest] = open.split(":");
  const key = rest.join(":");
  // configuration drawers are for whoever runs the organization; everyone else reads the tab and gets a note
  const CONFIG_DRAWERS = ["archive", "budget", "document", "panel", "person", "seat", "setting"];
  const what = !canRun && CONFIG_DRAWERS.includes(whatAsked ?? "") ? "readonly" : whatAsked;
  if (what === "readonly") {
    drawer = <Drawer closeHref={closeHref} title="Read only" chips={<Chip tone="wait">Runs it</Chip>}><p className="rv-prose">Only someone who runs this organization can change its settings, committee, documents, or budget. Everything is here to read.</p></Drawer>;
  }

  const trailHref = (meetingId: string, itemId?: string) => to({ open: `trail:${meetingId}${itemId ? `~${itemId}` : ""}` });
  const trailButton = (meetingId: string, itemId?: string) => (
    <Link href={trailHref(meetingId, itemId)} scroll={false} className="rv-btn rv-btn-sm w-fit"><Icon name="flag" /> See how the committee got here</Link>
  );

  if (what === "trail") {
    const [meetingId = "", focus] = key.split("~");
    const detail = await meetingDetail(meetingId);
    if (detail && detail.meeting.run_id === runId) {
      const [perspectives, signatures, convener] = await Promise.all([perspectivesFor(meetingId), signaturesFor(meetingId), convenerOf(runId, meetingId)]);
      const input = {
        status: detail.meeting.status, agenda: detail.agenda, minutes: detail.meeting.minutes_text, convener, perspectives, signatures,
        messages: detail.messages, positions: detail.positions, votes: detail.votes,
        decisions: detail.decisions.map((d) => ({ ...d, yes_votes: Number(d.yes_votes), no_votes: Number(d.no_votes), abstentions: Number(d.abstentions) })),
      };
      const state = detail.meeting.status === "closed" ? <Chip tone="ok" dot>Complete</Chip> : detail.meeting.status === "failed" ? <Chip tone="no" dot>Did not finish</Chip> : <Chip tone="ai" dot>In progress</Chip>;
      drawer = (
        <Drawer wide closeHref={closeHref} title={`Review of ${detail.meeting.meeting_date}`} chips={<>{state}<Chip plain>{plural(detail.agenda.length, "matter")}</Chip><Chip tone="ai">Recorded as it happened</Chip></>}>
          <Trail input={input} committee={committee.map((c) => ({ seat: c.seat, title: c.title }))} focus={focus} />
        </Drawer>
      );
    }
  } else if (what === "submit") {
    drawer = (
      <Drawer closeHref={closeHref} title={key === "question" ? "Ask the committee" : "Submit a matter"} chips={<Chip tone="you">It joins Waiting</Chip>}>
        <SubmitMatterForm runId={runId} preset={key || undefined} precedents={precedentOptions} />
      </Drawer>
    );
  } else if (what === "customer" && operatorAccount) {
    drawer = (
      <Drawer closeHref={closeHref} title="Set up a new organization" chips={<Chip tone="ai">About five minutes</Chip>}>
        <SetupWizard kits={kits} />
      </Drawer>
    );
  } else if (what === "setting" && org) {
    const spec = PROFILE_FIELDS.find(([f]) => f === key);
    if (spec) {
      drawer = (
        <Drawer closeHref={closeHref} title={PROFILE_LABELS[key] ?? key} chips={<Chip tone="you">Organization</Chip>}>
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
  } else if (what === "archive" && org) {
    drawer = <Drawer closeHref={closeHref} title={archived ? "Restore this organization" : "Archive this organization"} chips={<Chip tone={archived ? "you" : "wait"}>{archived ? "Archived" : "Nothing is deleted"}</Chip>}><ArchiveForm runId={runId} name={org.name} archived={archived} /></Drawer>;
  } else if (what === "person" && org) {
    if (key === "new") {
      drawer = <Drawer closeHref={closeHref} title="Add a person" chips={<Chip tone="you">People</Chip>}><InviteForm runId={runId} /></Drawer>;
    } else {
      const person = people.find((x) => x.user_id === key);
      if (person) {
        drawer = (
          <Drawer closeHref={closeHref} title={person.name} chips={<><Chip tone="you">{ROLE_WORDS[person.role]}</Chip><Chip plain>{person.email}</Chip></>}>
            <section className="rv-card"><dl className="rv-facts"><dt>Added by</dt><dd>{person.added_by}</dd><dt>When</dt><dd>{when(person.added_at)}</dd></dl></section>
            <p className="rv-hint">To change what they may do, add them again with the new role; the change lands on the record.</p>
            <RemoveMemberForm runId={runId} userId={person.user_id} name={person.name} />
          </Drawer>
        );
      }
    }
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
      const dissents = bench.filter((s) => s.dissent).map((s) => ({ agent_id: agentOf.get(s.seat) ?? s.seat, seat: s.seat, title: s.title, index: seatIndex.get(s.seat) ?? 0, rationale: plain(s.rationale) }));
      const brief = decisionBrief({ recommended: d.recommended, bench, chairSeat: chairSeat ?? null, riskTier: d.risk_tier, reviewTotal: Number(d.review_total), reviewSigned: Number(d.review_signed) });
      const firmness = brief.firmness === "unanimous" ? <Chip tone="ok" dot>Unanimous</Chip> : brief.firmness === "clear" ? <Chip tone="ai" dot>Clear majority</Chip> : <Chip tone="objection" dot>Split</Chip>;
      drawer = (
        <Drawer closeHref={closeHref} title={d.title} chips={<><RiskChip tier={d.risk_tier} /><KindChip kind={d.item_kind ?? d.kind} /><Chip plain>{d.item_id}</Chip></>}>
          <section className="rv-card rv-brief" data-tone="ai">
            <div className="rv-brief-head">{brief.headline}</div>
            <div className="flex flex-wrap items-center gap-2">{firmness}<VoteBar yes={t.yes} no={t.no} abstain={t.abstain} />{t.sat < t.of ? <Chip plain>{t.sat} of {t.of} seats sat</Chip> : null}</div>
            {brief.why ? <div className="rv-brief-row"><span>Why</span><span>{brief.why.text}<span className="rv-brief-who">{brief.why.seat}</span></span></div> : null}
            {brief.objection ? <div className="rv-brief-row" data-tone="objection"><span><Term word="objection">Strongest objection</Term></span><span>{brief.objection.text}<span className="rv-brief-who">{brief.objection.seat}</span></span></div>
              : <div className="rv-brief-row"><span>Objections</span><span>None. Every seat that sat agreed.</span></div>}
            {flaggedIn(d.details).length ? <div className="rv-brief-row" data-tone="objection"><span>Flagged</span><span>The submission contained text addressed to the advisers, which they were told to ignore: {flaggedIn(d.details).join("; ")}. Weigh that it was tried.</span></div> : null}
            {citedIn(d.details).length ? <div className="rv-brief-row"><span>Cites</span><span className="flex flex-wrap gap-1.5">{precedentChips(citedIn(d.details))}</span></div> : null}
            <div className="rv-brief-row"><span>What <Term word="sign">signing</Term> does</span><span>{brief.signing}</span></div>
            <p className="rv-hint">This is a <Term word="recommendation">recommendation</Term> from AI advisers, written from their own reasons. You decide.</p>
          </section>
          {d.description ? <Fold title="What was submitted"><p className="rv-prose">{d.description}</p></Fold> : null}
          <Fold title={`How each seat voted (${t.yes} yes, ${t.no} no${t.abstain ? `, ${t.abstain} abstained` : ""})`}>
            <SeatVotes bench={bench} />
            <div className="mt-2">{trailButton(d.meeting_id, d.item_id)}</div>
          </Fold>
          {!canDecide ? <p className="rv-hint" data-tone="wait">Only someone who decides for this organization can sign. You can read everything here.</p> : null}
          {canDecide ? <section className="rv-card" data-tone="you">
            <SignDecision runId={runId} decisionId={d.decision_id} recommended={d.recommended} mustWeighAll={d.risk_tier === "high"}
              dissents={dissents} operator={operator ?? "You"} reviewTotal={Number(d.review_total)} reviewSigned={Number(d.review_signed)} />
          </section> : null}
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
              {flaggedIn(m.details).length ? <><dt>Flagged</dt><dd><Chip tone="objection">Text addressed to the advisers</Chip> <span className="muted text-xs">{flaggedIn(m.details).join("; ")}</span></dd></> : null}
              {citedIn(m.details).length ? <><dt>Earlier decisions</dt><dd className="flex flex-wrap gap-1.5">{precedentChips(citedIn(m.details))}</dd></> : null}
              {Object.entries(parse<Record<string, unknown>>(m.details, {})).filter(([k]) => k !== "related_decisions" && k !== "flagged_text").map(([k, v]) => (
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
      const citations = r.outcome === "deferred" ? [] : await citedBy(runId, shortId(r.item_id));
      const openFor = (item: { item_id: string; status: string }) => {
        const d = decisions.find((x) => x.item_id === shortId(item.item_id));
        const signed = record.find((x) => x.item_id === item.item_id);
        return d ? to({ open: `decision:${d.decision_id}` }) : signed ? to({ open: `record:${signed.attestation_id}` }) : to({ tab: "waiting", open: `matter:${item.item_id}` });
      };
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
            {trailButton(r.meeting_id, r.item_id)}
          </section>
          {citations.length ? (
            <section className="rv-card">
              <div className="rv-card-h"><span>Cited as <Term word="precedent">precedent</Term> by</span><span className="muted font-normal">{plural(citations.length, "matter")}</span></div>
              <div className="rv-rows">
                {citations.map((c) => (
                  <Link key={c.item_id} href={openFor(c)} scroll={false} className="rv-rowline">
                    <span className="min-w-0"><span className="rv-rowtitle">{c.title}</span><span className="rv-rowmeta"><Chip plain>{shortId(c.item_id)}</Chip><Chip plain>{c.status.replace(/_/g, " ")}</Chip></span></span>
                    <span className="rv-rowend"><Icon name="chevron" className="rv-chev" /></span>
                  </Link>
                ))}
              </div>
            </section>
          ) : <p className="rv-hint">Later matters can cite this decision when they are submitted; the committee reads it as precedent.</p>}
        </Drawer>
      );
    }
  } else if (what === "advice") {
    const s = syntheses.find((x) => x.synthesis_id === key);
    if (s) {
      const question = parse<{ item_id: string; title: string }[]>(s.agenda, []).find((i) => i.item_id === s.item_id)?.title ?? s.item_id;
      const sides: [string, string, string[]][] = [["In favor", "ok", parse<string[]>(s.for_seats, [])], ["Against", "no", parse<string[]>(s.against_seats, [])], ["Undecided", "", parse<string[]>(s.undecided_seats, [])]];
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
          {trailButton(s.meeting_id, s.item_id)}
          <div>
            <div className="rv-card-h">What would change each mind</div>
            {parse<[string, string][]>(s.checks, []).map(([seat, check]) => (
              <Fold key={seat} title={titleOf(seat)} lead={<Avatar name={titleOf(seat)} seat={seat} index={seatIndex.get(seat)} />}><p className="rv-prose">{check}</p></Fold>
            ))}
          </div>
        </Drawer>
      );
    }
  } else if (what === "seat" && key === "new") {
    drawer = <Drawer closeHref={closeHref} title="Add an adviser" chips={<Chip tone="ai">Joins the committee, speaking last</Chip>}><AddSeatForm runId={runId} catalog={catalog} /></Drawer>;
  } else if (what === "seat") {
    const seat = committee.find((x) => x.seat === key);
    if (seat) {
      const editable = seat.persona_text !== null;
      drawer = (
        <Drawer closeHref={closeHref} title={seat.title}
          chips={<><Chip tone="ai">AI adviser</Chip>{modelChip(seat.model)}<Chip plain>{STANCE_WORDS[Math.round(Number(seat.stance_baseline))] ?? "Balanced"}</Chip>{seat.seat === chairSeat ? <Chip tone="you">Chair</Chip> : null}</>}>
          {!editable ? (
            <p className="muted">Briefed from a file, because this is a simulated run. It cannot be edited here.</p>
          ) : (
            <>
              <p className="rv-prose">{seat.persona_text}</p>
              <Fold title="Title, leaning and model"><SeatForm runId={runId} seat={seat} catalog={catalog} /></Fold>
              <Fold title="Rewrite the brief"><BriefForm runId={runId} seat={seat} /></Fold>
              {seat.seat !== chairSeat ? <Fold title="Remove this adviser"><RemoveSeatForm runId={runId} seat={seat} /></Fold> : null}
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
          {operatorAccount ? <Link href={to({ open: "customer" })} scroll={false} className="rv-btn">New organization</Link> : null}
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
      {stale ? <div className="rv-banner" data-tone="wait"><Icon name="alert" /><span>Nothing has picked this up. Is the worker running? <code>scripts/run-local.sh status</code></span></div> : null}
      {reviewingLive ? <div className="rv-banner" data-tone="ai"><Icon name="users" /><span>A live review takes a few minutes: each adviser writes a position, then they debate, then they vote. This page refreshes on its own.</span></div> : null}
      {failed.map((w) => (
        <div key={w.command_id} className="rv-banner" data-tone="no">
          <Icon name="alert" /><span className="flex-1">{describeWork(w.kind, w.payload)} did not go through.</span>
          <details className="rv-pop"><summary><span className="rv-btn rv-btn-sm">Why</span></summary><div className="rv-pop-card is-right"><p>{errorOf(w.result)}</p><p className="rv-hint">{when(w.created_at)}</p></div></details>
        </div>
      ))}

      {archived ? (
        <div className="rv-banner" data-tone="wait">
          <Icon name="flag" /><span className="flex-1">This organization is archived. Its record is here to read; it takes no new reviews, questions, or submissions.</span>
          <Link href={to({ open: "archive" })} scroll={false} className="rv-btn rv-btn-sm">Restore</Link>
        </div>
      ) : null}

      {unansweredAsks ? (
        <div className="rv-banner" data-tone="wait">
          <Icon name="chat" /><span className="flex-1">{plural(unansweredAsks, "question")} the policy could not answer. The committee has not heard {unansweredAsks === 1 ? "it" : "them"} yet.</span>
          <Link href={`/ask?run=${encodeURIComponent(runId)}`} className="rv-btn rv-btn-sm">See {unansweredAsks === 1 ? "it" : "them"}</Link>
        </div>
      ) : null}

      {org && !(held.length && record.length && inventoried) ? (
        <section className="rv-card" data-tone="you" aria-label="Getting started">
          <div className="rv-card-h"><span>Getting started</span><span className="muted font-normal">{[held.length > 0, record.length > 0, inventoried].filter(Boolean).length} of 3</span></div>
          <div className="rv-start">
            {[
              { done: held.length > 0, href: to({ tab: "waiting", open: null }),
                title: fromKit ? "Review the starter policy" : "Convene your first review",
                text: fromKit ? "It is waiting. Tick it and convene; the committee reads it against your board’s direction." : "Submit a matter, tick it, and convene." },
              { done: record.length > 0, href: to({ tab: "needs", open: null }), title: "Sign your first decision",
                text: "Read the recommendation and the objections, then decide in your own words." },
              { done: inventoried, href: to({ open: "submit:tool" }), title: "Add the AI you already use",
                text: "Each tool or vendor becomes a matter the committee can review." },
            ].map((s) => (
              <Link key={s.title} href={s.href} scroll={false} className="rv-start-row" data-done={s.done ? "true" : undefined}>
                <span className="rv-start-mark" aria-hidden>{s.done ? "✓" : ""}</span>
                <span className="min-w-0"><span className="rv-start-title">{s.title}</span><span className="rv-start-text">{s.text}</span></span>
                {!s.done ? <Icon name="chevron" className="rv-chev ml-auto" /> : null}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

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
            {tab === "reviews" ? <Help right><p><strong>Every review you have called.</strong> Open one for its trail: who called it, who sat, what each adviser committed to before the debate, what was said, how they voted, and what you signed.</p></Help> : null}
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
            : <WaitingRows runId={runId} entries={queue} canConvene={canDecide} askHref={to({ open: "submit:question" })} openHrefs={Object.fromEntries(queue.map((m) => [m.ref_id, to({ open: `matter:${m.ref_id}` })]))} />
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

        {tab === "reviews" ? (
          held.length === 0 ? <EmptyState icon="users" tone="ai">No reviews yet. Convene one from Waiting.</EmptyState> : (
            <div className="rv-rows">
              {held.map((m) => {
                const matters = parse<{ title: string }[]>(m.agenda, []);
                const unsigned = Number(m.decisions) - Number(m.signed);
                return (
                  <Link key={m.meeting_id} href={trailHref(m.meeting_id)} scroll={false} className="rv-rowline">
                    <span className="rv-riskmark" data-tone="ai" />
                    <span className="min-w-0">
                      <span className="rv-rowtitle">{matters.map((x) => x.title).join(" · ") || "Review"}</span>
                      <span className="rv-rowmeta">
                        {m.status === "closed" ? <Chip tone="ok" dot>Complete</Chip> : m.status === "failed" ? <Chip tone="no" dot>Did not finish</Chip> : <Chip tone="ai" dot>In progress</Chip>}
                        <Chip plain>{plural(matters.length, "matter")}</Chip>
                        {Number(m.seats) ? <Chip plain>{plural(Number(m.seats), "adviser")}</Chip> : null}
                        {unsigned > 0 && m.status === "closed" ? <Chip tone="you">{unsigned} to sign</Chip> : null}
                      </span>
                    </span>
                    <span className="rv-rowend"><span className="is-wide">{m.meeting_date}</span><Icon name="chevron" className="rv-chev" /></span>
                  </Link>
                );
              })}
            </div>
          )
        ) : null}

        {tab === "committee" ? (
          <>
          {org ? (
            <div className="flex items-center justify-between gap-3 px-4 pt-3">
              <span className="muted text-xs">{new Set(committee.map((c) => c.model ?? "default")).size > 1 ? "A mixed committee: advisers run on different models." : "Every adviser runs on the same model."}</span>
              <Link href={to({ open: "seat:new" })} scroll={false} className="rv-btn rv-btn-sm"><Icon name="plus" /> Add adviser</Link>
            </div>
          ) : null}
          <div className="rv-seatgrid">
            {committee.map((seat, i) => (
              <Link key={seat.seat} href={to({ open: `seat:${seat.seat}` })} scroll={false} className="rv-seatcard"
                style={{ "--seat": `var(--border)` } as React.CSSProperties}>
                <Avatar name={seat.title} seat={seat.seat} index={i} large />
                <span className="min-w-0">
                  <span className="block font-semibold">{seat.title}</span>
                  <span className="muted block truncate text-xs">{firstSentence(seat.persona_text, 60) || "Briefed from a file"}</span>
                  <span className="mt-1 block">{modelChip(seat.model)}</span>
                </span>
              </Link>
            ))}
          </div>
          </>
        ) : null}
        {tab === "settings" ? (
          !org ? <EmptyState icon="flag" tone="ai">A simulated run is configured from files, not here.</EmptyState> : (
            <div className="rv-settings">
              <div className="rv-group-h">Organization</div>
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
                <Link href={to({ open: "archive" })} scroll={false} className="rv-set">
                  <span className="min-w-0"><span className="rv-set-label">Status</span><span className="rv-set-value">{archived ? "Archived. Restore it" : "Active. Archive it"}</span></span>
                  <Icon name="chevron" className="rv-chev" />
                </Link>
              </div>

              <div className="rv-group-h"><span>People</span>{canRun ? <Link href={to({ open: "person:new" })} scroll={false} className="rv-btn rv-btn-sm"><Icon name="plus" /> Add person</Link> : null}</div>
              {people.length === 0 ? <p className="muted px-1 pb-2">Nobody has been added yet. Operators can always open this organization.</p> : (
                <div className="rv-setgrid">
                  {people.map((p) => (
                    <Link key={p.user_id} href={to({ open: `person:${p.user_id}` })} scroll={false} className="rv-set">
                      <span className="min-w-0"><span className="rv-set-label">{ROLE_WORDS[p.role]}</span><span className="rv-set-value">{p.name} <span className="muted">{p.email}</span></span></span>
                      <Icon name="chevron" className="rv-chev" />
                    </Link>
                  ))}
                </div>
              )}

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
