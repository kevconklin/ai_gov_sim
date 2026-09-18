import { currentOperator } from "@/lib/auth/session";
import { BANK_LABELS } from "@/lib/constants";
import { first, href, type SearchParams } from "@/lib/params";
import {
  ballotsToSign,
  committeeSeats,
  decidedCount,
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
import { benchFor, describeWork, displayId, KIND_LABELS, mergeQueue, plural, type Ranking } from "@/lib/reviews/model";
import { Bench } from "./bench";
import { AutoRefresh, BriefForm, Queue, RefreshRanking, SignDecision, SubmitMatter, WorkspacePicker, type Scope } from "./forms";

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
  const parsed = parse<{ error?: string }>(result, {});
  return (parsed.error ?? "It did not go through.").replace(/^\w+Error: /, "").replace(/^AttestationInvalid: /, "");
}

const STALE_MS = 45_000;

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const scopes = await reviewScopes();
  if (scopes.length === 0) {
    return (
      <div className="rv">
        <h1 className="rv-org">No committee yet</h1>
        <p className="rv-lede" style={{ marginTop: "0.5rem" }}>
          Create one for your organisation, then reload: <code>python -m sim workspace --name &quot;Your organisation&quot; --risk-appetite &quot;…&quot;</code>
        </p>
      </div>
    );
  }
  const scope = scopes.find((s) => s.run_id === first(sp, "run")) ?? scopes[0]!;
  const runId = scope.run_id;
  const view = first(sp, "view");

  const [operator, org, decisions, ballots, waiting, ranked, work, decided, syntheses, record, seats] = await Promise.all([
    currentOperator(),
    orgProfile(runId),
    decisionsToSign(runId),
    ballotsToSign(runId),
    waitingMatters(runId),
    latestCandidates(runId),
    openWork(runId),
    decidedCount(runId),
    recentSyntheses(runId),
    recentAttestations(runId),
    committeeSeats(runId),
  ]);

  const order = parse<string[]>(org?.seats, []);
  const committee = [...seats].sort((a, b) => (order.indexOf(a.seat) + 1 || 99) - (order.indexOf(b.seat) + 1 || 99));
  const ranking = parse<{ candidates?: Ranking[] }>(JSON.stringify(ranked?.result ?? {}), {}).candidates ?? [];
  const queue = mergeQueue(waiting, ranking);
  const pending = work.filter((w) => w.status !== "failed");
  const failed = work.filter((w) => w.status === "failed");
  const reviewing = pending.filter((w) => w.kind === "convene").length;
  const stale = pending.some((w) => Date.now() - new Date(w.created_at).getTime() > STALE_MS);

  const decidedSigned = record.filter((r) => r.outcome !== "deferred");
  const overrides = decidedSigned.filter((r) => r.outcome !== r.recommended).length;
  const tab = view === "record" || view === "committee" || view === "advice" ? view : syntheses.length ? "advice" : "record";
  const scopeOptions: Scope[] = scopes.map((s) => ({ run_id: s.run_id, label: scopeLabel(s), workspace: s.condition === "workspace" }));

  return (
    <div className="rv">
      <AutoRefresh active={pending.length > 0} />

      <header className="rv-masthead">
        <div>
          <h1 className="rv-org">{org?.name ?? scopeLabel(scope)}</h1>
          {org ? (
            <blockquote className="rv-direction">
              “{org.risk_appetite}”
              <cite>The board’s direction on AI. The committee argues from it.</cite>
            </blockquote>
          ) : (
            <p className="rv-direction" style={{ fontStyle: "normal", fontFamily: "var(--font-ui)", fontSize: 14 }}>
              A simulated run. Its organisation is fictional and its committee is briefed from files.
            </p>
          )}
        </div>
        {scopes.length > 1 ? <WorkspacePicker scopes={scopeOptions} current={runId} /> : null}
      </header>

      <nav aria-label="Where matters are">
        <ol className="rv-flow">
          <li><a href="#queue"><span className="rv-flow-count">{queue.length}</span><span className="rv-flow-label">waiting for a review</span></a></li>
          <li><a href="#work"><span className="rv-flow-count">{reviewing}</span><span className="rv-flow-label">with the committee</span></a></li>
          <li>
            <a href="#decide" className={decisions.length ? "is-yours" : undefined}>
              <span className="rv-flow-count">{decisions.length}</span>
              <span className="rv-flow-label">{decisions.length === 1 ? "needs your decision" : "need your decision"}</span>
            </a>
          </li>
          <li><a href={`${href("/reviews", sp, { view: "record" })}#after`}><span className="rv-flow-count">{decided}</span><span className="rv-flow-label">decided</span></a></li>
        </ol>
      </nav>

      {pending.length + failed.length > 0 ? (
        <ul className="rv-work" id="work" aria-live="polite">
          {pending.map((w) => (
            <li key={w.command_id}><span className="rv-dot is-live" aria-hidden /><span>{describeWork(w.kind, w.payload)}.</span></li>
          ))}
          {stale ? (
            <li>
              <span className="rv-dot" aria-hidden />
              <span className="muted">Still waiting. The committee only works while the worker is running: <code>python -m sim serve</code></span>
            </li>
          ) : null}
          {failed.map((w) => (
            <li key={w.command_id}>
              <span className="rv-dot is-failed" aria-hidden />
              <span><span style={{ color: "var(--plum)", fontWeight: 600 }}>{describeWork(w.kind, w.payload)} did not go through.</span>{" "}
                {errorOf(w.result)} <span className="muted">({when(w.created_at)})</span></span>
            </li>
          ))}
        </ul>
      ) : <span id="work" />}

      <section className="rv-section" id="decide">
        <div className="rv-h2"><h2>Needs your decision</h2></div>
        {decisions.length === 0 ? (
          <p className="rv-quiet">
            Nothing is waiting on you. {queue.length ? "Convene a review of the matters below and its recommendations will land here." : "Submit a matter to get started."}
          </p>
        ) : decisions.map((d) => {
          const bench = benchFor(committee, ballots.filter((b) => b.decision_id === d.decision_id), d.recommended);
          const agentOf = new Map(ballots.filter((b) => b.decision_id === d.decision_id).map((b) => [b.seat, b.agent_id]));
          const dissents = bench.filter((s) => s.dissent).map((s) => ({ agent_id: agentOf.get(s.seat) ?? s.seat, title: s.title, rationale: s.rationale }));
          return (
            <article key={d.decision_id} className="rv-case">
              <div className="rv-case-advice">
                <div className="rv-case-meta">
                  <span>{d.item_id}</span>
                  <span>{KIND_LABELS[d.item_kind ?? d.kind] ?? d.kind}</span>
                  {d.risk_tier ? <span className={d.risk_tier === "high" ? "rv-tier-high" : undefined}>{d.risk_tier} risk</span> : null}
                  {d.submitted_by ? <span>from {d.submitted_by}</span> : null}
                  <span>reviewed {d.meeting_date}</span>
                </div>
                <h3 className="rv-title">{d.title}</h3>
                {d.description ? <p className="rv-desc">{d.description}</p> : null}
                <div className="rv-rec">
                  <span>
                    <strong>The committee recommends {d.recommended === "approved" ? "approving" : "rejecting"} this.</strong>{" "}
                    <span className="rv-machine">Advice from AI advisers. You decide.</span>
                  </span>
                  <Bench bench={bench} />
                </div>
              </div>
              <div className="rv-case-yours">
                <SignDecision runId={runId} decisionId={d.decision_id} recommended={d.recommended}
                  mustWeighAll={d.risk_tier === "high"} dissents={dissents} operator={operator ?? "You"}
                  reviewTotal={Number(d.review_total)} reviewSigned={Number(d.review_signed)} />
              </div>
            </article>
          );
        })}
      </section>

      <section className="rv-section" id="queue">
        <div className="rv-h2">
          <h2>Waiting for a review</h2>
          <span className="rv-aside inline-flex flex-wrap items-center gap-2">
            {queue.length ? (ranked ? `Ranked ${when(ranked.at)}` : "Not ranked yet") : null}
            {queue.length ? <RefreshRanking runId={runId} /> : null}
          </span>
        </div>
        <p className="rv-lede">
          Most urgent first. The number weighs risk, how long it has waited, and whether it was put off before.
          The committee never sees it.
        </p>
        <div className="mb-4"><SubmitMatter runId={runId} /></div>
        {queue.length === 0
          ? <p className="rv-quiet">The queue is empty. Anything you submit waits here until you convene a review of it.</p>
          : <Queue runId={runId} entries={queue} />}
      </section>

      <section className="rv-section" id="after">
        <nav className="rv-tabs" aria-label="What has been said and done">
          <a href={`${href("/reviews", sp, { view: "advice" })}#after`} aria-current={tab === "advice" ? "page" : undefined}>Advice given ({syntheses.length})</a>
          <a href={`${href("/reviews", sp, { view: "record" })}#after`} aria-current={tab === "record" ? "page" : undefined}>The record ({record.length})</a>
          <a href={`${href("/reviews", sp, { view: "committee" })}#after`} aria-current={tab === "committee" ? "page" : undefined}>The committee ({committee.length})</a>
        </nav>

        {tab === "advice" ? (
          syntheses.length === 0 ? <p className="rv-quiet">No questions have been put to the committee yet. Submit one as “A question”.</p> : syntheses.map((s) => {
            const question = parse<{ item_id: string; title: string }[]>(s.agenda, []).find((i) => i.item_id === s.item_id)?.title ?? s.item_id;
            const sides: [string, string[]][] = [["In favour", parse<string[]>(s.for_seats, [])], ["Against", parse<string[]>(s.against_seats, [])], ["Undecided", parse<string[]>(s.undecided_seats, [])]];
            const titleOf = (seat: string) => committee.find((c) => c.seat === seat)?.title ?? seat.replace(/_/g, " ");
            return (
              <article key={s.synthesis_id} className="rv-advice">
                <div className="rv-case-meta"><span>{s.item_id}</span><span>{s.sim_month}</span><span>{s.split ? "The committee was divided" : "The committee broadly agreed"}</span></div>
                <h3 className="rv-title" style={{ fontSize: 20 }}>{question}</h3>
                {s.narrative ? <p className="rv-desc">{s.narrative}</p> : null}
                <dl className="rv-sides">
                  {sides.map(([label, list]) => (
                    <div key={label}><dt>{label}</dt><dd>{list.length ? list.map(titleOf).join(", ") : "No one"}</dd></div>
                  ))}
                </dl>
                <ul className="rv-checks">
                  <li style={{ display: "block", fontWeight: 650 }}>What would change each mind</li>
                  {parse<[string, string][]>(s.checks, []).map(([seat, what]) => (
                    <li key={seat}><span className="rv-seatname">{titleOf(seat)}</span><span>{what}</span></li>
                  ))}
                </ul>
              </article>
            );
          })
        ) : null}

        {tab === "record" ? (
          record.length === 0 ? <p className="rv-quiet">Nothing has been signed yet.</p> : (
            <>
              <p className="rv-lede" style={{ marginTop: 0 }}>
                {decidedSigned.length
                  ? `You overruled the committee on ${overrides} of ${plural(decidedSigned.length, "decision")}.${overrides === 0 && decidedSigned.length >= 5 ? " Never overruling it can mean its advice is being waved through." : ""}`
                  : "Only deferrals so far."}
              </p>
              <div className="overflow-x-auto">
                <table className="rv-record">
                  <thead><tr><th>Matter</th><th>Committee said</th><th>Decision</th><th>Signed by</th><th>Reasoning</th></tr></thead>
                  <tbody>
                    {record.map((r) => (
                      <tr key={r.attestation_id}>
                        <td><span className="muted">{r.item_id}</span><br />{r.title}</td>
                        <td className="muted">{r.recommended === "approved" ? "Approve" : "Reject"}</td>
                        <td>
                          <span className={`rv-outcome is-${r.outcome}`}>{r.outcome === "approved" ? "Approved" : r.outcome === "rejected" ? "Rejected" : "Deferred"}</span>
                          {r.outcome !== "deferred" && r.outcome !== r.recommended ? <><br /><span className="rv-flag" style={{ fontSize: 13 }}>overruled</span></> : null}
                        </td>
                        <td>
                          <span className="rv-who">{r.actor}</span><br />
                          <span className="muted" style={{ fontSize: 13 }}>
                            {when(r.created_at)}{r.source === "dashboard_session" ? ", signed in here" : r.source === "cli_asserted" ? ", name given at the command line" : ""}
                          </span>
                        </td>
                        <td style={{ maxWidth: "26rem" }}>{r.rationale}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )
        ) : null}

        {tab === "committee" ? (
          <>
            <p className="rv-lede" style={{ marginTop: 0 }}>
              Each seat is an AI adviser with its own lens. A review seats only the ones a matter needs; the chair always sits.
            </p>
            <div className="rv-seats">
              {committee.map((seat) => (
                <details key={seat.seat}>
                  <summary>{seat.title} <span>{displayId(seat.seat).replace(/_/g, " ")}</span></summary>
                  {seat.persona_text === null
                    ? <p className="rv-brief muted">Briefed from a file, because this is a simulated run. It cannot be edited here.</p>
                    : <><p className="rv-brief">{seat.persona_text}</p><BriefForm runId={runId} seat={seat} /></>}
                </details>
              ))}
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
