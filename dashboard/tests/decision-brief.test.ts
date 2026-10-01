import { describe, expect, it } from "vitest";
import { decisionBrief } from "@/lib/reviews/brief";
import type { BenchSeat } from "@/lib/reviews/model";

const seat = (s: string, title: string, vote: BenchSeat["vote"], dissent: boolean, rationale: string | null): BenchSeat => ({ seat: s, title, vote, dissent, rationale });

describe("decisionBrief", () => {
  it("says what was recommended, how firmly, and lets the chair speak for the majority", () => {
    const bench = [
      seat("chair", "Committee Chair", "yes", false, "The value is clear and the data terms hold. We should approve with monitoring."),
      seat("security", "CISO", "yes", false, "The vendor's SOC 2 covers what we send. Fine by me. And a third sentence."),
      seat("legal", "General Counsel", "no", true, "The contract lets the vendor retain transcripts for a year, which our records policy does not allow. That alone should stop this."),
      seat("finance", "CFO", "absent", false, null),
    ];
    const b = decisionBrief({ recommended: "approved", bench, chairSeat: "chair", riskTier: "medium", reviewTotal: 1, reviewSigned: 0 });
    expect(b.headline).toBe("The committee recommends approving it, 2 to 1.");
    expect(b.firmness).toBe("split");
    expect(decisionBrief({ recommended: "approved", bench: [...bench, seat("risk", "CRO", "yes", false, "Yes.")], chairSeat: "chair", riskTier: null, reviewTotal: 1, reviewSigned: 0 }).firmness).toBe("clear");
    expect(b.why).toEqual({ seat: "Committee Chair", text: "The value is clear and the data terms hold. We should approve with monitoring." });
    expect(b.objection?.seat).toBe("General Counsel");
    expect(b.objection?.text).toContain("retain transcripts for a year");
    expect(b.signing).toContain("Takes effect as soon as you sign");
    expect(b.signing).not.toContain("High risk");
  });

  it("a unanimous vote says so and has no objection", () => {
    const bench = [seat("chair", "Chair", "no", false, "No."), seat("risk", "CRO", "no", false, "Agreed, no.")];
    const b = decisionBrief({ recommended: "rejected", bench, chairSeat: "chair", riskTier: "low", reviewTotal: 3, reviewSigned: 1 });
    expect(b.headline).toBe("The committee recommends rejecting it, unanimously.");
    expect(b.firmness).toBe("unanimous");
    expect(b.objection).toBeNull();
    expect(b.signing).toContain("once the other matter from this review is signed");
  });

  it("a split vote is called split, the longest reason speaks when the chair dissented, and high risk warns", () => {
    const bench = [
      seat("chair", "Chair", "no", true, "Too soon."),
      seat("tech", "CIO", "yes", false, "We can run it."),
      seat("legal", "GC", "yes", false, "The terms are acceptable after the amendment we negotiated last quarter, and the vendor accepted audit rights."),
      seat("risk", "CRO", "abstain", false, null),
    ];
    const b = decisionBrief({ recommended: "approved", bench, chairSeat: "chair", riskTier: "high", reviewTotal: 1, reviewSigned: 0 });
    expect(b.headline).toBe("The committee recommends approving it, 2 to 1, 1 abstaining.");
    expect(b.firmness).toBe("split");
    expect(b.why?.seat).toBe("GC");
    expect(b.objection).toEqual({ seat: "Chair", text: "Too soon." });
    expect(b.signing).toContain("High risk");
  });

  it("long reasons are cut to two sentences", () => {
    const bench = [seat("chair", "Chair", "yes", false, "One. Two. Three. Four.")];
    expect(decisionBrief({ recommended: "approved", bench, chairSeat: "chair", riskTier: null, reviewTotal: 1, reviewSigned: 0 }).why?.text).toBe("One. Two.");
  });
});

describe("decisionBrief with structured ballots", () => {
  it("reads the summary out of a JSON-shaped reason", () => {
    const bench = [seat("chair", "Chair", "yes", false, JSON.stringify({ concerns: ["delivery capacity"], summary: "The revenue case is plausible but thin. I would like Finance to validate it." }))];
    expect(decisionBrief({ recommended: "approved", bench, chairSeat: "chair", riskTier: null, reviewTotal: 1, reviewSigned: 0 }).why?.text)
      .toBe("The revenue case is plausible but thin. I would like Finance to validate it.");
  });
});
