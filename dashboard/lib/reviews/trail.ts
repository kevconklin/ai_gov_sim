/**
 * The audit trail of one review, as an ordered list of steps. Pure, so it can be tested.
 *
 * The order is the order things happened in, which is the point of an audit trail: a person
 * convened it, a panel was seated, each member committed to a view before hearing anyone else,
 * they debated, they voted in secret, the chair wrote it up, and a person decided. Each step
 * carries a one-line summary for scanning; the detail behind it is read on request.
 */

export interface TrailMessage { seat: string | null; name: string | null; phase: string; round: number | null; seq: number; text: string }
export interface TrailPosition { seat: string; item_id: string; support: number; position: string }
export interface TrailPerspective { seat: string; item_id: string; stance: number; position: string; key_concern: string; would_change_my_mind: string }
export interface TrailVote { seat: string; item_id: string; vote: string; rationale: string | null }
export interface TrailDecision { decision_id: string; item_id: string; outcome: string; yes_votes: number; no_votes: number; abstentions: number }
export interface TrailSignature { decision_id: string; actor: string; outcome: string; rationale: string; source: string; created_at: string }

export interface TrailInput {
  status: string;
  agenda: { item_id: string; kind: string; title: string }[];
  messages: TrailMessage[];
  positions: TrailPosition[];
  perspectives: TrailPerspective[];
  votes: TrailVote[];
  decisions: TrailDecision[];
  signatures: TrailSignature[];
  minutes: string | null;
  convener: { who: string; at: string; finishedAt: string | null } | null;
}

export type StepId = "convened" | "seated" | "views" | "debate" | "ballot" | "minutes" | "decided";
export interface Step { id: StepId; by: "you" | "ai"; title: string; summary: string; done: boolean }

/** Seats that took any part, in the order they first appear. */
export function seatsThatSat(input: Pick<TrailInput, "messages" | "positions" | "perspectives" | "votes">): string[] {
  const seen: string[] = [];
  const add = (seat: string | null) => { if (seat && !seen.includes(seat)) seen.push(seat); };
  input.positions.forEach((p) => add(p.seat));
  input.perspectives.forEach((p) => add(p.seat));
  input.messages.filter((m) => m.phase === "debate").forEach((m) => add(m.seat));
  input.votes.forEach((v) => add(v.seat));
  return seen;
}

/** The debate, grouped into its rounds, in speaking order. */
export function debateRounds(messages: TrailMessage[]): { round: number; turns: TrailMessage[] }[] {
  const rounds = new Map<number, TrailMessage[]>();
  for (const m of messages.filter((x) => x.phase === "debate").sort((a, b) => a.seq - b.seq)) {
    const round = m.round ?? 1;
    rounds.set(round, [...(rounds.get(round) ?? []), m]);
  }
  return [...rounds.entries()].sort(([a], [b]) => a - b).map(([round, turns]) => ({ round, turns }));
}

const many = (n: number, one: string, more = `${one}s`) => `${n} ${n === 1 ? one : more}`;

export function buildTrail(input: TrailInput): Step[] {
  const sat = seatsThatSat(input);
  const turns = input.messages.filter((m) => m.phase === "debate").length;
  const rounds = debateRounds(input.messages).length;
  const views = input.positions.length + input.perspectives.length;
  const signed = input.signatures.length;
  const failed = input.status === "failed";

  const steps: Step[] = [
    { id: "convened", by: "you", done: true, title: "Convened",
      summary: input.convener ? `${input.convener.who} called a review of ${many(input.agenda.length, "matter")}` : `A review of ${many(input.agenda.length, "matter")}` },
    { id: "seated", by: "ai", done: sat.length > 0, title: "Panel seated", summary: sat.length ? `${many(sat.length, "adviser")} sat` : "Nobody was seated" },
    { id: "views", by: "ai", done: views > 0, title: "Sealed views",
      summary: views ? `${many(views, "view")} recorded before anyone spoke` : "None recorded" },
    { id: "debate", by: "ai", done: turns > 0, title: "Debate", summary: turns ? `${many(turns, "turn")} over ${many(rounds, "round")}` : "No discussion was recorded" },
    { id: "ballot", by: "ai", done: input.votes.length > 0, title: "Secret ballot",
      summary: input.decisions.length
        ? input.decisions.map((d) => `${d.item_id} ${d.outcome === "approved" ? "carried" : "did not carry"} ${d.yes_votes}–${d.no_votes}`).join(", ")
        : "Nothing was put to a vote" },
    { id: "minutes", by: "ai", done: Boolean(input.minutes), title: "Minutes", summary: input.minutes ? "Written by the chair" : "Not written" },
    { id: "decided", by: "you", done: input.decisions.length > 0 && signed === input.decisions.length, title: "Your decision",
      summary: input.decisions.length === 0 ? "Advice only, so nothing to sign"
        : signed === 0 ? `Waiting on you: ${many(input.decisions.length, "decision")} to sign`
        : `${signed} of ${input.decisions.length} signed` },
  ];
  // A review that died part-way did not reach the later steps, whatever rows it left behind.
  return failed ? steps.map((s) => (s.id === "convened" ? s : { ...s, done: s.done && s.id !== "minutes" && s.id !== "decided" })) : steps;
}

export function supportTone(n: number): "ok" | "no" | undefined {
  return n >= 4 ? "ok" : n <= 2 ? "no" : undefined;
}
export const SUPPORT_WORDS = ["", "Strongly against", "Against", "Neutral", "In favour", "Strongly in favour"];
