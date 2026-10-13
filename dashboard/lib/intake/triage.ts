/**
 * Plain-question intake. Nobody submitting a matter should have to know what a "vendor" is to
 * the committee or what "medium risk" means. They answer what it is, who would use it, what it
 * sees, and whether it helps decide anything about a person; the kind and the risk tier follow
 * from that, with the reasons shown back. Anyone who knows the vocabulary can still set them by hand.
 */

export const NEEDS = {
  use_tool: { label: "Use an AI tool or service", hint: "Something you buy or sign up for: ChatGPT, Copilot, a vendor's AI feature." },
  project: { label: "Build or run something with AI", hint: "A project or process of our own that uses AI." },
  problem: { label: "Report something that went wrong", hint: "An AI tool produced a harmful, unfair, misleading, or insecure result, or data went where it should not." },
  question: { label: "Ask the committee a question", hint: "You want its view, not a decision." },
  policy: { label: "Change the policy, or ask for an exception", hint: "The rule is wrong, or it should not apply to you for a while." },
} as const;
export type Need = keyof typeof NEEDS;

export const WHO = { staff: "Staff, inside the organization", customers: "Customers, patients, members, or the public", both: "Both" } as const;
export type Who = keyof typeof WHO;

export const DATA_CLASSES = {
  none: "Nothing sensitive, or public information only",
  personal: "Personal information about customers, patients, or members",
  employee: "Personal information about employees",
  health: "Health information",
  financial: "Financial or payment information",
  confidential: "Confidential business or client information",
} as const;
export type DataClass = keyof typeof DATA_CLASSES;

export const DECIDES = {
  no: "No, it does not touch decisions about people",
  advises: "It helps a person who decides",
  decides: "It decides on its own",
} as const;
export type Decides = keyof typeof DECIDES;

export const SOURCES = {
  bought: "A product or service from a company",
  embedded: "An AI feature that appeared in software we already use",
  built: "Something we build or run ourselves",
} as const;
export type Source = keyof typeof SOURCES;

export interface TriageAnswers {
  need: Need;
  who: Who;
  data: DataClass[];
  decides: Decides;
  source: Source;
  connected: boolean;               // it connects to our systems or our data flows into it automatically
  policy_kind: "change" | "exception";
}

export type Kind = "use_case" | "tool" | "vendor" | "policy_change" | "exception" | "incident" | "question";
export type Tier = "low" | "medium" | "high";

export interface Triage {
  kind: Kind;
  risk_tier: Tier | null;           // null for a question: the committee advises, it does not rate
  why: string[];
  details: Record<string, string | boolean | string[]>;
}

const SENSITIVE: readonly DataClass[] = ["personal", "employee", "health", "financial", "confidential"];
const ABOUT_PEOPLE: readonly DataClass[] = ["personal", "employee", "health", "financial"];

function kindOf(a: TriageAnswers): [Kind, string] {
  switch (a.need) {
    case "problem": return ["incident", "Something went wrong, so it is filed as an incident and goes to the seats that handle them."];
    case "question": return ["question", "You want the committee's view, so it is filed as a question; the committee advises and does not vote."];
    case "policy": return a.policy_kind === "exception"
      ? ["exception", "You want the rule not to apply to you for a while, so it is filed as an exception."]
      : ["policy_change", "You want the rule itself changed, so it is filed as a policy change."];
    default:
      if (a.source === "built") return ["use_case", "You are building or running it yourselves, so it is filed as a use case."];
      if (a.who !== "staff" || a.connected) return ["vendor", "It comes from a company and touches customers or your systems, so it is filed as a vendor: the seats that look at contracts, data, and security sit."];
      return ["tool", "It is a product staff would use in their own work, so it is filed as a tool."];
  }
}

function tierOf(a: TriageAnswers, kind: Kind): [Tier | null, string[]] {
  if (kind === "question") return [null, []];
  const sensitive = a.data.filter((d) => SENSITIVE.includes(d));
  const aboutPeople = a.data.some((d) => ABOUT_PEOPLE.includes(d));
  const why: string[] = [];
  if (kind === "incident") {
    if (a.decides === "decides" || aboutPeople) { why.push("An incident involving decisions about people or their personal information is high risk."); return ["high", why]; }
    why.push("An incident is at least medium risk until the committee has seen it.");
    return ["medium", why];
  }
  if (a.decides === "decides") { why.push("It decides about people on its own, which is the highest tier whatever the data."); return ["high", why]; }
  if (a.decides === "advises" && aboutPeople) { why.push("It helps decide about people and sees their personal information."); return ["high", why]; }
  if (a.who !== "staff" && aboutPeople) { why.push("Customers or the public interact with it and it sees personal information."); return ["high", why]; }
  if (sensitive.length) { why.push(`It sees ${sensitive.map((d) => DATA_CLASSES[d].toLowerCase()).join("; ")}.`); }
  if (a.decides === "advises") why.push("It helps a person decide.");
  if (a.who !== "staff") why.push("Customers or the public interact with it.");
  if (why.length) return ["medium", why];
  why.push("Staff use it, it sees nothing sensitive, and it makes no decisions about people.");
  return ["low", why];
}

function detailsOf(a: TriageAnswers, kind: Kind): Record<string, string | boolean | string[]> {
  const data = a.data.filter((d) => d !== "none").map((d) => DATA_CLASSES[d]);
  const out: Record<string, string | boolean | string[]> = {};
  if (kind === "use_case") {
    out.who_is_affected = a.who === "both" ? "customers and employees" : a.who === "customers" ? "customers" : "employees";
    out.decides_or_advises = a.decides === "decides" ? "decides automatically" : a.decides === "advises" ? "advises a person who decides" : "neither";
    if (data.length) out.data_involved = data;
    if (a.who !== "staff") out.customer_facing = true;
  } else if (kind === "tool") {
    if (data.length) out.data_entered = data;
    out.decides_or_advises = DECIDES[a.decides];
  } else if (kind === "vendor") {
    if (data.length) out.data_shared = data;
    out.source = SOURCES[a.source];
    if (a.connected) out.connected_to_our_systems = true;
    out.decides_or_advises = DECIDES[a.decides];
  } else if (kind === "incident") {
    if (data.length) out.data_involved = data;
    out.who_was_affected = WHO[a.who];
  }
  return out;
}

export function triage(a: TriageAnswers): Triage {
  const [kind, kindWhy] = kindOf(a);
  const [risk_tier, tierWhy] = tierOf(a, kind);
  return { kind, risk_tier, why: [kindWhy, ...tierWhy], details: detailsOf(a, kind) };
}
