import { describe, expect, it } from "vitest";
import { dueSoon, isOverdue, STAGES, TRANSITIONS } from "@/lib/lifecycle/stages";

describe("stages", () => {
  it("every stage has moves that name only known stages, and retired has none", () => {
    for (const s of STAGES) expect(TRANSITIONS[s].every((t) => (STAGES as readonly string[]).includes(t))).toBe(true);
    expect(TRANSITIONS.retired).toEqual([]);
    expect(TRANSITIONS.live).not.toContain("approved");
  });
  it("overdue and due soon", () => {
    expect(isOverdue("2027-03-29", "2027-04-01")).toBe(true);
    expect(isOverdue("2027-03-29", "2027-03-01")).toBe(false);
    expect(isOverdue(null, "2027-03-01")).toBe(false);
    expect(dueSoon("2027-03-29", "2027-03-10")).toBe(true);
    expect(dueSoon("2027-03-29", "2027-01-10")).toBe(false);
    expect(dueSoon("2027-03-29", "2027-04-10")).toBe(false);
  });
});
