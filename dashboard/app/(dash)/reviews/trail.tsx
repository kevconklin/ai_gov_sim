import type { ReactNode } from "react";
import { SUPPORT_WORDS, buildTrail, debateRounds, seatsThatSat, supportTone, type StepId, type TrailInput } from "@/lib/reviews/trail";
import { Avatar, Chip, Fold, Icon } from "./parts";

interface Seat { seat: string; title: string }

function parse<T>(raw: string | null | undefined, fallback: T): T {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function clock(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

const ICONS: Record<StepId, string> = { convened: "flag", seated: "users", views: "inbox", debate: "chat", ballot: "check", minutes: "pen", decided: "pen" };
const OUTCOME: Record<string, [string, string | undefined]> = { approved: ["Approved", "ok"], rejected: ["Rejected", "no"], deferred: ["Deferred", undefined] };

/**
 * One review from the person who called it to the person who decided, as a timeline.
 * Each step is one line until it is opened. Blue markers are a person; purple are the committee.
 */
export function Trail({ input, committee, focus }: { input: TrailInput; committee: Seat[]; focus?: string }) {
  const steps = buildTrail(input);
  const index = new Map(committee.map((c, i) => [c.seat, i]));
  const titleOf = (seat: string | null) => committee.find((c) => c.seat === seat)?.title ?? (seat ?? "Secretary").replace(/_/g, " ");
  const who = (seat: string | null) => <Avatar name={titleOf(seat)} seat={seat ?? undefined} index={seat ? index.get(seat) : undefined} />;
  // Seats appear in the committee's speaking order everywhere, so a seat is found in the same place each time.
  const bySeat = <T extends { seat: string }>(rows: T[]): T[] => [...rows].sort((a, b) => (index.get(a.seat) ?? 99) - (index.get(b.seat) ?? 99));
  const items = [...input.agenda].sort((a, b) => Number(b.item_id === focus) - Number(a.item_id === focus));
  const sat = [...seatsThatSat(input)].sort((a, b) => (index.get(a) ?? 99) - (index.get(b) ?? 99));
  const rounds = debateRounds(input.messages);

  const detail: Record<StepId, ReactNode> = {
    convened: (
      <dl className="rv-facts">
        {input.convener ? <><dt>Called by</dt><dd>{input.convener.who}</dd><dt>Started</dt><dd>{clock(input.convener.at)}</dd></> : <><dt>Called</dt><dd>From the command line</dd></>}
        {input.convener?.finishedAt ? <><dt>Finished</dt><dd>{clock(input.convener.finishedAt)}</dd></> : null}
        <dt>Agenda</dt>
        <dd className="grid gap-1">{input.agenda.map((a) => <span key={a.item_id}><span className="muted">{a.item_id}</span> {a.title}{a.kind === "advisory" ? <span className="muted"> (advice only)</span> : null}</span>)}</dd>
      </dl>
    ),
    seated: (
      <div className="grid gap-2">
        {sat.map((seat) => <span key={seat} className="flex items-center gap-2">{who(seat)}<span>{titleOf(seat)}</span></span>)}
        {sat.length < committee.length ? <p className="rv-hint">{committee.length - sat.length} of {committee.length} seats were not needed for these matters.</p> : null}
      </div>
    ),
    views: (
      <div className="grid gap-3">
        {items.map((item) => {
          const positions = bySeat(input.positions.filter((p) => p.item_id === item.item_id));
          const perspectives = bySeat(input.perspectives.filter((p) => p.item_id === item.item_id));
          if (!positions.length && !perspectives.length) return null;
          return (
            <div key={item.item_id}>
              <div className="rv-trail-item"><span className="muted">{item.item_id}</span> {item.title}</div>
              {positions.map((p) => {
                const body = parse<{ summary?: string; concerns?: string[]; conditions?: string[] }>(p.position, {});
                return (
                  <Fold key={p.seat} title={titleOf(p.seat)} lead={who(p.seat)} aside={<Chip tone={supportTone(p.support)} plain={!supportTone(p.support)}>{SUPPORT_WORDS[p.support] ?? p.support}</Chip>}>
                    {body.summary ? <p className="rv-prose">{body.summary}</p> : null}
                    {body.concerns?.length ? <p className="rv-hint">Concerns: {body.concerns.join("; ")}</p> : null}
                    {body.conditions?.length ? <p className="rv-hint">Conditions: {body.conditions.join("; ")}</p> : null}
                  </Fold>
                );
              })}
              {perspectives.map((p) => (
                <Fold key={p.seat} title={titleOf(p.seat)} lead={who(p.seat)} aside={<Chip tone={supportTone(p.stance)} plain={!supportTone(p.stance)}>{SUPPORT_WORDS[p.stance] ?? p.stance}</Chip>}>
                  <p className="rv-prose">{p.position}</p>
                  <p className="rv-hint">Concern: {p.key_concern}</p>
                  <p className="rv-hint">Would change their mind: {p.would_change_my_mind}</p>
                </Fold>
              ))}
            </div>
          );
        })}
      </div>
    ),
    debate: (
      <div className="grid gap-3">
        {rounds.map((r) => (
          <div key={r.round}>
            <div className="rv-trail-item">Round {r.round}</div>
            <div className="grid gap-2.5">
              {r.turns.map((m) => (
                <div key={m.seq} className="rv-turn">
                  {who(m.seat)}
                  <div className="min-w-0"><div className="rv-turn-who">{titleOf(m.seat)}</div><p className="rv-prose">{m.text}</p></div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    ),
    ballot: (
      <div className="grid gap-3">
        {items.map((item) => {
          const votes = bySeat(input.votes.filter((v) => v.item_id === item.item_id));
          if (!votes.length) return null;
          const d = input.decisions.find((x) => x.item_id === item.item_id);
          return (
            <div key={item.item_id}>
              <div className="rv-trail-item">
                <span><span className="muted">{item.item_id}</span> {item.title}</span>
                {d ? <Chip tone="ai">{d.outcome === "approved" ? "Carried" : "Did not carry"} {d.yes_votes}–{d.no_votes}</Chip> : null}
              </div>
              {votes.map((v) => (
                <Fold key={v.seat} title={titleOf(v.seat)} lead={who(v.seat)}
                  aside={<Chip tone={v.vote === "yes" ? "ok" : v.vote === "no" ? "no" : undefined} plain={v.vote === "abstain"}>{v.vote === "yes" ? "For" : v.vote === "no" ? "Against" : "Abstained"}</Chip>}>
                  <p className="rv-prose">{v.rationale || "No reason was recorded."}</p>
                </Fold>
              ))}
            </div>
          );
        })}
      </div>
    ),
    minutes: <p className="rv-prose">{input.minutes}</p>,
    decided: (
      <div className="grid gap-2">
        {input.decisions.map((d) => {
          const s = input.signatures.find((x) => x.decision_id === d.decision_id);
          const [label, tone] = s ? (OUTCOME[s.outcome] ?? [s.outcome, undefined]) : ["Not signed yet", undefined];
          const overruled = s && s.outcome !== "deferred" && s.outcome !== d.outcome;
          return (
            <div key={d.decision_id} className="rv-card" data-tone={s ? "you" : undefined}>
              <div className="rv-card-h">
                <span>{d.item_id}</span>
                <span className="inline-flex gap-1.5">{tone ? <Chip tone={tone} solid>{label}</Chip> : <Chip plain>{label}</Chip>}{overruled ? <Chip tone="objection">Overruled</Chip> : null}</span>
              </div>
              {s ? (
                <>
                  <p className="rv-prose">{s.rationale}</p>
                  <p className="rv-hint">{s.actor}, {clock(s.created_at)}. {s.source === "dashboard_session" ? "Signed in here under this name." : s.source === "cli_asserted" ? "Name given at the command line, not verified." : ""}</p>
                </>
              ) : <p className="rv-hint" style={{ marginTop: 0 }}>The committee {d.outcome === "approved" ? "recommended approving" : "recommended rejecting"} it. Nothing applies until it is signed.</p>}
            </div>
          );
        })}
      </div>
    ),
  };

  const hasDetail = (id: StepId) => (id === "minutes" ? Boolean(input.minutes) : id === "decided" ? input.decisions.length > 0 : id === "debate" ? rounds.length > 0
    : id === "views" ? input.positions.length + input.perspectives.length > 0 : id === "ballot" ? input.votes.length > 0 : true);

  return (
    <ol className="rv-trail">
      {steps.map((step) => (
        <li key={step.id} className={`rv-step${step.done ? "" : " is-open"}`} data-tone={step.by}>
          <span className="rv-step-mark"><Icon name={ICONS[step.id]} /></span>
          {hasDetail(step.id) ? (
            <details className="rv-step-body">
              <summary><span className="rv-step-title">{step.title}</span><span className="rv-step-summary">{step.summary}</span><Icon name="chevron" className="rv-chev" /></summary>
              <div className="rv-step-detail">{detail[step.id]}</div>
            </details>
          ) : (
            <div className="rv-step-body"><div className="rv-step-line"><span className="rv-step-title">{step.title}</span><span className="rv-step-summary">{step.summary}</span></div></div>
          )}
        </li>
      ))}
    </ol>
  );
}
