import "server-only";
import type { CompareRun, LongMetricRow } from "@/lib/compare";
import { INCIDENT_EVENT_TYPES, MRA_OR_WORSE } from "@/lib/constants";
import { readDb } from "@/lib/db";
import { num, numOrNull, placeholders } from "@/lib/db/values";

export async function experimentRuns(experimentId: string): Promise<CompareRun[]> {
  const db = await readDb();
  const rows = await db.all<CompareRun>(
    `SELECT run_id, bank_id, condition, replicate, start_month, current_month FROM runs
     WHERE experiment_id = ? AND parent_run_id IS NULL ORDER BY condition, replicate`,
    [experimentId],
  );
  return rows.map((r) => ({ ...r, replicate: num(r.replicate) }));
}

export async function longMetrics(runIds: string[], metrics: string[]): Promise<LongMetricRow[]> {
  if (runIds.length === 0 || metrics.length === 0) return [];
  const db = await readDb();
  const rows = await db.all<LongMetricRow>(
    `SELECT run_id, sim_month, metric, dimension, value FROM metrics
     WHERE run_id IN (${placeholders(runIds.length)}) AND metric IN (${placeholders(metrics.length)})`,
    [...runIds, ...metrics],
  );
  return rows.map((r) => ({ ...r, value: numOrNull(r.value) }));
}

async function firstMonthMap(sql: string, params: string[]): Promise<Map<string, string>> {
  const db = await readDb();
  const rows = await db.all<{ run_id: string; first_month: string | null }>(sql, params);
  const out = new Map<string, string>();
  for (const r of rows) if (r.first_month) out.set(r.run_id, r.first_month);
  return out;
}

/** First finding at MRA severity or worse, per run. */
export async function firstMraMonths(runIds: string[]): Promise<Map<string, string>> {
  if (runIds.length === 0) return new Map();
  return firstMonthMap(
    `SELECT run_id, MIN(sim_month) AS first_month FROM findings
     WHERE run_id IN (${placeholders(runIds.length)}) AND severity IN (${placeholders(MRA_OR_WORSE.length)}) GROUP BY run_id`,
    [...runIds, ...MRA_OR_WORSE],
  );
}

/** First high-severity incident-type event, per run. */
export async function firstHighIncidentMonths(runIds: string[]): Promise<Map<string, string>> {
  if (runIds.length === 0) return new Map();
  return firstMonthMap(
    `SELECT run_id, MIN(sim_month) AS first_month FROM events
     WHERE run_id IN (${placeholders(runIds.length)}) AND severity = 'high' AND type IN (${placeholders(INCIDENT_EVENT_TYPES.length)}) GROUP BY run_id`,
    [...runIds, ...INCIDENT_EVENT_TYPES],
  );
}
