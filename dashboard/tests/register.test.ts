import { describe, expect, it } from "vitest";
import { dataSeen, groupRegister, matches } from "@/lib/register/group";

describe("groupRegister", () => {
  it("splits approved, rejected, and everything still in flight", () => {
    const g = groupRegister([{ status: "approved" }, { status: "rejected" }, { status: "submitted" }, { status: "in_review" }, { status: "recommended" }]);
    expect([g.allowed.length, g.notAllowed.length, g.pending.length]).toEqual([1, 1, 3]);
  });
});

describe("dataSeen", () => {
  it("reads whichever data key the kind used", () => {
    expect(dataSeen(JSON.stringify({ data_entered: ["Health information"] }))).toEqual(["Health information"]);
    expect(dataSeen(JSON.stringify({ data_shared: ["Financial or payment information", "Personal information about employees"] }))).toHaveLength(2);
    expect(dataSeen(JSON.stringify({ other: 1 }))).toEqual([]);
    expect(dataSeen(null)).toEqual([]);
    expect(dataSeen("{not json")).toEqual([]);
  });
});

describe("matches", () => {
  it("matches name or description, ignoring case, and everything on an empty query", () => {
    const row = { title: "Otter.ai", description: "Meeting notes" };
    expect(matches(row, "otter")).toBe(true);
    expect(matches(row, "NOTES")).toBe(true);
    expect(matches(row, "copilot")).toBe(false);
    expect(matches(row, "  ")).toBe(true);
  });
});
