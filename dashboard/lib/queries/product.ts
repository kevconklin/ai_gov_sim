import "server-only";
import { readDb } from "@/lib/db";
import { num } from "@/lib/db/values";

/** Which committee the product pages are looking at: the one in ?run=, else the newest customer, else any run. */
export async function currentScope(runParam: string | undefined): Promise<{ run_id: string; name: string; workspace: boolean } | null> {
  const db = await readDb();
  const rows = await db.all<{ run_id: string; name: string | null; experiment_name: string; condition: string }>(
    `SELECT r.run_id, o.name, e.name AS experiment_name, r.condition
     FROM runs r JOIN experiments e ON e.experiment_id = r.experiment_id LEFT JOIN org_profiles o ON o.run_id = r.run_id
     ORDER BY CASE WHEN r.condition = 'workspace' THEN 0 ELSE 1 END, r.started_at DESC`,
  );
  const row = rows.find((r) => r.run_id === runParam) ?? rows[0];
  return row ? { run_id: row.run_id, name: row.name ?? row.experiment_name, workspace: row.condition === "workspace" } : null;
}

export interface SpendRow { month: string; calls: number; cost: number; failed: number; retried: number }

/** What this committee's reviews have cost, by real calendar month, newest first. */
export async function spendByMonth(runId: string): Promise<SpendRow[]> {
  const db = await readDb();
  const rows = await db.all<{ month: string; calls: unknown; cost: unknown; failed: unknown; retried: unknown }>(
    `SELECT substr(created_at, 1, 7) AS month, COUNT(*) AS calls, COALESCE(SUM(cost_usd), 0) AS cost,
            SUM(CASE WHEN status <> 'ok' THEN 1 ELSE 0 END) AS failed, SUM(CASE WHEN attempt > 1 THEN 1 ELSE 0 END) AS retried
     FROM llm_calls WHERE run_id = ? GROUP BY substr(created_at, 1, 7) ORDER BY month DESC LIMIT 12`,
    [runId],
  );
  return rows.map((r) => ({ month: r.month, calls: num(r.calls), cost: Number(r.cost ?? 0), failed: num(r.failed), retried: num(r.retried) }));
}

export interface ModelSpendRow { model: string; calls: number; cost: number; failed: number }

/** Spend by model this calendar month: which provider is costing what, and which is failing. */
export async function spendByModel(runId: string, month: string): Promise<ModelSpendRow[]> {
  const db = await readDb();
  const rows = await db.all<{ model: string; calls: unknown; cost: unknown; failed: unknown }>(
    `SELECT model, COUNT(*) AS calls, COALESCE(SUM(cost_usd), 0) AS cost, SUM(CASE WHEN status <> 'ok' THEN 1 ELSE 0 END) AS failed
     FROM llm_calls WHERE run_id = ? AND created_at LIKE ? GROUP BY model ORDER BY cost DESC, calls DESC`,
    [runId, `${month}%`],
  );
  return rows.map((r) => ({ model: r.model, calls: num(r.calls), cost: Number(r.cost ?? 0), failed: num(r.failed) }));
}

export interface ProblemRow { call_id: string; created_at: string; model: string; purpose: string; status: string; attempt: number; error: string | null }

/** Calls that failed or needed a retry, newest first. Each links to its full record in the logs. */
export async function recentProblems(runId: string): Promise<ProblemRow[]> {
  const db = await readDb();
  const rows = await db.all<ProblemRow>(
    `SELECT call_id, created_at, model, purpose, status, attempt, error FROM llm_calls
     WHERE run_id = ? AND (status <> 'ok' OR attempt > 1) ORDER BY created_at DESC LIMIT 100`,
    [runId],
  );
  return rows.map((r) => ({ ...r, attempt: num(r.attempt) }));
}

export interface PolicyVersionRow { sim_month: string; git_sha: string; word_count: number; control_count: number; controls: string; policy_text: string }

/** Every version of this committee's AI policy, newest first. Each one was committed after a review applied. */
export async function policyHistory(runId: string): Promise<PolicyVersionRow[]> {
  const db = await readDb();
  const rows = await db.all<PolicyVersionRow>(
    `SELECT sim_month, git_sha, word_count, control_count, controls, policy_text FROM policy_versions
     WHERE run_id = ? ORDER BY sim_month DESC, git_sha DESC LIMIT 60`,
    [runId],
  );
  return rows.map((r) => ({ ...r, word_count: num(r.word_count), control_count: num(r.control_count) }));
}

/** Policy wording the committee has been asked to change and that is still open or waiting on a signature. */
export async function openPolicyMatters(runId: string): Promise<{ item_id: string; title: string; status: string; submitted_on: string }[]> {
  const db = await readDb();
  return db.all("SELECT item_id, title, status, submitted_on FROM items WHERE run_id = ? AND kind IN ('policy_change', 'exception') AND status IN ('submitted', 'in_review', 'recommended') ORDER BY submitted_on DESC", [runId]);
}
