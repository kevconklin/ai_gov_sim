import Link from "next/link";
import { atLeast, orgRole, visibleRuns } from "@/lib/auth/access";
import { currentOperator } from "@/lib/auth/session";
import { first, type SearchParams } from "@/lib/params";
import { ballotsToSign, committeeSeats, decisionsToSign, orgProfile, recentAttestations } from "@/lib/queries/governance";
import { meetingDetail } from "@/lib/queries/meetings";
import { currentScope } from "@/lib/queries/product";
import { decisionBrief, plain, structured } from "@/lib/reviews/brief";
import { KIND_LABELS, benchFor, tally } from "@/lib/reviews/model";
import { convenerOf } from "@/lib/queries/trail";
import { SignDecision } from "../reviews/forms";
import { Avatar, Chip, Fold, Icon, RiskChip, Term, VoteBar } from "../reviews/parts";

function parse<T>(raw: string | null | undefined, fallback: T): T {
  try { return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
}
const who = (s: string | null | undefined) => (s ?? "").replace(/ <.*>$/, "");
const SUPPORT: Record<number, string> = { 1: "Strongly against", 2: "Against", 3: "Undecided", 4: "For", 5: "Strongly for" };

function Structured({ label, text }: { label: string; text: string }) {
  const v = structured(text);
  return (
    <div className="rv-seat-block">
      <span className="rv-seat-label">{label}</span>
      {v.summary ? <p className="rv-prose">{v.summary}</p> : null}
      {v.concerns.length ? <><span className="rv-seat-label" style={{ marginTop: "0.4rem" }}>Concerns</span><ul className="rv-list">{v.concerns.map((c) => <li key={c}>{c}</li>)}</ul></> : null}
      {v.conditions.length ? <><span className="rv-seat-label" style={{ marginTop: "0.4rem" }}>Conditions</span><ul className="rv-list">{v.conditions.map((c) => <li key={c}>{c}</li>)}</ul></> : null}
    </div>
  );
}

/** One decision, with room: the brief, every seat in full, the debate, and the signature. */
export default async function DecidePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const scope = await currentScope(first(sp, "run"), await visibleRuns());
  if (!scope) return <div className="rv"><h1 className="rv-org">No committee yet</h1></div>;
  const runId = scope.run_id;
  const run = encodeURIComponent(runId);
  const decisionId = first(sp, "d") ?? "";
  const [decisions, ballots, seats, org, operator, role, record] = await Promise.all([
    decisionsToSign(runId), ballotsToSign(runId), committeeSeats(runId), orgProfile(runId), currentOperator(), orgRole(runId), recentAttestations(runId),
  ]);
  const d = decisions.find((x) => x.decision_id === decisionId);
  if (!d) {
    return (
      <div className="rv">
        <h1 className="rv-org">Nothing to decide here</h1>
        <p className="muted mt-2">That decision is signed, or it is not on this organization. <Link href={`/reviews?run=${run}&tab=needs`}>Back to Needs you</Link>.</p>
      </div>
    );
  }
  const order = parse<string[]>(org?.seats, []);
  const committee = [...seats].sort((a, b) => (order.indexOf(a.seat) + 1 || 99) - (order.indexOf(b.seat) + 1 || 99));
  const seatIndex = new Map(committee.map((c, i) => [c.seat, i]));
  const mine = ballots.filter((b) => b.decision_id === d.decision_id);
  const bench = benchFor(committee, mine, d.recommended);
  const t = tally(bench);
  const brief = decisionBrief({ recommended: d.recommended, bench, chairSeat: org?.chair_seat ?? null, riskTier: d.risk_tier, reviewTotal: Number(d.review_total), reviewSigned: Number(d.review_signed) });
  const detail = await meetingDetail(d.meeting_id);
  const convener = await convenerOf(runId, d.meeting_id);
  const positions = (detail?.positions ?? []).filter((p) => p.item_id === d.item_id);
  const votes = (detail?.votes ?? []).filter((v) => v.item_id === d.item_id);
  const debate = (detail?.messages ?? []).filter((m) => m.phase === "debate").sort((a, b) => a.seq - b.seq);
  const rounds = new Map<number, typeof debate>();
  for (const m of debate) rounds.set(m.round ?? 1, [...(rounds.get(m.round ?? 1) ?? []), m]);
  const details = parse<Record<string, unknown>>(d.details ?? null, {});
  const notes = Array.isArray(details.decider_notes) ? (details.decider_notes as { by: string; on: string; note: string }[]) : [];
  const flagged = Array.isArray(details.flagged_text) ? (details.flagged_text as string[]) : [];
  const cited = Array.isArray(details.related_decisions) ? (details.related_decisions as string[]) : [];
  const signedById = new Map(record.filter((r) => r.outcome !== "deferred").map((r) => [r.item_id.split("/").pop() ?? r.item_id, r]));
  const agentOf = new Map(mine.map((b) => [b.seat, b.agent_id]));
  const dissents = bench.filter((s) => s.dissent).map((s) => ({ agent_id: agentOf.get(s.seat) ?? s.seat, seat: s.seat, title: s.title, index: seatIndex.get(s.seat) ?? 0, rationale: plain(s.rationale) }));
  const canDecide = atLeast(role, "decides");
  const firmness = brief.firmness === "unanimous" ? <Chip tone="ok" dot>Unanimous</Chip> : brief.firmness === "clear" ? <Chip tone="ai" dot>Clear majority</Chip> : <Chip tone="objection" dot>Split</Chip>;
  const seatOf = (seat: string) => committee.find((c) => c.seat === seat);

  // each seat once: sealed view, then ballot, in speaking order; the ones against the recommendation first
  const perSeat = committee.map((c, i) => {
    const pos = positions.find((p) => p.seat === c.seat);
    const vote = votes.find((v) => v.seat === c.seat);
    const b = bench.find((x) => x.seat === c.seat);
    return { seat: c.seat, title: c.title, index: i, pos, vote, dissent: Boolean(b?.dissent), sat: Boolean(pos || vote) };
  }).filter((s) => s.sat).sort((a, b) => Number(b.dissent) - Number(a.dissent));

  return (
    <div className="rv rv-decide">
      <header className="rv-top">
        <div className="min-w-0">
          <Link href={`/reviews?run=${run}&tab=needs`} className="rv-back"><Icon name="chevron" className="rv-chev is-back" /> Needs you</Link>
          <h1 className="rv-org" style={{ marginTop: "0.2rem" }}>{d.title}</h1>
          <div className="rv-rowmeta" style={{ marginTop: "0.4rem" }}><Chip plain>{KIND_LABELS[d.item_kind ?? d.kind] ?? d.kind}</Chip><RiskChip tier={d.risk_tier} /><Chip plain>{d.item_id}</Chip>{convener ? <Chip plain>Review of {d.meeting_date}, called by {who(convener.who)}</Chip> : null}</div>
        </div>
      </header>

      <div className="rv-decide-grid">
        <main className="rv-decide-main">
          <section className="rv-card rv-brief" data-tone="ai">
            <div className="rv-brief-head">{brief.headline}</div>
            <div className="flex flex-wrap items-center gap-2">{firmness}<VoteBar yes={t.yes} no={t.no} abstain={t.abstain} />{t.sat < t.of ? <Chip plain>{t.sat} of {t.of} seats sat</Chip> : null}</div>
            {brief.why ? <div className="rv-brief-row"><span>Why</span><span>{brief.why.text}<span className="rv-brief-who">{brief.why.seat}</span></span></div> : null}
            {brief.objection ? <div className="rv-brief-row" data-tone="objection"><span><Term word="objection">Strongest objection</Term></span><span>{brief.objection.text}<span className="rv-brief-who">{brief.objection.seat}</span></span></div>
              : <div className="rv-brief-row"><span>Objections</span><span>None. Every seat that sat agreed.</span></div>}
            {notes.length ? <div className="rv-brief-row"><span>Sent back before</span><span>{notes.map((n) => <span key={n.on + n.note} className="block">{n.on}, {who(n.by)}: “{n.note}”</span>)}</span></div> : null}
            {flagged.length ? <div className="rv-brief-row" data-tone="objection"><span>Flagged</span><span>The submission contained text addressed to the advisers, which they were told to ignore: {flagged.join("; ")}.</span></div> : null}
            {cited.length ? <div className="rv-brief-row"><span>Cites</span><span className="flex flex-wrap gap-1.5">{cited.map((id) => { const r = signedById.get(id); return r ? <Link key={id} href={`/reviews?run=${run}&tab=decided&open=record:${encodeURIComponent(r.attestation_id)}`} className="rv-chip" data-tone={r.outcome === "approved" ? "ok" : "no"}>{id} {r.title}</Link> : <Chip key={id} plain>{id}</Chip>; })}</span></div> : null}
          </section>

          {d.description ? <section className="rv-card"><div className="rv-card-h">What was submitted{d.submitted_by ? <span className="muted font-normal">by {who(d.submitted_by)}</span> : null}</div><p className="rv-prose">{d.description}</p></section> : null}

          <section className="rv-card">
            <div className="rv-card-h"><span>Each seat, in full</span><span className="muted font-normal">{t.yes} for, {t.no} against{t.abstain ? `, ${t.abstain} abstained` : ""}</span></div>
            <div className="rv-seats">
              {perSeat.map((s) => (
                <article key={s.seat} className="rv-seat" data-tone={s.dissent ? "objection" : s.vote ? (s.vote.vote === "yes" ? "ok" : s.vote.vote === "no" ? "no" : undefined) : undefined}>
                  <header className="rv-seat-h">
                    <Avatar name={s.title} seat={s.seat} index={s.index} vote={s.vote?.vote} />
                    <span className="min-w-0"><span className="rv-seat-title">{s.title}</span>
                      <span className="rv-rowmeta">
                        {s.pos ? <Chip plain>Sealed: {SUPPORT[s.pos.support] ?? s.pos.support}</Chip> : null}
                        {s.vote ? <Chip tone={s.vote.vote === "yes" ? "ok" : s.vote.vote === "no" ? "no" : undefined} plain={s.vote.vote === "abstain"} dot>Voted {s.vote.vote === "yes" ? "for" : s.vote.vote === "no" ? "against" : "abstain"}</Chip> : <Chip plain>Did not vote</Chip>}
                        {s.dissent ? <Chip tone="objection">Objection</Chip> : null}
                      </span>
                    </span>
                  </header>
                  {s.pos ? <Structured label="Before the debate" text={s.pos.position} /> : null}
                  {s.vote?.rationale ? <Structured label="At the ballot" text={s.vote.rationale} /> : null}
                </article>
              ))}
            </div>
          </section>

          {detail?.meeting.debate_skipped ? (
            <section className="rv-card"><div className="rv-card-h">Debate</div><p className="rv-prose">Skipped: the sealed views already agreed (confidence {Math.round(Number(detail.meeting.debate_skip_p ?? 0) * 100)}%).</p></section>
          ) : rounds.size ? (
            <section className="rv-card">
              <div className="rv-card-h"><span>The debate</span><span className="muted font-normal">{debate.length} turns over {rounds.size} {rounds.size === 1 ? "round" : "rounds"}, every matter in the review</span></div>
              {[...rounds.entries()].map(([round, turns]) => (
                <Fold key={round} title={`Round ${round}`} open={round === 1}>
                  <div className="rv-turns">
                    {turns.map((m) => { const c = m.seat ? seatOf(m.seat) : undefined; return (
                      <div key={m.seq} className="rv-turn">
                        <Avatar name={c?.title ?? m.name ?? "?"} seat={m.seat ?? undefined} index={m.seat ? seatIndex.get(m.seat) : undefined} />
                        <span className="min-w-0"><span className="rv-seat-title">{c?.title ?? m.name ?? "Committee"}</span><p className="rv-prose">{m.text}</p></span>
                      </div>
                    ); })}
                  </div>
                </Fold>
              ))}
            </section>
          ) : null}

          {detail?.meeting.minutes_text ? <Fold title="Minutes, written by the chair"><p className="rv-prose">{detail.meeting.minutes_text}</p></Fold> : null}
        </main>

        <aside className="rv-decide-side">
          <section className="rv-card" data-tone="you">
            <div className="rv-card-h">Your decision</div>
            <p className="rv-hint" style={{ marginTop: 0 }}>{brief.signing}</p>
            {canDecide ? (
              <SignDecision runId={runId} decisionId={d.decision_id} recommended={d.recommended} mustWeighAll={d.risk_tier === "high"}
                dissents={dissents} operator={operator ?? "You"} reviewTotal={Number(d.review_total)} reviewSigned={Number(d.review_signed)}
                agendaItem={{ item_id: d.item_id, kind: "item", title: d.title, ref_id: d.ref_id }} />
            ) : <p className="rv-hint" data-tone="wait">Only someone who decides for this organization can sign. Everything here is yours to read.</p>}
          </section>
          {decisions.length > 1 ? (
            <section className="rv-card">
              <div className="rv-card-h">Also waiting</div>
              <div className="rv-rows">
                {decisions.filter((x) => x.decision_id !== d.decision_id).map((x) => (
                  <Link key={x.decision_id} href={`/decide?run=${run}&d=${encodeURIComponent(x.decision_id)}`} className="rv-rowline">
                    <span className="rv-riskmark" data-tone={x.risk_tier ?? undefined} /><span className="min-w-0"><span className="rv-rowtitle">{x.title}</span><span className="rv-rowmeta"><Chip tone="ai">Recommends {x.recommended === "approved" ? "approve" : "reject"}</Chip></span></span><span className="rv-rowend"><Icon name="chevron" className="rv-chev" /></span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
