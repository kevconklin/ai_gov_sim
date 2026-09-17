import "server-only";
import { readDb } from "@/lib/db";
import { placeholders } from "@/lib/db/values";

export interface EventRow {
  event_id: string;
  run_id: string;
  bank_id: string;
  sim_month: string;
  type: string;
  severity: string | null;
  source: string;
  payload: string;
}

export async function eventsFor(runIds: string[], filters: { type?: string; month?: string; limit?: number; offset?: number } = {}): Promise<EventRow[]> {
  if (runIds.length === 0) return [];
  const db = await readDb();
  const where = [`run_id IN (${placeholders(runIds.length)})`];
  const params: (string | number)[] = [...runIds];
  if (filters.type) {
    where.push("type = ?");
    params.push(filters.type);
  }
  if (filters.month) {
    where.push("sim_month = ?");
    params.push(filters.month);
  }
  params.push(filters.limit ?? 500, filters.offset ?? 0);
  return db.all<EventRow>(
    `SELECT event_id, run_id, bank_id, sim_month, type, severity, source, payload FROM events
     WHERE ${where.join(" AND ")} ORDER BY sim_month, bank_id, event_id LIMIT ? OFFSET ?`,
    params,
  );
}
