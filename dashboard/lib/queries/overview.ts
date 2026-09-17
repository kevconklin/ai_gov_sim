import "server-only";
import { readDb } from "@/lib/db";
import { bool, num, placeholders } from "@/lib/db/values";

export interface SpendSummary {
  run_id: string;
  realMonthUsd: number;
  simMonthUsd: number;
}

function realMonthStartIso(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export async function spendFor(runId: string, simMonth: string | null): Promise<SpendSummary> {
  const db = await readDb();
  const real = await db.get<{ total: unknown }>(
    "SELECT SUM(cost_usd) AS total FROM llm_calls WHERE run_id = ? AND created_at >= ?",
    [runId, realMonthStartIso()],
  );
  const sim = simMonth
    ? await db.get<{ total: unknown }>("SELECT SUM(cost_usd) AS total FROM llm_calls WHERE run_id = ? AND sim_month = ?", [runId, simMonth])
    : undefined;
  return { run_id: runId, realMonthUsd: num(real?.total), simMonthUsd: num(sim?.total) };
}

export interface AlertRow {
  alert_id: string;
  run_id: string | null;
  sim_month: string | null;
  kind: string;
  severity: string;
  message: string;
  created_at: string;
  acknowledged: boolean;
}

export async function alertsFor(runIds: string[], onlyOpen: boolean): Promise<AlertRow[]> {
  if (runIds.length === 0) return [];
  const db = await readDb();
  const rows = await db.all<AlertRow>(
    `SELECT alert_id, run_id, sim_month, kind, severity, message, created_at, acknowledged FROM alerts
     WHERE (run_id IN (${placeholders(runIds.length)}) OR run_id IS NULL) ${onlyOpen ? "AND acknowledged = FALSE" : ""}
     ORDER BY created_at DESC LIMIT 200`,
    runIds,
  );
  return rows.map((r) => ({ ...r, acknowledged: bool(r.acknowledged) }));
}

export async function openCountsFor(runId: string): Promise<{ openFindings: number; pendingCommands: number }> {
  const db = await readDb();
  const f = await db.get<{ n: unknown }>("SELECT COUNT(*) AS n FROM findings WHERE run_id = ? AND status <> 'closed'", [runId]);
  const c = await db.get<{ n: unknown }>("SELECT COUNT(*) AS n FROM commands WHERE run_id = ? AND status = 'pending'", [runId]);
  return { openFindings: num(f?.n), pendingCommands: num(c?.n) };
}
