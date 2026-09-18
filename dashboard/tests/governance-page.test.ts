import { describe, expect, it } from "vitest";
import { bindActor } from "@/lib/control/bind";
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

describe("malformed agenda items", () => {
  it("are rejected by the schema rather than reaching the worker", () => {
    const parsed = commandSchema.safeParse({
      kind: "convene",
      run_id: "run1",
      reason: "Governance review requested by the CRO.",
      payload: { agenda: ["not an object"] },
    });
    expect(parsed.success).toBe(false);
  });
});

describe("binding an attestation to the session", () => {
  const attest = (payload: Record<string, unknown>) => ({
    kind: "attest", run_id: "run1", reason: "Governance review requested by the CRO.", payload,
  });

  it("discards an actor the caller supplied", () => {
    const bound = bindActor(attest({ actor: "someone.else@evil.example", outcome: "approved" }), "real@bank.example");
    expect((bound.payload as Record<string, unknown>).actor).toBe("real@bank.example");
  });

  it("records how the identity was established", () => {
    const bound = bindActor(attest({ outcome: "approved" }), "real@bank.example");
    expect((bound.payload as Record<string, unknown>).source).toBe("dashboard_session");
  });

  it("leaves other command kinds alone", () => {
    const convene = { kind: "convene", run_id: "run1", reason: "x", payload: { advisory: ["q"] } };
    expect(bindActor(convene, "real@bank.example")).toEqual(convene);
  });

  it("changes nothing without a session, so the request fails auth rather than acting unbound", () => {
    const input = attest({ actor: "someone.else@evil.example", outcome: "approved" });
    expect(bindActor(input, null)).toEqual(input);
  });
});

describe("intake and briefs", () => {
  const base = { run_id: "run1", reason: "kevin@bank.example: submitting a vendor for review" };

  it("accepts a submission of every kind the committee can take", () => {
    for (const kind of ["use_case", "tool", "vendor", "policy_change", "exception", "incident", "question"]) {
      const parsed = commandSchema.safeParse({
        ...base,
        kind: "submit",
        payload: { kind, title: "Lumen transcript analytics", description: "Scores call transcripts for complaint risk.", submitted_by: "k" },
      });
      expect(parsed.success, kind).toBe(true);
    }
  });

  it("refuses a submission a committee could not act on", () => {
    const parsed = commandSchema.safeParse({
      ...base, kind: "submit", payload: { kind: "vendor", title: "Lumen", description: "short", submitted_by: "k" },
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts an intake item on a convened agenda", () => {
    const parsed = commandSchema.safeParse({
      ...base, kind: "convene",
      payload: { agenda: [{ item_id: "IT-001", kind: "item", title: "AI vendor: Lumen", ref_id: "run1/item/IT-001" }] },
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses a brief too thin to argue from", () => {
    const parsed = commandSchema.safeParse({ ...base, kind: "set_brief", payload: { seat: "risk", brief: "Be careful." } });
    expect(parsed.success).toBe(false);
  });
});
