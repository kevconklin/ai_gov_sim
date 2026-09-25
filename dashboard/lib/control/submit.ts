import "server-only";
import { controlDb } from "@/lib/db";
import { commandStatements, interventionStatement, type RunContext } from "./rows";
import { commandSchema, interventionSchema, issuesToMessages, workspaceSchema } from "./schema";

export type ControlResult =
  | { success: true; data: { command_id?: string; intervention_id: string }; error: null }
  | { success: false; data: null; error: string; issues?: string[] };

async function loadRun(runId: string): Promise<RunContext | undefined> {
  const db = await controlDb();
  return db.get<RunContext>("SELECT run_id, current_month, start_month FROM runs WHERE run_id = ?", [runId]);
}

function fail(error: string, issues?: string[]): ControlResult {
  return { success: false, data: null, error, ...(issues ? { issues } : {}) };
}

/** Validate and insert one pending command plus its intervention record. */
export async function submitCommand(raw: unknown): Promise<ControlResult> {
  const parsed = commandSchema.safeParse(raw);
  if (!parsed.success) return fail("Invalid command.", issuesToMessages(parsed.error));
  const input = parsed.data;
  try {
    const run = await loadRun(input.run_id);
    if (!run) return fail(`Unknown run: ${input.run_id}`);
    const ids = { commandId: crypto.randomUUID(), interventionId: crypto.randomUUID() };
    const db = await controlDb();
    await db.transaction(commandStatements(input, run, ids, new Date().toISOString()));
    return { success: true, data: { command_id: ids.commandId, intervention_id: ids.interventionId }, error: null };
  } catch (err) {
    console.error("[control] submitCommand failed", err);
    return fail("Could not record the command. Check server logs.");
  }
}

/** Insert a standalone intervention (e.g. a logged config change). */
export async function submitIntervention(raw: unknown): Promise<ControlResult> {
  const parsed = interventionSchema.safeParse(raw);
  if (!parsed.success) return fail("Invalid intervention.", issuesToMessages(parsed.error));
  const input = parsed.data;
  try {
    let simMonth: string | null = null;
    if (input.run_id) {
      const run = await loadRun(input.run_id);
      if (!run) return fail(`Unknown run: ${input.run_id}`);
      simMonth = run.current_month ?? run.start_month;
    }
    const id = crypto.randomUUID();
    const db = await controlDb();
    await db.transaction([interventionStatement(input, simMonth, id, new Date().toISOString())]);
    return { success: true, data: { intervention_id: id }, error: null };
  } catch (err) {
    console.error("[control] submitIntervention failed", err);
    return fail("Could not record the intervention. Check server logs.");
  }
}

/**
 * Queue the creation of a new customer. It is the one command with no run to attach to, so it is
 * written with a null run; the worker creates the run and everything that hangs off it.
 */
export async function submitWorkspace(raw: unknown): Promise<ControlResult> {
  const parsed = workspaceSchema.safeParse(raw);
  if (!parsed.success) return fail("That customer cannot be created yet.", issuesToMessages(parsed.error));
  const input = parsed.data;
  try {
    const ids = { commandId: crypto.randomUUID(), interventionId: crypto.randomUUID() };
    const now = new Date().toISOString();
    const db = await controlDb();
    await db.transaction([
      {
        sql: `INSERT INTO commands (command_id, run_id, kind, payload, reason, status, result, created_at, processed_at)
              VALUES (?, NULL, 'create_workspace', ?, ?, 'pending', NULL, ?, NULL)`,
        params: [ids.commandId, JSON.stringify(input.payload), input.reason, now],
      },
      {
        sql: `INSERT INTO interventions (intervention_id, run_id, sim_month, real_ts, kind, description, source)
              VALUES (?, NULL, NULL, ?, 'create_workspace', ?, 'dashboard')`,
        params: [ids.interventionId, now, `${input.reason} [command ${ids.commandId}]`],
      },
    ]);
    return { success: true, data: { command_id: ids.commandId, intervention_id: ids.interventionId }, error: null };
  } catch (err) {
    console.error("[control] submitWorkspace failed", err);
    return fail("Could not queue the new customer. Check server logs.");
  }
}
