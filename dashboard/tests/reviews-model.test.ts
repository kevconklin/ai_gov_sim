import { describe, expect, it } from "vitest";
import { ageOf, benchFor, seatCode, describeWork, firstSentence, initials, mergeQueue, seatColor, tally, type WaitingRow } from "@/lib/reviews/model";

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

describe("compact labels", () => {
  it("stands two letters in for a seat or a person", () => {
    expect(initials("Chief Risk Officer")).toBe("RI");
    expect(initials("Chief Information Security Officer")).toBe("IS");
    expect(initials("General Counsel")).toBe("GC");
    expect(initials("kevin@northwind.example")).toBe("KE");
    expect(initials("Kevin Conklin, CRO")).toBe("KC");
  });

  it("gives every seat on a committee a different code, which titles alone do not", () => {
    const product = ["chair", "technology", "security", "legal", "risk", "finance", "business", "customer"].map(seatCode);
    const simulated = ["coo_chair", "cio", "ciso", "general_counsel", "cro", "cfo", "head_consumer_lending", "head_marketing"].map(seatCode);
    expect(new Set(product).size).toBe(8);
    expect(new Set(simulated).size).toBe(8);
    expect(product.slice(0, 2)).toEqual(["CH", "TE"]);
  });

  it("gives a seat the same colour wherever it appears", () => {
    expect(seatColor(2)).toBe(seatColor(2));
    expect(seatColor(8)).toBe(seatColor(0));
  });

  it("keeps a row to one sentence and leaves the rest for the drill-down", () => {
    expect(firstSentence("You answer for delivery. You favour building.")).toBe("You answer for delivery.");
    expect(firstSentence("x".repeat(200)).length).toBeLessThanOrEqual(110);
  });

  it("says how long a matter has waited in the fewest words", () => {
    const now = new Date("2026-09-18T18:00:00").getTime();
    expect(ageOf("2026-09-18", now)).toBe("today");
    expect(ageOf("2026-09-06", now)).toBe("12 days");
  });
});
