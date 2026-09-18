import { describe, expect, it } from "vitest";
import { benchFor, describeWork, mergeQueue, tally, type WaitingRow } from "@/lib/reviews/model";

const row = (over: Partial<WaitingRow>): WaitingRow => ({
  ref_id: "ws/item/IT-001", source: "item", item_kind: "vendor", title: "Lumen", risk_tier: "medium",
  since: "2026-09-18", submitted_by: "cx@example.invalid", ...over,
});

describe("the queue", () => {
  it("still shows a matter the ranking has not caught up with", () => {
    const queue = mergeQueue([row({}), row({ ref_id: "ws/item/IT-002", title: "New today" })],
      [{ ref_id: "ws/item/IT-001", priority: 20, reasons: ["deferred 1x"], deferrals: 1, escalated: false }]);
    expect(queue.map((q) => q.display)).toEqual(["IT-001", "IT-002"]);
    expect(queue[1]?.priority).toBeNull();
  });

  it("orders by priority, then puts the unranked last, oldest first", () => {
    const queue = mergeQueue(
      [row({ ref_id: "a/item/IT-001", since: "2026-09-10" }), row({ ref_id: "a/item/IT-002", since: "2026-09-01" }),
       row({ ref_id: "a/item/IT-003" })],
      [{ ref_id: "a/item/IT-003", priority: 30, reasons: [], deferrals: 0, escalated: false }]);
    expect(queue.map((q) => q.display)).toEqual(["IT-003", "IT-002", "IT-001"]);
  });

  it("sends a question as advice, and anything else from intake as a matter for decision", () => {
    const [question, vendor] = mergeQueue(
      [row({ ref_id: "a/item/IT-001", item_kind: "question", title: "May staff use chat assistants?" }),
       row({ ref_id: "a/item/IT-002" })], []);
    expect(question?.agenda).toEqual({ item_id: "IT-001", kind: "advisory", title: "May staff use chat assistants?", ref_id: "a/item/IT-001" });
    expect(vendor?.agenda.kind).toBe("item");
    expect(vendor?.agenda.title).toBe("AI vendor: Lumen");
  });

  it("keeps the kind a member-raised matter already has", () => {
    const [useCase] = mergeQueue([row({ ref_id: "r/uc/UC-004", source: "use_case", item_kind: "use_case" })], []);
    expect(useCase?.agenda.kind).toBe("use_case");
  });
});

describe("the bench", () => {
  const committee = ["chair", "security", "legal", "risk"].map((seat) => ({ seat, title: seat }));

  it("shows who sat, how they voted, and who dissented from the way it carried", () => {
    const bench = benchFor(committee, [
      { seat: "chair", vote: "yes", rationale: null },
      { seat: "security", vote: "yes", rationale: null },
      { seat: "risk", vote: "no", rationale: "Exposure is not quantified." },
    ], "approved");
    expect(bench.map((s) => s.vote)).toEqual(["yes", "yes", "absent", "no"]);
    expect(bench.filter((s) => s.dissent).map((s) => s.seat)).toEqual(["risk"]);
    expect(tally(bench)).toEqual({ yes: 2, no: 1, abstain: 0, sat: 3, of: 4 });
  });

  it("treats a yes as the dissent when the matter did not carry", () => {
    const bench = benchFor(committee, [{ seat: "chair", vote: "yes", rationale: null }, { seat: "risk", vote: "no", rationale: null }], "rejected");
    expect(bench.filter((s) => s.dissent).map((s) => s.seat)).toEqual(["chair"]);
  });
});

describe("work in progress", () => {
  it("is said the way the person who asked for it would say it", () => {
    expect(describeWork("convene", JSON.stringify({ agenda: [{}, {}], advisory: ["q"] }))).toBe("The committee is reviewing 3 matters");
    expect(describeWork("convene", JSON.stringify({ advisory: ["q"] }))).toBe("The committee is reviewing 1 matter");
    expect(describeWork("attest", "{}")).toBe("Recording your decision");
    expect(describeWork("submit", "not json")).toContain("a matter");
  });
});
