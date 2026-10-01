import { describe, expect, it } from "vitest";
import { triage, type TriageAnswers } from "@/lib/intake/triage";

const base: TriageAnswers = { need: "use_tool", who: "staff", data: ["none"], decides: "no", source: "bought", connected: false, policy_kind: "change" };

describe("triage", () => {
  it("a chat assistant for staff with nothing sensitive is a low-risk tool", () => {
    const t = triage(base);
    expect([t.kind, t.risk_tier]).toEqual(["tool", "low"]);
    expect(t.why[0]).toContain("filed as a tool");
  });
  it("the same tool fed personal information is medium risk", () => {
    const t = triage({ ...base, data: ["personal"] });
    expect(t.risk_tier).toBe("medium");
    expect(t.details.data_entered).toEqual(["Personal information about customers, patients, or members"]);
  });
  it("a bought product customers interact with, or that connects to our systems, is a vendor", () => {
    expect(triage({ ...base, who: "customers" }).kind).toBe("vendor");
    expect(triage({ ...base, connected: true }).kind).toBe("vendor");
    expect(triage({ ...base, connected: true }).details.connected_to_our_systems).toBe(true);
  });
  it("an AI feature that appeared in software we use is filed like a bought product", () => {
    expect(triage({ ...base, source: "embedded" }).kind).toBe("tool");
    expect(triage({ ...base, source: "embedded", connected: true }).kind).toBe("vendor");
  });
  it("something we build is a use case", () => {
    const t = triage({ ...base, need: "project", source: "built", who: "both", decides: "advises" });
    expect(t.kind).toBe("use_case");
    expect(t.details).toMatchObject({ who_is_affected: "customers and employees", decides_or_advises: "advises a person who decides", customer_facing: true });
  });
  it("deciding about people on its own is high risk whatever the data", () => {
    const t = triage({ ...base, decides: "decides" });
    expect(t.risk_tier).toBe("high");
    expect(t.why.some((w) => w.includes("decides about people on its own"))).toBe(true);
  });
  it("advising on people with their personal information is high; advising with nothing sensitive is medium", () => {
    expect(triage({ ...base, decides: "advises", data: ["health"] }).risk_tier).toBe("high");
    expect(triage({ ...base, decides: "advises" }).risk_tier).toBe("medium");
  });
  it("customers interacting with something that sees their information is high", () => {
    expect(triage({ ...base, who: "customers", data: ["financial"] }).risk_tier).toBe("high");
    expect(triage({ ...base, who: "customers" }).risk_tier).toBe("medium");
  });
  it("a problem is an incident, medium at least and high when people are involved", () => {
    expect(triage({ ...base, need: "problem" })).toMatchObject({ kind: "incident", risk_tier: "medium" });
    expect(triage({ ...base, need: "problem", data: ["employee"] }).risk_tier).toBe("high");
  });
  it("a question is not rated", () => {
    expect(triage({ ...base, need: "question" })).toMatchObject({ kind: "question", risk_tier: null });
  });
  it("policy work is a change or an exception", () => {
    expect(triage({ ...base, need: "policy" }).kind).toBe("policy_change");
    expect(triage({ ...base, need: "policy", policy_kind: "exception" }).kind).toBe("exception");
  });
});
