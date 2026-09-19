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
  description?: string | null;
  details?: string | null;
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
    case "create_workspace":
      return `Setting up ${String(payload.name ?? "the new customer")}`;
    case "update_profile":
      return "Saving your settings";
    case "add_document":
      return `Adding “${String(payload.title ?? "a document")}”`;
    case "retire_document":
      return "Retiring a document";
    case "set_panel":
      return `Changing who reviews ${String(payload.kind ?? "").replace(/_/g, " ")} matters`;
    case "set_spend_cap":
      return "Changing the monthly budget";
    default:
      return kind.replace(/_/g, " ");
  }
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Two letters to stand for a seat or a person: "Chief Risk Officer" is CR, "kevin@org" is KE. */
export function initials(name: string): string {
  const words = name.replace(/@.*/, "").split(/[^A-Za-z0-9]+/).filter(Boolean);
  const significant = words.filter((w) => !/^(chief|and|of|the|officer|lead)$/i.test(w));
  if (significant.length >= 2) return (significant[0]![0]! + significant[1]![0]!).toUpperCase();
  return (significant[0] ?? words[0] ?? "?").slice(0, 2).toUpperCase();
}

/**
 * A short code for a seat, from its id rather than its title, because titles collide:
 * "Committee Chair" and "Customer and Conduct Lead" are both CC. chair is CH, customer is CU,
 * cio stays CIO, general_counsel is GC.
 */
export function seatCode(seatId: string): string {
  const parts = seatId.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (parts.length > 1) return parts.map((p) => p[0]).join("").slice(0, 3).toUpperCase();
  const word = parts[0] ?? "?";
  // cio, cro, cfo, ciso are already codes; "risk" and "legal" are words and take two letters
  return (/^c[a-z]{1,2}o$/i.test(word) ? word : word.slice(0, 2)).toUpperCase();
}

/** A stable colour per seat, by its place in the speaking order, so a seat looks the same everywhere. */
export const SEAT_HUES = ["#6938ef", "#1570ef", "#0e9384", "#dc6803", "#c11574", "#4e5ba6", "#079455", "#b42318"] as const;
export function seatColor(index: number): string {
  return SEAT_HUES[((index % SEAT_HUES.length) + SEAT_HUES.length) % SEAT_HUES.length]!;
}

export function firstSentence(text: string | null | undefined, max = 110): string {
  const sentence = (text ?? "").split(/(?<=[.!?])\s/)[0] ?? "";
  return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence;
}

/** How long a matter has been open, in the fewest words. */
export function ageOf(since: string, now: number = Date.now()): string {
  const day = since.length > 7 ? since : `${since}-01`;
  const days = Math.max(0, Math.floor((now - new Date(`${day}T00:00:00`).getTime()) / 86_400_000));
  return days === 0 ? "today" : days === 1 ? "1 day" : `${days} days`;
}

export const FRAMEWORK_LABELS: Record<string, string> = {
  nist_ai_rmf: "NIST AI RMF",
  iso_42001: "ISO/IEC 42001",
  eu_ai_act: "EU AI Act",
  sr_11_7: "SR 11-7",
  none: "None chosen",
};

export const AREA_LABELS: Record<string, string> = {
  workspace: "Customer",
  profile: "Organisation",
  brief: "Adviser brief",
  panel: "Review panel",
  document: "Document",
  budget: "Budget",
};

export const PROFILE_LABELS: Record<string, string> = {
  name: "Organisation name",
  risk_appetite: "Board direction on AI",
  facts: "About the organisation",
  framework: "Control framework",
  business_goals: "Business goals",
  ai_landscape: "AI landscape",
  ai_tools: "AI already in use",
};

/** What changed, in a line: "Board direction on AI", "Brief for the finance seat", "Who reviews vendor matters". */
export function changeTitle(area: string, target: string): string {
  if (area === "profile") return PROFILE_LABELS[target] ?? target;
  if (area === "brief") return `Brief for the ${target.replace(/_/g, " ")} seat`;
  if (area === "panel") return `Who reviews ${target.replace(/_/g, " ")} matters`;
  if (area === "workspace") return "Customer created";
  return target;
}

/** Form fields named d_<key> become a matter's details; d_<key>[] collects a checkbox group. */
export function detailsFromFields(entries: Iterable<[string, FormDataEntryValue]>): Record<string, string | boolean | string[]> {
  const out: Record<string, string | boolean | string[]> = {};
  for (const [name, value] of entries) {
    if (!name.startsWith("d_") || typeof value !== "string") continue;
    const text = value.trim();
    if (name.endsWith("[]")) {
      const key = name.slice(2, -2);
      if (text) out[key] = [...((out[key] as string[] | undefined) ?? []), text.slice(0, 100)];
    } else if (text === "on") {
      out[name.slice(2)] = true;
    } else if (text) {
      out[name.slice(2)] = text.slice(0, 2000);
    }
  }
  return out;
}
