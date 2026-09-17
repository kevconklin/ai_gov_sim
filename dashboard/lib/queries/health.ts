import "server-only";
import { readDb } from "@/lib/db";
import { num, placeholders } from "@/lib/db/values";

export interface CallIssueRow {
  call_id: string;
  run_id: string | null;
  sim_month: string | null;
  model: string;
  purpose: string;
  status: string;
  attempt: number;
  error: string | null;
  created_at: string;
}

const COLS = "call_id, run_id, sim_month, model, purpose, status, attempt, error, created_at";

export async function failedCalls(runIds: string[]): Promise<CallIssueRow[]> {
  if (runIds.length === 0) return [];
  const db = await readDb();
  const rows = await db.all<CallIssueRow>(
    `SELECT ${COLS} FROM llm_calls WHERE status <> 'ok' AND (run_id IN (${placeholders(runIds.length)}) OR run_id IS NULL)
     ORDER BY created_at DESC LIMIT 200`,
    runIds,
  );
  return rows.map((r) => ({ ...r, attempt: num(r.attempt) }));
}

export async function retriedCalls(runIds: string[]): Promise<CallIssueRow[]> {
  if (runIds.length === 0) return [];
  const db = await readDb();
  const rows = await db.all<CallIssueRow>(
    `SELECT ${COLS} FROM llm_calls WHERE attempt > 1 AND (run_id IN (${placeholders(runIds.length)}) OR run_id IS NULL)
     ORDER BY created_at DESC LIMIT 200`,
    runIds,
  );
  return rows.map((r) => ({ ...r, attempt: num(r.attempt) }));
}

export async function callTotals(runIds: string[]): Promise<{ run_id: string; total: number; failed: number; retries: number }[]> {
  if (runIds.length === 0) return [];
  const db = await readDb();
  const rows = await db.all<{ run_id: string; total: unknown; failed: unknown; retries: unknown }>(
    `SELECT run_id, COUNT(*) AS total,
            SUM(CASE WHEN status <> 'ok' THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN attempt > 1 THEN 1 ELSE 0 END) AS retries
     FROM llm_calls WHERE run_id IN (${placeholders(runIds.length)}) GROUP BY run_id`,
    runIds,
  );
  return rows.map((r) => ({ run_id: r.run_id, total: num(r.total), failed: num(r.failed), retries: num(r.retries) }));
}
