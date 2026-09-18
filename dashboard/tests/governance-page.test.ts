import { describe, expect, it } from "vitest";
import { commandSchema } from "@/lib/control/schema";

/**
 * The page builds command payloads out of form fields. These check the shapes it produces are
 * ones the schema accepts, so a UI change that breaks the contract fails here rather than at
 * the worker.
 */
const run_id = "run1";
const reason = "Governance review requested by the CRO.";

function conveneFrom(items: string[], advisoryText: string) {
  const advisory = advisoryText.split("\n").map((s) => s.trim()).filter(Boolean);
  const agenda = items.map((v) => JSON.parse(v));
  return {
    kind: "convene",
    run_id,
    reason,
    payload: { ...(agenda.length ? { agenda } : {}), ...(advisory.length ? { advisory } : {}) },
  };
}

describe("convene payloads the page builds", () => {
  const checkboxValue = JSON.stringify({
    item_id: "ITEM-001",
    kind: "use_case",
    title: "Collections assistant",
    ref_id: "run1/uc/UC-090",
  });

  it("accepts checked candidates alone", () => {
    expect(commandSchema.safeParse(conveneFrom([checkboxValue], "")).success).toBe(true);
  });

  it("accepts advisory lines alone", () => {
    expect(commandSchema.safeParse(conveneFrom([], "Where should model risk sit?\n\n")).success).toBe(true);
  });

  it("accepts both together", () => {
    expect(commandSchema.safeParse(conveneFrom([checkboxValue], "One question")).success).toBe(true);
  });

  it("refuses an empty form rather than calling an empty meeting", () => {
    expect(commandSchema.safeParse(conveneFrom([], "   \n  ")).success).toBe(false);
  });
});

describe("attest payloads the page builds", () => {
  const base = { decision_id: "run1/decision/UC-090", actor: "k@bank.example", rationale: "Fair lending is unquantified." };

  it("accepts an override that answers a dissent and applies", () => {
    const parsed = commandSchema.safeParse({
      kind: "attest",
      run_id,
      reason,
      payload: { ...base, outcome: "rejected", responded_to: ["run1/agent/cro"], apply: true },
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a deferral, which is the only way an item is tabled", () => {
    const parsed = commandSchema.safeParse({ kind: "attest", run_id, reason, payload: { ...base, outcome: "deferred" } });
    expect(parsed.success).toBe(true);
  });

  it("refuses an unchosen outcome", () => {
    const parsed = commandSchema.safeParse({ kind: "attest", run_id, reason, payload: { ...base, outcome: "" } });
    expect(parsed.success).toBe(false);
  });

  it("refuses an empty rationale, because nothing drafts it for you", () => {
    const parsed = commandSchema.safeParse({
      kind: "attest",
      run_id,
      reason,
      payload: { ...base, rationale: "   ", outcome: "approved" },
    });
    expect(parsed.success).toBe(false);
  });
});
