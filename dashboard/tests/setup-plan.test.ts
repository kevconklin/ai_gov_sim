import { describe, expect, it } from "vitest";
import { cleanTools, plan, type SetupAnswers } from "@/lib/setup/plan";

const base: SetupAnswers = {
  name: "Harbor Health", sector: "professional", size: "50_250", regions: ["us"], regulated: "no", ships_ai: false,
  goals: ["save_time"], boldness: "steady", decides_about_people: false, tools: [], customers: "",
};

describe("plan", () => {
  it("a plain business gets the general kit, NIST, and a balanced committee", () => {
    const p = plan(base);
    expect([p.starter, p.framework, p.stance]).toEqual(["general_business", "nist_ai_rmf", "balanced"]);
    expect(p.facts).toBe("Harbor Health is a professional services organization with 50 to 250 people operating in the United States.");
    expect(p.business_goals).toBe("Save staff time on routine work.");
    expect(p.first_matters).toEqual([]);
    expect(p.reasons.map((r) => r.field)).toEqual(["starter", "framework", "stance"]);
  });

  it("a US bank gets the regulated kit and SR 11-7", () => {
    const p = plan({ ...base, sector: "finance" });
    expect([p.starter, p.framework]).toEqual(["regulated", "sr_11_7"]);
    expect(p.reasons[1]!.because).toContain("SR 11-7");
  });

  it("a clinic gets the regulated kit and ISO 42001, and says so", () => {
    const p = plan({ ...base, sector: "health", regulated: "yes" });
    expect([p.starter, p.framework]).toEqual(["regulated", "iso_42001"]);
    expect(p.facts).toContain("A regulator or examiner reviews how it handles data.");
  });

  it("a business a regulator watches is regulated whatever its sector", () => {
    expect(plan({ ...base, sector: "retail", regulated: "yes" }).starter).toBe("regulated");
  });

  it("software sold into the EU gets the software kit and the EU AI Act", () => {
    const p = plan({ ...base, sector: "software", regions: ["us", "eu"], ships_ai: true });
    expect([p.starter, p.framework]).toEqual(["software", "eu_ai_act"]);
    expect(p.facts).toContain("It sells software with AI features in it.");
  });

  it("software sold only in the US gets the software kit and NIST", () => {
    expect(plan({ ...base, sector: "software", ships_ai: true }).framework).toBe("nist_ai_rmf");
  });

  it("a regulated organization that also ships AI is treated as regulated first", () => {
    expect(plan({ ...base, sector: "insurance", ships_ai: true, regions: ["eu"] }).starter).toBe("regulated");
  });

  it("fast leadership gets an ambitious committee, unless AI already decides about people", () => {
    expect(plan({ ...base, boldness: "fast" }).stance).toBe("ambitious");
    const pulled = plan({ ...base, boldness: "fast", decides_about_people: true });
    expect(pulled.stance).toBe("balanced");
    expect(pulled.reasons[2]!.because).toContain("decide things about people");
    expect(pulled.facts).toContain("AI already helps decide things about people");
  });

  it("goals that are only about what must not happen make a steady board cautious", () => {
    expect(plan({ ...base, goals: ["avoid_leak", "control_tools"] }).stance).toBe("cautious");
    expect(plan({ ...base, goals: ["avoid_leak", "save_time"] }).stance).toBe("balanced");
  });

  it("the tools already in use become the first matters, one each", () => {
    const p = plan({ ...base, tools: ["ChatGPT", "Copilot"], decides_about_people: true });
    expect(p.ai_tools).toBe("ChatGPT, Copilot");
    expect(p.facts).toContain("AI already in use: ChatGPT and Copilot.");
    expect(p.first_matters.map((m) => [m.kind, m.title])).toEqual([["tool", "ChatGPT"], ["tool", "Copilot"]]);
    expect(p.first_matters[0]!.description).toContain("decisions about people");
  });

  it("goals read as one sentence", () => {
    expect(plan({ ...base, goals: ["save_time", "serve_customers", "board_asked"] }).business_goals)
      .toBe("Save staff time on routine work, serve customers faster and the board or leadership asked for a policy.");
    expect(plan({ ...base, goals: [] }).business_goals).toContain("Use AI where it helps");
  });
});

describe("cleanTools", () => {
  it("splits on lines and commas, trims, drops blanks and duplicates", () => {
    expect(cleanTools("ChatGPT\nCopilot, ChatGPT\n\n x \nOtter.ai;Gemini")).toEqual(["ChatGPT", "Copilot", "Otter.ai", "Gemini"]);
  });
});
