import { describe, expect, it } from "vitest";
import { buildTrail, debateRounds, seatsThatSat, type TrailInput } from "@/lib/reviews/trail";

const msg = (seat: string, round: number, seq: number, phase = "debate") => ({ seat, name: seat, phase, round, seq, text: `${seat} spoke` });
const base: TrailInput = {
  status: "closed",
  agenda: [{ item_id: "IT-001", kind: "item", title: "AI vendor: Lumen" }],
  messages: [msg("chair", 1, 1), msg("risk", 1, 2), msg("chair", 2, 3), msg("risk", 1, 9, "memory")],
  positions: [{ seat: "chair", item_id: "IT-001", support: 4, position: "{}" }, { seat: "risk", item_id: "IT-001", support: 2, position: "{}" }],
  perspectives: [],
  votes: [{ seat: "chair", item_id: "IT-001", vote: "yes", rationale: null }, { seat: "risk", item_id: "IT-001", vote: "no", rationale: "Unquantified." }],
  decisions: [{ decision_id: "d1", item_id: "IT-001", outcome: "approved", yes_votes: 1, no_votes: 1, abstentions: 0 }],
  signatures: [],
  minutes: "The committee met.",
  convener: { who: "Kevin Conklin, CRO", at: "2026-09-18T20:00:00Z", finishedAt: "2026-09-18T20:01:00Z" },
};

describe("the trail of a review", () => {
  it("runs in the order things happened, from the person who called it to the person who decides", () => {
    expect(buildTrail(base).map((s) => s.id)).toEqual(["convened", "seated", "views", "debate", "ballot", "minutes", "decided"]);
    expect(buildTrail(base).filter((s) => s.by === "you").map((s) => s.id)).toEqual(["convened", "decided"]);
  });

  it("says who called it and what is still waiting on them", () => {
    const trail = buildTrail(base);
    expect(trail[0]?.summary).toBe("Kevin Conklin, CRO called a review of 1 matter");
    expect(trail.at(-1)).toMatchObject({ done: false, summary: "Waiting on you: 1 decision to sign" });
  });

  it("closes once every decision is signed", () => {
    const signed = { ...base, signatures: [{ decision_id: "d1", actor: "k", outcome: "rejected", rationale: "r", source: "dashboard_session", created_at: "t" }] };
    expect(buildTrail(signed).at(-1)).toMatchObject({ done: true, summary: "1 of 1 signed" });
  });

  it("has nothing to sign when the review was advice only", () => {
    const advice = { ...base, positions: [], votes: [], decisions: [], perspectives: [{ seat: "risk", item_id: "IT-001", stance: 2, position: "p", key_concern: "c", would_change_my_mind: "w" }] };
    const trail = buildTrail(advice);
    expect(trail.find((s) => s.id === "ballot")?.summary).toBe("Nothing was put to a vote");
    expect(trail.at(-1)?.summary).toBe("Advice only, so nothing to sign");
  });

  it("does not show a review that died as having reached its minutes", () => {
    expect(buildTrail({ ...base, status: "failed" }).find((s) => s.id === "minutes")?.done).toBe(false);
  });

  it("counts who sat from what they did, and leaves private notes out of the debate", () => {
    expect(seatsThatSat(base)).toEqual(["chair", "risk"]);
    expect(debateRounds(base.messages).map((r) => [r.round, r.turns.length])).toEqual([[1, 2], [2, 1]]);
  });
});
