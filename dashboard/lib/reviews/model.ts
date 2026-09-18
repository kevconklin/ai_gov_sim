/**
 * Pure shaping for the reviews page: no database, no React, so it can be tested directly.
 *
 * The page's job is to tell a person what needs them now. These helpers turn rows into the
 * three things it shows: the queue of matters waiting for a review, the bench that sat on a
 * decision, and a plain-language line for work the committee has not finished yet.
 */

export const KIND_LABELS: Record<string, string> = {
  use_case: "AI use case",
  tool: "AI tool",
  vendor: "AI vendor",
  policy_change: "Policy change",
  exception: "Policy exception",
  incident: "AI incident",
  question: "Question",
  policy_edit: "Policy wording",
  status_change: "Status change",
};

export interface WaitingRow {
  ref_id: string;
  source: "item" | "use_case" | "policy_edit" | "status_change";
  item_kind: string; // vendor, tool, question, … or the source for matters raised by members
  title: string;
  risk_tier: string | null;
  since: string; // YYYY-MM-DD or YYYY-MM
  submitted_by: string | null;
}

export interface Ranking {
  ref_id: string;
  priority: number;
  reasons: string[];
  deferrals: number;
  escalated: boolean;
}

export interface QueueEntry extends WaitingRow {
  display: string;
  label: string;
  advisory: boolean;
  priority: number | null;
  reasons: string[];
  deferrals: number;
  escalated: boolean;
  /** What the convene form sends for this matter. */
  agenda: { item_id: string; kind: string; title: string; ref_id: string };
}

export function displayId(scopedId: string): string {
  return scopedId.split("/").pop() ?? scopedId;
}

/**
 * Everything waiting, ranked where a ranking exists.
 *
 * The ranking is computed by the worker and may be older than the newest submission, or absent.
 * A matter with no rank is still waiting and must still be shown: an empty queue that is not
 * actually empty is the worst thing this page could say. Unranked matters go last, oldest first.
 */
export function mergeQueue(waiting: WaitingRow[], ranking: Ranking[]): QueueEntry[] {
  const ranks = new Map(ranking.map((r) => [r.ref_id, r]));
  const entries = waiting.map((row): QueueEntry => {
    const rank = ranks.get(row.ref_id);
    const advisory = row.item_kind === "question";
    const label = KIND_LABELS[row.item_kind] ?? row.item_kind;
    const display = displayId(row.ref_id);
    const agendaKind = row.source === "item" ? (advisory ? "advisory" : "item") : row.source;
    return {
      ...row,
      display,
      label,
      advisory,
      priority: rank?.priority ?? null,
      reasons: rank?.reasons ?? [],
      deferrals: rank?.deferrals ?? 0,
      escalated: rank?.escalated ?? false,
      agenda: { item_id: display, kind: agendaKind, title: advisory ? row.title : `${label}: ${row.title}`, ref_id: row.ref_id },
    };
  });
  return entries.sort((a, b) => {
    if (a.priority !== null && b.priority !== null) return b.priority - a.priority || a.since.localeCompare(b.since);
    if (a.priority !== null) return -1;
    if (b.priority !== null) return 1;
    return a.since.localeCompare(b.since);
  });
}

export type SeatVote = "yes" | "no" | "abstain" | "absent";

export interface BenchSeat {
  seat: string;
  title: string;
  vote: SeatVote;
  dissent: boolean;
  rationale: string | null;
}

/**
 * The whole committee in speaking order, with how each seat voted on one decision.
 * A seat with no ballot did not sit on this panel, which is itself worth seeing: a vendor
 * review that seated five of eight should look like five of eight.
 */
export function benchFor(
  committee: { seat: string; title: string }[],
  votes: { seat: string; vote: string; rationale: string | null }[],
  recommended: string,
): BenchSeat[] {
  const cast = new Map(votes.map((v) => [v.seat, v]));
  const against = recommended === "approved" ? "no" : "yes";
  return committee.map((member) => {
    const ballot = cast.get(member.seat);
    const vote: SeatVote = ballot ? (ballot.vote === "yes" || ballot.vote === "no" ? ballot.vote : "abstain") : "absent";
    return { seat: member.seat, title: member.title, vote, dissent: vote === against, rationale: ballot?.rationale ?? null };
  });
}

export function tally(bench: BenchSeat[]): { yes: number; no: number; abstain: number; sat: number; of: number } {
  const count = (v: SeatVote) => bench.filter((s) => s.vote === v).length;
  return { yes: count("yes"), no: count("no"), abstain: count("abstain"), sat: bench.length - count("absent"), of: bench.length };
}

/** A queued command, said the way the person who queued it would say it. */
export function describeWork(kind: string, payloadJson: string | null): string {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(payloadJson ?? "{}") ?? {};
  } catch {
    payload = {};
  }
  const count = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  switch (kind) {
    case "convene": {
      const n = count(payload.agenda) + count(payload.advisory);
      return `The committee is reviewing ${n} ${n === 1 ? "matter" : "matters"}`;
    }
    case "attest":
      return "Recording your decision";
    case "submit":
      return `Adding “${String(payload.title ?? "a matter")}” to the queue`;
    case "candidates":
      return "Refreshing the ranking";
    case "set_brief":
      return `Updating the brief for the ${String(payload.seat ?? "").replace(/_/g, " ")} seat`;
    default:
      return kind.replace(/_/g, " ");
  }
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
