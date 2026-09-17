import "server-only";
import { readDb } from "@/lib/db";

export interface CommandRow { command_id: string; run_id: string | null; kind: string; payload: string; reason: string; status: string; result: string | null; created_at: string; processed_at: string | null }
export interface InterventionRow { intervention_id: string; run_id: string | null; sim_month: string | null; real_ts: string; kind: string; description: string; source: string }
export interface CheckpointRow { checkpoint_id: string; run_id: string; sim_month: string; uri: string; git_sha: string | null; created_at: string }

const CMD_COLS = "command_id, run_id, kind, payload, reason, status, result, created_at, processed_at";

export async function pendingCommands(): Promise<CommandRow[]> {
  const db = await readDb();
  return db.all<CommandRow>(`SELECT ${CMD_COLS} FROM commands WHERE status = 'pending' ORDER BY created_at DESC LIMIT 200`);
}

export async function processedCommands(): Promise<CommandRow[]> {
  const db = await readDb();
  return db.all<CommandRow>(`SELECT ${CMD_COLS} FROM commands WHERE status <> 'pending' ORDER BY COALESCE(processed_at, created_at) DESC LIMIT 200`);
}

export async function recentInterventions(): Promise<InterventionRow[]> {
  const db = await readDb();
  return db.all<InterventionRow>("SELECT intervention_id, run_id, sim_month, real_ts, kind, description, source FROM interventions ORDER BY real_ts DESC LIMIT 300");
}

export async function checkpoints(): Promise<CheckpointRow[]> {
  const db = await readDb();
  return db.all<CheckpointRow>("SELECT checkpoint_id, run_id, sim_month, uri, git_sha, created_at FROM checkpoints ORDER BY created_at DESC LIMIT 200");
}
