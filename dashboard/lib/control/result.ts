import "server-only";
import { readDb } from "@/lib/db";

export type CommandResult =
  | { success: true; data: CommandRow; error: null }
  | { success: false; data: null; error: string };

export interface CommandRow {
  command_id: string;
  run_id: string | null;
  kind: string;
  status: string;
  created_at: string;
  processed_at: string | null;
  result: unknown;
}

interface Raw {
  command_id: string;
  run_id: string | null;
  kind: string;
  status: string;
  created_at: string;
  processed_at: string | null;
  result: string | null;
}

/**
 * Read one queued command and its result.
 *
 * Governance commands (candidates, convene, attest) are answered by the worker, not here, so
 * a caller submits through POST and reads the outcome back through this. `status` is pending
 * until the worker picks it up, then done or failed with the reason in `result.error`.
 */
export async function commandResult(commandId: string): Promise<CommandResult> {
  if (!commandId.trim()) return { success: false, data: null, error: "Pass a command id." };
  try {
    const db = await readDb();
    const row = await db.get<Raw>(
      `SELECT command_id, run_id, kind, status, created_at, processed_at, result
       FROM commands WHERE command_id = ?`,
      [commandId],
    );
    if (!row) return { success: false, data: null, error: `Unknown command: ${commandId}` };
    return { success: true, data: { ...row, result: parse(row.result) }, error: null };
  } catch (err) {
    console.error("[control] commandResult failed", err);
    return { success: false, data: null, error: "Could not read the command. Check server logs." };
  }
}

function parse(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
