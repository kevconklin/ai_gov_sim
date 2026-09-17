import "server-only";
import { readDb } from "@/lib/db";
import { numOrNull, placeholders } from "@/lib/db/values";

export interface MetricRow {
  run_id: string;
  bank_id: string;
  sim_month: string;
  metric: string;
  dimension: string;
  value: number | null;
}

export async function metricRows(runIds: string[], metrics: string[]): Promise<MetricRow[]> {
  if (runIds.length === 0 || metrics.length === 0) return [];
  const db = await readDb();
  const rows = await db.all<MetricRow>(
    `SELECT run_id, bank_id, sim_month, metric, dimension, value FROM metrics
     WHERE run_id IN (${placeholders(runIds.length)}) AND metric IN (${placeholders(metrics.length)})
     ORDER BY sim_month, run_id, metric, dimension`,
    [...runIds, ...metrics],
  );
  return rows.map((r) => ({ ...r, value: numOrNull(r.value) }));
}

export type WideRow = Record<string, string | number | null> & { sim_month: string };

/**
 * Pivot long metric rows into chart rows keyed by sim_month.
 * `seriesKey` names each column (e.g. bank id, or `${bank}_${dimension}`).
 */
export function pivot(rows: MetricRow[], seriesKey: (r: MetricRow) => string | null): WideRow[] {
  const byMonth = new Map<string, WideRow>();
  for (const r of rows) {
    const key = seriesKey(r);
    if (key === null) continue;
    const row = byMonth.get(r.sim_month) ?? { sim_month: r.sim_month };
    const prev = row[key];
    row[key] = typeof prev === "number" && r.value !== null ? prev + r.value : (r.value ?? (prev as number | null) ?? null);
    byMonth.set(r.sim_month, row);
  }
  return [...byMonth.values()].sort((a, b) => a.sim_month.localeCompare(b.sim_month));
}

/** Latest-month value for (run, metric, dimension). */
export function latest(rows: MetricRow[], runId: string, metric: string, dimension = ""): { month: string; value: number | null } | null {
  const matches = rows.filter((r) => r.run_id === runId && r.metric === metric && r.dimension === dimension);
  const last = matches.sort((a, b) => a.sim_month.localeCompare(b.sim_month)).at(-1);
  return last ? { month: last.sim_month, value: last.value } : null;
}

export function sumOver(rows: MetricRow[], runId: string, metric: string): number {
  return rows.filter((r) => r.run_id === runId && r.metric === metric).reduce((a, r) => a + (r.value ?? 0), 0);
}
