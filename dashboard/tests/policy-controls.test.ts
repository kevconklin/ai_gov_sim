import { describe, expect, it } from "vitest";
import { listControls } from "@/lib/policy-text";

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
