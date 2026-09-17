import "server-only";
import { readDb, type SqlValue } from "@/lib/db";
import { bool, num } from "@/lib/db/values";

export interface CallFilters {
  run?: string;
  purpose?: string;
  model?: string;
  status?: string;
  month?: string;
}

export interface CallListRow {
  call_id: string;
  run_id: string | null;
  agent_id: string | null;
  sim_month: string | null;
  model: string;
  purpose: string;
  status: string;
  attempt: number;
  input_tokens: number;
  cached_tokens: number;
  output_tokens: number;
  cost_usd: number;
  batch: boolean;
  created_at: string;
}

export interface CallDetailRow extends CallListRow {
  cache_write_tokens: number;
  batch_id: string | null;
  custom_id: string | null;
  stop_reason: string | null;
  error: string | null;
  request: string;
  response: string | null;
}

export const PAGE_SIZE = 50;

function whereFor(f: CallFilters): { sql: string; params: SqlValue[] } {
  const clauses: string[] = [];
  const params: SqlValue[] = [];
  if (f.run === "__none__") clauses.push("run_id IS NULL");
  else if (f.run) {
    clauses.push("run_id = ?");
    params.push(f.run);
  }
  for (const key of ["purpose", "model", "status"] as const) {
    const v = f[key];
    if (v) {
      clauses.push(`${key} = ?`);
      params.push(v);
    }
  }
  if (f.month) {
    clauses.push("sim_month = ?");
    params.push(f.month);
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

function normalize<T extends CallListRow>(r: T): T {
  return {
    ...r,
    attempt: num(r.attempt),
    input_tokens: num(r.input_tokens),
    cached_tokens: num(r.cached_tokens),
    output_tokens: num(r.output_tokens),
    cost_usd: num(r.cost_usd),
    batch: bool(r.batch),
  };
}

export async function listCalls(f: CallFilters, page: number): Promise<{ rows: CallListRow[]; total: number }> {
  const db = await readDb();
  const w = whereFor(f);
  const [rows, count] = await Promise.all([
    db.all<CallListRow>(
      `SELECT call_id, run_id, agent_id, sim_month, model, purpose, status, attempt, input_tokens, cached_tokens, output_tokens, cost_usd, batch, created_at
       FROM llm_calls ${w.sql} ORDER BY created_at DESC, call_id LIMIT ? OFFSET ?`,
      [...w.params, PAGE_SIZE, page * PAGE_SIZE],
    ),
    db.get<{ n: unknown }>(`SELECT COUNT(*) AS n FROM llm_calls ${w.sql}`, w.params),
  ]);
  return { rows: rows.map(normalize), total: num(count?.n) };
}

export async function callDetail(callId: string): Promise<CallDetailRow | null> {
  const db = await readDb();
  const row = await db.get<CallDetailRow>(
    `SELECT call_id, run_id, agent_id, sim_month, model, purpose, status, attempt, input_tokens, cached_tokens, cache_write_tokens,
            output_tokens, cost_usd, batch, batch_id, custom_id, stop_reason, error, request, response, created_at
     FROM llm_calls WHERE call_id = ?`,
    [callId],
  );
  return row ? { ...normalize(row), cache_write_tokens: num(row.cache_write_tokens) } : null;
}

export async function distinctValues(table: "llm_calls" | "events", column: string): Promise<string[]> {
  const allowed: Record<string, string[]> = { llm_calls: ["purpose", "model", "status", "sim_month"], events: ["type", "sim_month"] };
  if (!allowed[table]?.includes(column)) throw new Error(`distinctValues: column not allowed: ${table}.${column}`);
  const db = await readDb();
  const rows = await db.all<{ v: string | null }>(`SELECT DISTINCT ${column} AS v FROM ${table} ORDER BY ${column} LIMIT 500`);
  return rows.map((r) => r.v).filter((v): v is string => v !== null && v !== "");
}
