import "server-only";
import { readDb } from "@/lib/db";
import { num } from "@/lib/db/values";

export interface GateCallRow {
  call_id: string;
  purpose: string;
  item_id: string | null;
  item_title: string | null;
  item_status: string | null;
  item_kind: string | null;
  item_tier: string | null;
  meeting_id: string | null;
  model: string;
  state: string;
  questions: string;      // json
  answers: string | null; // json
  acted: string | null;   // json
  input_tokens: number;
  cost_usd: number;
  latency_ms: number;
  status: string;
  error: string | null;
  created_at: string;
}

/** Every typed decision the fast model made for this organization, newest first. */
export async function gateCalls(runId: string, limit = 200): Promise<GateCallRow[]> {
  const db = await readDb();
  const rows = await db.all<GateCallRow>(
    `SELECT g.call_id, g.purpose, g.item_id, i.title AS item_title, i.status AS item_status, i.kind AS item_kind, i.risk_tier AS item_tier,
            g.meeting_id, g.model, g.state, g.questions, g.answers, g.acted, g.input_tokens, g.cost_usd, g.latency_ms, g.status, g.error, g.created_at
     FROM gate_calls g LEFT JOIN items i ON i.item_id = g.item_id
     WHERE g.run_id = ? ORDER BY g.created_at DESC LIMIT ?`, [runId, limit]);
  return rows.map((r) => ({ ...r, input_tokens: num(r.input_tokens), cost_usd: Number(r.cost_usd ?? 0), latency_ms: num(r.latency_ms) }));
}

export interface GateSummary {
  calls: number;
  ok: number;
  cost: number;
  avg_latency: number;
  acted: number;                 // calls whose answers changed what happened or raised a flag
  dup_flagged: number;           // intake: possible duplicates flagged
  dup_withdrawn: number;         // ...of which the person then withdrew
  tier_disagreed: number;        // intake: tier read differently from what was filed
  tier_followed: number;         // ...of which the person then changed the tier to the gate's reading
  debates_skipped: number;       // debate gate: skips
}

/** What the gates have done for this organization, and how often a person agreed with them. */
export async function gateSummary(runId: string): Promise<GateSummary> {
  const rows = await gateCalls(runId, 5000);
  const parse = (s: string | null) => { try { return s ? (JSON.parse(s) as Record<string, unknown>) : null; } catch { return null; } };
  let acted = 0, dup = 0, dupW = 0, tierD = 0, tierF = 0, skipped = 0;
  for (const r of rows) {
    const a = parse(r.acted);
    const flags = Array.isArray(a?.flags) ? (a!.flags as string[]) : [];
    if (flags.length || a?.skipped === true || a?.flagged_text === true) acted += 1;
    if (r.purpose === "intake_triage") {
      const answers = parse(r.answers);
      if (flags.some((f) => f.startsWith("possible duplicate"))) { dup += 1; if (r.item_status === "withdrawn") dupW += 1; }
      const tier = flags.find((f) => f.startsWith("reads as ") && f.includes(" risk"));
      if (tier) {
        tierD += 1;
        const read = (answers?.risk_tier as { choice?: string } | undefined)?.choice;
        if (read && r.item_tier === read) tierF += 1;
      }
    }
    if (r.purpose === "debate_outcome" && a?.skipped === true) skipped += 1;
  }
  const ok = rows.filter((r) => r.status === "ok");
  return {
    calls: rows.length, ok: ok.length, cost: rows.reduce((t, r) => t + r.cost_usd, 0),
    avg_latency: ok.length ? Math.round(ok.reduce((t, r) => t + r.latency_ms, 0) / ok.length) : 0,
    acted, dup_flagged: dup, dup_withdrawn: dupW, tier_disagreed: tierD, tier_followed: tierF, debates_skipped: skipped,
  };
}
