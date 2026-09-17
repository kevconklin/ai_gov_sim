import { describe, expect, it } from "vitest";
import { commandStatements } from "@/lib/control/rows";
import { commandFromForm, commandSchema, interventionSchema } from "@/lib/control/schema";

const reason = "Testing the control path end to end";

describe("commandSchema", () => {
  it("accepts every valid command kind", () => {
    const valid = [
      { kind: "start", run_id: "r1", reason, payload: {} },
      { kind: "pause", run_id: "r1", reason, payload: {} },
      { kind: "resume", run_id: "r1", reason, payload: {} },
      { kind: "stop", run_id: "r1", reason, payload: {} },
      { kind: "advance", run_id: "r1", reason, payload: { months: 12 } },
      { kind: "inject_event", run_id: "r1", reason, payload: { event_type: "data_leak", severity: "high", notes: "n" } },
      { kind: "fork", run_id: "r1", reason, payload: { from_month: "2027-03" } },
      {
        kind: "fork",
        run_id: "r1",
        reason,
        payload: { from_month: "2027-03", inject_event: { event_type: "press_inquiry", severity: "low", notes: "n" } },
      },
      { kind: "set_spend_cap", run_id: "r1", reason, payload: { usd_per_sim_month: 12.5 } },
    ];
    for (const v of valid) expect(commandSchema.safeParse(v).success, JSON.stringify(v)).toBe(true);
  });

  it("rejects bad payloads and reasons", () => {
    const invalid = [
      { kind: "start", run_id: "r1", reason: "too short", payload: {} },
      { kind: "start", run_id: "r1", reason: "          x", payload: {} },
      { kind: "start", run_id: "", reason, payload: {} },
      { kind: "start", run_id: "r1", reason, payload: { extra: 1 } },
      { kind: "advance", run_id: "r1", reason, payload: { months: 0 } },
      { kind: "advance", run_id: "r1", reason, payload: { months: 13 } },
      { kind: "advance", run_id: "r1", reason, payload: { months: 1.5 } },
      { kind: "inject_event", run_id: "r1", reason, payload: { event_type: "alien_invasion", severity: "high", notes: "n" } },
      { kind: "inject_event", run_id: "r1", reason, payload: { event_type: "data_leak", severity: "extreme", notes: "n" } },
      { kind: "fork", run_id: "r1", reason, payload: { from_month: "2027-13" } },
      { kind: "fork", run_id: "r1", reason, payload: { from_month: "2027-3" } },
      { kind: "set_spend_cap", run_id: "r1", reason, payload: { usd_per_sim_month: 0 } },
      { kind: "set_spend_cap", run_id: "r1", reason, payload: { usd_per_sim_month: -4 } },
      { kind: "delete_everything", run_id: "r1", reason, payload: {} },
    ];
    for (const v of invalid) expect(commandSchema.safeParse(v).success, JSON.stringify(v)).toBe(false);
  });

  it("builds commands from flat form fields", () => {
    const fork = commandFromForm({
      kind: "fork",
      run_id: "r1",
      reason,
      from_month: "2027-02",
      fork_inject: "on",
      fork_event_type: "data_leak",
      fork_severity: "medium",
      fork_notes: "breach in branch only",
    });
    expect(commandSchema.safeParse(fork).success).toBe(true);
    expect(commandSchema.safeParse(commandFromForm({ kind: "advance", run_id: "r1", reason, months: "" })).success).toBe(false);
    expect(commandSchema.safeParse(commandFromForm({ kind: "set_spend_cap", run_id: "r1", reason, usd_per_sim_month: "40" })).success).toBe(true);
  });

  it("validates standalone interventions", () => {
    expect(interventionSchema.safeParse({ run_id: null, kind: "note", reason }).success).toBe(true);
    expect(interventionSchema.safeParse({ run_id: "r1", kind: "hack", reason }).success).toBe(false);
  });
});

describe("commandStatements", () => {
  it("inserts a pending command and a dashboard intervention only", () => {
    const input = commandSchema.parse({ kind: "advance", run_id: "r1", reason, payload: { months: 2 } });
    const stmts = commandStatements(input, { run_id: "r1", current_month: "2027-03", start_month: "2027-01" }, { commandId: "c", interventionId: "i" }, "2026-09-17T00:00:00.000Z");
    expect(stmts).toHaveLength(2);
    expect(stmts[0]!.sql).toMatch(/^INSERT INTO commands/);
    expect(stmts[0]!.sql).toContain("'pending'");
    expect(stmts[0]!.params).toEqual(["c", "r1", "advance", '{"months":2}', reason, "2026-09-17T00:00:00.000Z"]);
    expect(stmts[1]!.sql).toMatch(/INSERT INTO interventions/);
    expect(stmts[1]!.sql).toContain("'dashboard'");
    expect(stmts[1]!.params[2]).toBe("2027-03");
  });
});
