import "server-only";
import { readDb } from "@/lib/db";
import { numOrNull, placeholders } from "@/lib/db/values";
import { monthIndex } from "@/lib/stats/km";

export interface EngineDecisionSummary { decision_id: string; run_id: string; bank_id: string; use_case_id: string; title: string; sim_month: string; risk_tier: string | null }
export interface DrawRow { draw_id: string; decision_id: string | null; sim_month: string; variable: string; dist: string; params: string; seed: string; value: number | null }

export async function engineDecisionsFor(runIds: string[]): Promise<EngineDecisionSummary[]> {
  if (runIds.length === 0) return [];
  const db = await readDb();
  return db.all<EngineDecisionSummary>(
    `SELECT e.decision_id, e.run_id, u.bank_id, e.use_case_id, u.title, e.sim_month, u.risk_tier
     FROM engine_decisions e JOIN use_cases u ON u.use_case_id = e.use_case_id
     WHERE e.run_id IN (${placeholders(runIds.length)}) ORDER BY e.sim_month, u.title`,
    runIds,
  );
}

function prevMonth(month: string): string {
  const idx = monthIndex(month) - 1;
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

export async function engineDecisionDetail(decisionId: string) {
  const db = await readDb();
  const decision = await db.get<{ decision_id: string; run_id: string; use_case_id: string; sim_month: string; classification: string; estimates: string; priors: string; blended: string; plan: string }>(
    "SELECT decision_id, run_id, use_case_id, sim_month, classification, estimates, priors, blended, plan FROM engine_decisions WHERE decision_id = ?",
    [decisionId],
  );
  if (!decision) return null;
  const [draws, useCase, history, states] = await Promise.all([
    db.all<DrawRow>("SELECT draw_id, decision_id, sim_month, variable, dist, params, seed, value FROM engine_draws WHERE decision_id = ? ORDER BY draw_id", [decisionId]),
    db.get<{ title: string; bank_id: string; status: string; risk_tier: string | null }>("SELECT title, bank_id, status, risk_tier FROM use_cases WHERE use_case_id = ?", [decision.use_case_id]),
    db.all<{ history_id: string; sim_month: string; from_status: string | null; to_status: string; source: string }>(
      "SELECT history_id, sim_month, from_status, to_status, source FROM use_case_history WHERE use_case_id = ? ORDER BY sim_month, history_id",
      [decision.use_case_id],
    ),
    db.all<{ sim_month: string; company_state: string }>(
      "SELECT sim_month, company_state FROM sim_months WHERE run_id = ? AND sim_month IN (?, ?)",
      [decision.run_id, prevMonth(decision.sim_month), decision.sim_month],
    ),
  ]);
  return {
    decision,
    draws: draws.map((d) => ({ ...d, seed: String(d.seed), value: numOrNull(d.value) })),
    useCase,
    history,
    before: states.find((s) => s.sim_month !== decision.sim_month)?.company_state ?? null,
    after: states.find((s) => s.sim_month === decision.sim_month)?.company_state ?? null,
  };
}

export async function unlinkedDraws(runIds: string[]): Promise<DrawRow[]> {
  if (runIds.length === 0) return [];
  const db = await readDb();
  const rows = await db.all<DrawRow>(
    `SELECT draw_id, decision_id, sim_month, variable, dist, params, seed, value FROM engine_draws
     WHERE decision_id IS NULL AND run_id IN (${placeholders(runIds.length)}) ORDER BY sim_month, draw_id LIMIT 200`,
    runIds,
  );
  return rows.map((d) => ({ ...d, seed: String(d.seed), value: numOrNull(d.value) }));
}
