import { describe, expect, it } from "vitest";
import { listControls, splitClause } from "@/lib/policy-text";

describe("listing a policy's controls", () => {
  const policy = `# Northwind AI Policy

## Model risk
AI-GOV-001: All customer-facing models must have a named owner
recorded in the inventory.
AI-GOV-002: Independent validation is required for high-tier models.

## Scope
This section has prose but no controls.

AI-GOV-014 Vendors must confirm in writing that our data is not used for training.
`;

  it("returns one row per control, in order, with the requirement that follows the id", () => {
    const rows = listControls(policy);
    expect(rows.map((r) => r.id)).toEqual(["AI-GOV-001", "AI-GOV-002", "AI-GOV-014"]);
    expect(rows[0]?.text).toBe("All customer-facing models must have a named owner recorded in the inventory.");
    expect(rows[2]?.text).toBe("Vendors must confirm in writing that our data is not used for training.");
  });

  it("leaves headings and prose out", () => {
    expect(listControls("# Title\n\nJust words, no numbered requirements.")).toEqual([]);
  });
});

describe("splitClause", () => {
  it("separates a framework tag from the requirement", () => {
    expect(splitClause("Every system has an owner. (NIST AI RMF GOVERN 2.1)")).toEqual({ text: "Every system has an owner.", clause: "NIST AI RMF GOVERN 2.1" });
    expect(splitClause("Keep an inventory. (ISO/IEC 42001 4.3, A.2.2)").clause).toBe("ISO/IEC 42001 4.3, A.2.2");
  });
  it("leaves an ordinary parenthesis alone", () => {
    expect(splitClause("Tools (including chat assistants) are approved first.")).toEqual({ text: "Tools (including chat assistants) are approved first.", clause: null });
  });
});
