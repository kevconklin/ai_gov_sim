/**
 * The setup questionnaire. Plain questions anyone at an organization can answer, and from them a
 * governance setup: which starter kit, which framework, how careful the committee should be, what
 * the committee is told about the organization, and what it should look at first.
 *
 * Every choice carries the reason it was made, in the person's words, and every choice can be
 * changed before anything is created. The rules are deliberately plain: a sector, a regulator, a
 * region, a product. Nothing here calls a model.
 */

export const SECTORS = {
  professional: "Professional services",
  retail: "Retail or hospitality",
  manufacturing: "Manufacturing or logistics",
  nonprofit: "Nonprofit or education",
  software: "Software or technology",
  finance: "Banking, lending, or investment",
  health: "Healthcare",
  insurance: "Insurance",
  public: "Government or public body",
  other: "Something else",
} as const;
export type Sector = keyof typeof SECTORS;

export const SIZES = {
  under_50: "Under 50 people",
  "50_250": "50 to 250",
  "250_1000": "250 to 1,000",
  over_1000: "More than 1,000",
} as const;
export type Size = keyof typeof SIZES;

export const REGIONS = { us: "United States", eu: "European Union", uk: "United Kingdom", other: "Elsewhere" } as const;
export type Region = keyof typeof REGIONS;

export const GOALS = {
  save_time: "Save staff time on routine work",
  serve_customers: "Serve customers faster",
  ship_product: "Put AI features in what we sell",
  satisfy_regulator: "Satisfy a regulator, auditor, or customer questionnaire",
  avoid_leak: "Make sure nothing confidential leaks into an AI tool",
  control_tools: "Get a grip on the AI tools people already use",
  board_asked: "The board or leadership asked for a policy",
} as const;
export type Goal = keyof typeof GOALS;

export const BOLDNESS = {
  careful: { label: "Careful", text: "We would rather be late than sorry." },
  steady: { label: "Steady", text: "Use it where it clearly helps, and go slowly where it could hurt someone." },
  fast: { label: "Fast", text: "AI is how we compete. Make yes safe rather than saying no." },
} as const;
export type Boldness = keyof typeof BOLDNESS;

export interface SetupAnswers {
  name: string;
  sector: Sector;
  size: Size;
  regions: Region[];
  regulated: "yes" | "no" | "unsure";      // does a regulator or examiner review how you handle data?
  ships_ai: boolean;                       // do you sell software with AI features in it?
  goals: Goal[];
  boldness: Boldness;
  decides_about_people: boolean;           // does AI help decide things about people here today?
  tools: string[];                         // AI already in use, as the person listed them
  customers: string;                       // who your customers are, in their words (optional)
}

export type Starter = "general_business" | "regulated" | "software";
export type Stance = "cautious" | "balanced" | "ambitious";

export interface FirstMatter {
  kind: "tool";
  title: string;
  description: string;
}

export interface Reason {
  field: "starter" | "framework" | "stance";
  because: string;
}

export interface SetupPlan {
  starter: Starter;
  framework: string;
  stance: Stance;
  facts: string;
  business_goals: string;
  ai_tools: string;
  first_matters: FirstMatter[];
  reasons: Reason[];
}

const REGULATED_SECTORS: readonly Sector[] = ["finance", "health", "insurance", "public"];

function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function chooseStarter(a: SetupAnswers): [Starter, string] {
  const sector = SECTORS[a.sector];
  if (REGULATED_SECTORS.includes(a.sector)) return ["regulated", `${sector} is a regulated sector, so the policy includes independent validation, regulator notice, and audit.`];
  if (a.regulated === "yes") return ["regulated", "You said a regulator or examiner reviews how you handle data, so the policy includes independent validation, regulator notice, and audit."];
  if (a.sector === "software" || a.ships_ai) return ["software", "You ship AI to customers, so the policy covers the AI in your product as well as the AI your staff use."];
  return ["general_business", "No regulator watches your AI in particular and you do not ship it in a product, so the policy covers the AI tools a business buys and uses."];
}

