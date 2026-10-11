import Link from "next/link";
import { atLeast, orgRole, visibleRuns } from "@/lib/auth/access";
import { first, type SearchParams } from "@/lib/params";
import { committeeSeats, modelCatalog, orgProfile, panelOverrides } from "@/lib/queries/governance";
import { currentScope } from "@/lib/queries/product";
import { KIND_LABELS, PROVIDER_TONES, STANCE_WORDS, firstSentence, seatColor } from "@/lib/reviews/model";
import { Avatar, Chip, Help, Icon } from "../reviews/parts";

function parse<T>(raw: string | null | undefined, fallback: T): T { try { return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; } }
const MATTER_KINDS = ["use_case", "tool", "vendor", "policy_change", "exception", "incident", "question"];

/** The committee as the organization configured it: who sits, what each argues for, which model, and who reviews what. */
export default async function CommitteePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const scope = await currentScope(first(sp, "run"), await visibleRuns());
  if (!scope) return <div className="rv"><h1 className="rv-org">No committee yet</h1></div>;
  const runId = scope.run_id;
  const run = encodeURIComponent(runId);
  const [seats, org, panels, catalog, role] = await Promise.all([committeeSeats(runId), orgProfile(runId), panelOverrides(runId), modelCatalog(), orgRole(runId)]);
  const canRun = atLeast(role, "runs");
  const order = parse<string[]>(org?.seats, []);
  const committee = [...seats].sort((a, b) => (order.indexOf(a.seat) + 1 || 99) - (order.indexOf(b.seat) + 1 || 99));
  const modelOf = (ref: string | null) => catalog.find((m) => m.model_id === ref);
  const panelFor = (kind: string): string[] | null => { const row = panels.find((x) => x.kind === kind && x.risk_tier === "*"); return row ? parse<string[]>(row.seats, []) : null; };
  const titleOf = (seat: string) => committee.find((c) => c.seat === seat)?.title ?? seat.replace(/_/g, " ");
  const edit = (open: string) => `/reviews?run=${run}&tab=committee&open=${encodeURIComponent(open)}`;

  return (
    <div className="rv">
      <header className="rv-top">
        <div className="flex flex-wrap items-center gap-2.5"><h1 className="rv-org">Committee</h1><Chip plain>{scope.name}</Chip><Help><p><strong>Each seat is an AI adviser with a brief:</strong> what it argues for and what it is blind to. The brief, the model, and who sits for which kind of matter are yours to change; every change asks why and goes on the record.</p></Help></div>
        <div className="rv-top-actions">
          {canRun ? <Link href={edit("seat:new")} className="rv-btn"><Icon name="plus" /> Add a seat</Link> : null}
          <Link href={`/reviews?run=${run}&tab=settings`} className="rv-btn">Settings</Link>
        </div>
      </header>

      {org ? (
        <section className="rv-card" data-tone="you">
          <div className="rv-card-h"><span>What every seat is told</span>{canRun ? <Link href={`/reviews?run=${run}&tab=settings&open=setting:risk_appetite`} className="rv-btn rv-btn-sm">Edit</Link> : null}</div>
          <p className="rv-prose" style={{ fontStyle: "italic" }}>“{org.risk_appetite}”</p>
          <p className="rv-hint">The board's direction. Every review argues from it. {org.facts ? `About the organization: ${firstSentence(org.facts, 160)}` : ""}</p>
        </section>
      ) : null}

      <section className="rv-board">
        <nav className="rv-tabs" aria-label="Seats"><span className="rv-tab" aria-current="page">Seats<span className="rv-tab-count">{committee.length}</span></span><span className="rv-lead muted text-xs">In speaking order. The chair opens, closes, and breaks ties.</span></nav>
        <div className="rv-seatgrid">
          {committee.map((c, i) => {
            const m = modelOf(c.model);
            return (
              <Link key={c.seat} href={edit(`seat:${c.seat}`)} className="rv-seatcard" style={{ "--seat": seatColor(i) } as React.CSSProperties}>
                <div className="rv-seat-h">
                  <Avatar name={c.title} seat={c.seat} index={i} large />
                  <span className="min-w-0"><span className="rv-seat-title">{c.title}</span><span className="rv-rowmeta">{org?.chair_seat === c.seat ? <Chip tone="ai">Chair</Chip> : null}{c.model ? <Chip tone={PROVIDER_TONES[m?.provider ?? ""] ?? undefined} plain={!m}>{m?.label ?? c.model}</Chip> : <Chip plain>Default model</Chip>}<Chip plain>{STANCE_WORDS[Math.round(Number(c.stance_baseline))] ?? "Balanced"}</Chip></span></span>
                </div>
                <p className="rv-seatcard-brief">{firstSentence(c.persona_text, 220)}</p>
                <span className="rv-story-link">Brief and settings <Icon name="chevron" className="rv-chev" /></span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="rv-board">
        <nav className="rv-tabs" aria-label="Panels"><span className="rv-tab" aria-current="page">Who reviews what</span><span className="rv-lead muted text-xs">High risk always seats everyone. The chair always sits.</span></nav>
        <div className="rv-rows">
          {MATTER_KINDS.map((k) => {
            const chosen = panelFor(k);
            return (
              <Link key={k} href={edit(`panel:${k}`)} className="rv-rowline">
                <span className="min-w-0"><span className="rv-rowtitle">{KIND_LABELS[k] ?? k}</span><span className="rv-rowmeta">{chosen ? chosen.map((s) => <Chip key={s} plain>{titleOf(s)}</Chip>).slice(0, 3) : <span className="muted text-xs">The default panel for this kind</span>}{chosen && chosen.length > 3 ? <span className="muted text-xs">and {chosen.length - 3} more</span> : null}</span></span>
                <span className="rv-rowend"><Icon name="chevron" className="rv-chev" /></span>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
