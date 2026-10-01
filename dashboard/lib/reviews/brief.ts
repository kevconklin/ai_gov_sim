/**
 * The decision page, read top down. Before any vote table or trail, a person deciding needs four
 * things in plain words: what the committee recommends and how firmly, the reason the majority
 * gave, the strongest objection, and what their signature does. All of it is drawn from the
 * ballots already on the record; nothing here calls a model or adds a word the advisers did not say.
 */

import { tally, type BenchSeat } from "./model";

export interface DecisionBrief {
  headline: string;          // "The committee recommends approving it, 5 to 1."
  firmness: "unanimous" | "clear" | "split";
  why: { seat: string; text: string } | null;         // the majority's reason, from one seat
  objection: { seat: string; text: string } | null;   // the strongest dissent
  signing: string;           // what your signature does
}

/** Some early ballots stored the structured vote as JSON; the person should read the summary, not the braces. */
export function plain(text: string | null): string {
  const raw = (text ?? "").trim();
  if (!raw.startsWith("{")) return raw;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const pick = ["summary", "rationale", "reason", "position"].map((k) => v[k]).find((x) => typeof x === "string" && x.trim());
    if (typeof pick === "string") return pick.trim();
    const concerns = Array.isArray(v.concerns) ? v.concerns.filter((c) => typeof c === "string") : [];
    return concerns.length ? `Concerns: ${concerns.join(", ")}.` : raw;
  } catch {
    return raw;
  }
}

const sentences = (text: string | null): string[] =>
  plain(text).split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);

/** The first two sentences, or the first if it is already long. */
function gist(text: string | null, max = 260): string {
  const parts = sentences(text);
  if (!parts.length) return "";
  const two = parts.slice(0, 2).join(" ");
  const out = two.length <= max || parts.length === 1 ? two : parts[0]!;
  return out.length > max ? `${out.slice(0, max - 1).trimEnd()}…` : out;
}

/** The seat whose reason best stands for a side: the chair if it sat there, else whoever wrote the most. */
function spokesman(side: BenchSeat[], chairSeat: string | null): BenchSeat | null {
  const withReason = side.filter((s) => (s.rationale ?? "").trim());
  if (!withReason.length) return null;
  return withReason.find((s) => s.seat === chairSeat) ?? withReason.reduce((a, b) => ((b.rationale ?? "").length > (a.rationale ?? "").length ? b : a));
}

export function decisionBrief(input: {
  recommended: string;
  bench: BenchSeat[];
  chairSeat: string | null;
  riskTier: string | null;
  reviewTotal: number;
  reviewSigned: number;
}): DecisionBrief {
  const t = tally(input.bench);
  const approving = input.recommended === "approved";
  const forSide = input.bench.filter((s) => s.vote === (approving ? "yes" : "no"));
  const against = input.bench.filter((s) => s.dissent);
  const forCount = forSide.length;
  const againstCount = against.length;

  // "clear" needs three for every one against; 2 to 1 is a split, and should read as one
  const firmness: DecisionBrief["firmness"] = againstCount === 0 ? "unanimous" : forCount >= againstCount * 3 ? "clear" : "split";
  const count = againstCount === 0 && t.abstain === 0 ? "unanimously" : `${forCount} to ${againstCount}${t.abstain ? `, ${t.abstain} abstaining` : ""}`;
  const headline = `The committee recommends ${approving ? "approving" : "rejecting"} it, ${count}.`;

  const why = spokesman(forSide, input.chairSeat);
  const objection = spokesman(against, input.chairSeat);
  const left = input.reviewTotal - input.reviewSigned - 1;
  // one line: what the signature does and when; the form beneath says the rest when it matters
  const signing = [
    left > 0 ? `Takes effect once the other ${left === 1 ? "matter" : `${left} matters`} from this review ${left === 1 ? "is" : "are"} signed.` : "Takes effect as soon as you sign.",
    "Deciding the other way overrules the committee, and the record says so.",
    input.riskTier === "high" && againstCount ? "High risk: tick each objection as weighed first." : "",
  ].filter(Boolean).join(" ");

  return {
    headline,
    firmness,
    why: why ? { seat: why.title, text: gist(why.rationale) } : null,
    objection: objection ? { seat: objection.title, text: gist(objection.rationale) } : null,
    signing,
  };
}