function chooseFramework(a: SetupAnswers, starter: Starter): [string, string] {
  if (a.sector === "finance" && a.regions.includes("us")) return ["sr_11_7", "US banking examiners read AI decisions against SR 11-7 model risk management."];
  if (starter === "regulated") return ["iso_42001", "ISO/IEC 42001 is a management system an auditor can certify against, which is what a regulated organization is usually asked for."];
  if (a.regions.includes("eu") && (a.ships_ai || a.sector === "software")) return ["eu_ai_act", "Selling AI features into the EU can make you a provider or deployer under the EU AI Act."];
  if (a.goals.includes("satisfy_regulator") && a.regions.includes("eu")) return ["eu_ai_act", "You operate in the EU and want to satisfy a regulator, and the EU AI Act is the rule they will ask about."];
  return ["nist_ai_rmf", "NIST AI RMF is the framework a US business with no sector rule is most often asked about, and it maps onto the others later."];
}

function chooseStance(a: SetupAnswers): [Stance, string] {
  const wanted: Stance = a.boldness === "careful" ? "cautious" : a.boldness === "fast" ? "ambitious" : "balanced";
  if (wanted === "ambitious" && a.decides_about_people) {
    return ["balanced", "Leadership wants to move fast, but you said AI already helps decide things about people here, so the committee starts one notch more careful. Change it if the board disagrees."];
  }
  if (wanted === "balanced" && a.goals.includes("avoid_leak") && !a.goals.includes("save_time") && !a.goals.includes("serve_customers")) {
    return ["cautious", "Your goals are about what must not happen rather than what AI should do, so the committee starts cautious."];
  }
  const why = { cautious: "Leadership would rather be late than sorry.", balanced: "Use AI where it clearly helps, slowly where it could hurt someone.", ambitious: "Leadership sees AI as how you compete, and wants the committee to make yes safe." }[wanted];
  return [wanted, why];
}

function factsFrom(a: SetupAnswers): string {
  const regions = a.regions.length ? ` operating in the ${list(a.regions.map((r) => REGIONS[r]))}` : "";
  const size = { under_50: "under 50 people", "50_250": "50 to 250 people", "250_1000": "250 to 1,000 people", over_1000: "more than 1,000 people" }[a.size];
  const parts = [`${a.name.trim()} is a ${SECTORS[a.sector].toLowerCase()} organization with ${size}${regions}.`];
  if (a.customers.trim()) parts.push(`Customers: ${a.customers.trim().replace(/\.?$/, ".")}`);
  if (a.regulated === "yes") parts.push("A regulator or examiner reviews how it handles data.");
  if (a.ships_ai) parts.push("It sells software with AI features in it.");
  if (a.decides_about_people) parts.push("AI already helps decide things about people here, which the committee should treat as the first thing to look at.");
  if (a.tools.length) parts.push(`AI already in use: ${list(a.tools)}.`);
  return parts.join(" ");
}

function goalsFrom(a: SetupAnswers): string {
  const lines = a.goals.map((g) => GOALS[g]);
  if (!lines.length) return "Use AI where it helps, without taking on a risk the organization could not explain.";
  return `${list(lines.map((l) => l.charAt(0).toLowerCase() + l.slice(1)))}.`.replace(/^./, (c) => c.toUpperCase());
}

/** The AI already in use becomes the committee's first real agenda, one matter per tool. */
function mattersFrom(a: SetupAnswers): FirstMatter[] {
  return a.tools.map((tool) => ({
    kind: "tool",
    title: tool,
    description: `Already in use when governance was set up; listed during setup. The committee is asked whether ${tool} may stay in use, for what, and on what conditions${a.decides_about_people ? ", and whether it plays any part in decisions about people" : ""}.`,
  }));
}

export function cleanTools(text: string): string[] {
  return Array.from(new Set(text.split(/[\n,;]+/).map((t) => t.trim()).filter((t) => t.length >= 2 && t.length <= 120))).slice(0, 30);
}

export function plan(a: SetupAnswers): SetupPlan {
  const [starter, starterWhy] = chooseStarter(a);
  const [framework, frameworkWhy] = chooseFramework(a, starter);
  const [stance, stanceWhy] = chooseStance(a);
  return {
    starter,
    framework,
    stance,
    facts: factsFrom(a),
    business_goals: goalsFrom(a),
    ai_tools: a.tools.join(", "),
    first_matters: mattersFrom(a),
    reasons: [
      { field: "starter", because: starterWhy },
      { field: "framework", because: frameworkWhy },
      { field: "stance", because: stanceWhy },
    ],
  };
}
