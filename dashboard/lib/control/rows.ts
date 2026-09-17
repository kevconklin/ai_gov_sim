import type { Statement } from "@/lib/db/types";
import type { CommandInput, InterventionInput } from "./schema";

export interface RunContext {
  run_id: string;
  current_month: string | null;
  start_month: string;
}

/** Build the two INSERTs for a command. Pure, so it can be unit tested. */
export function commandStatements(
  input: CommandInput,
  run: RunContext,
  ids: { commandId: string; interventionId: string },
  nowIso: string,
): Statement[] {
  const payload = JSON.stringify(input.payload);
  return [
    {
      sql: `INSERT INTO commands (command_id, run_id, kind, payload, reason, status, result, created_at, processed_at)
            VALUES (?, ?, ?, ?, ?, 'pending', NULL, ?, NULL)`,
      params: [ids.commandId, run.run_id, input.kind, payload, input.reason, nowIso],
    },
    {
      sql: `INSERT INTO interventions (intervention_id, run_id, sim_month, real_ts, kind, description, source)
            VALUES (?, ?, ?, ?, ?, ?, 'dashboard')`,
      params: [
        ids.interventionId,
        run.run_id,
        run.current_month ?? run.start_month,
        nowIso,
        input.kind,
        `${input.reason} [command ${ids.commandId}; payload ${payload}]`,
      ],
    },
  ];
}

export function interventionStatement(
  input: InterventionInput,
  simMonth: string | null,
  id: string,
  nowIso: string,
): Statement {
  return {
    sql: `INSERT INTO interventions (intervention_id, run_id, sim_month, real_ts, kind, description, source)
          VALUES (?, ?, ?, ?, ?, ?, 'dashboard')`,
    params: [id, input.run_id, simMonth, nowIso, input.kind, input.reason],
  };
}
