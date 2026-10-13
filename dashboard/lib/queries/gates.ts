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

export interface CalibrationRow {
  meeting_id: string;
  meeting_date: string;
  items: number;
  unanimous: boolean;            // every ballot on every item went the same way
  moved: boolean;                // a seat's ballot went against its own sealed position
  skipped: boolean;              // the acting gate skipped the debate
  p: Record<string, number | null>;   // provider -> p_unanimous it reported (shadow or acting)
}

/** Every closed review set against what each debate gate said about it: the evaluation set for a threshold. */
export async function debateCalibration(runId: string): Promise<{ rows: CalibrationRow[]; providers: string[] }> {
  const db = await readDb();
  const meetings = await db.all<{ meeting_id: string; meeting_date: string; debate_skipped: number | null }>(
    "SELECT meeting_id, meeting_date, debate_skipped FROM meetings WHERE run_id = ? AND status = 'closed' ORDER BY meeting_date, meeting_id", [runId]);
  if (!meetings.length) return { rows: [], providers: [] };
  const ids = meetings.map((m) => m.meeting_id);
  const marks = ids.map(() => "?").join(", ");
  const [votes, positions, gates] = await Promise.all([
    db.all<{ meeting_id: string; agent_id: string; item_id: string; vote: string }>(`SELECT meeting_id, agent_id, item_id, vote FROM votes WHERE meeting_id IN (${marks})`, ids),
    db.all<{ meeting_id: string; agent_id: string; item_id: string; support: number }>(`SELECT meeting_id, agent_id, item_id, support FROM positions WHERE meeting_id IN (${marks})`, ids),
    db.all<{ meeting_id: string; provider: string; label: string; probability: number }>(
      `SELECT meeting_id, provider, label, probability FROM classifier_calls WHERE meeting_id IN (${marks}) AND purpose = 'debate_outcome' AND label <> 'unavailable' ORDER BY created_at`, ids),
  ]);
  const providers = [...new Set(gates.map((g) => g.provider.replace(" (shadow)", "")))];
  const rows: CalibrationRow[] = [];
  for (const m of meetings) {
    const v = votes.filter((x) => x.meeting_id === m.meeting_id);
    const p = positions.filter((x) => x.meeting_id === m.meeting_id);
    if (!v.length || !p.length) continue;
    const byItem = new Map<string, Set<string>>();
    for (const x of v) byItem.set(x.item_id, (byItem.get(x.item_id) ?? new Set()).add(x.vote));
    const unanimous = [...byItem.values()].every((s) => [...s].filter((x) => x !== "abstain").length <= 1);
    const stance = new Map(p.map((x) => [`${x.agent_id}|${x.item_id}`, Number(x.support)]));
    const moved = v.some((x) => { const s = stance.get(`${x.agent_id}|${x.item_id}`) ?? 3; return (s >= 4 && x.vote === "no") || (s <= 2 && x.vote === "yes"); });
    const ps: Record<string, number | null> = {};
    for (const name of providers) {
      const g = gates.filter((x) => x.meeting_id === m.meeting_id && x.provider.replace(" (shadow)", "") === name).pop();
      ps[name] = g ? (g.label === "unanimous" ? Number(g.probability) : 1 - Number(g.probability)) : null;
    }
    rows.push({ meeting_id: m.meeting_id, meeting_date: m.meeting_date, items: byItem.size, unanimous, moved, skipped: Boolean(m.debate_skipped), p: ps });
  }
  return { rows, providers };
}

/** For one gate: the lowest threshold at which no review where the debate moved a vote would have been skipped,
 *  and how many debates that threshold would skip. Null when the gate never reported on the record. */
export function safeThreshold(rows: CalibrationRow[], provider: string): { threshold: number; skips: number; of: number } | null {
  const seen = rows.filter((r) => r.p[provider] != null);
  if (!seen.length) return null;
  const dangerous = seen.filter((r) => r.moved).map((r) => r.p[provider] as number);
  const floor = dangerous.length ? Math.max(...dangerous) : 0;      // must be strictly above the highest dangerous p
  const threshold = Math.min(1, Math.ceil((floor + 0.001) * 100) / 100);
  const skips = seen.filter((r) => !r.moved && (r.p[provider] as number) >= threshold).length;
  return { threshold, skips, of: seen.length };
}
