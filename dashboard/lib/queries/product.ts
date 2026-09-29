import "server-only";
import { readDb } from "@/lib/db";
import { num } from "@/lib/db/values";

/** Which committee the product pages are looking at: the one in ?run=, else the newest customer, else any run. */
export type Visible = "all" | string[];

/** The organization a product page shows: ?run= if the person may open it, else their first. Never one they may not. */
export async function currentScope(runParam: string | undefined, allowed: Visible): Promise<{ run_id: string; name: string; workspace: boolean } | null> {
  const db = await readDb();
  if (allowed !== "all" && !allowed.length) return null;
  const fence = allowed === "all" ? "" : ` WHERE r.run_id IN (${allowed.map(() => "?").join(", ")})`;
  const rows = await db.all<{ run_id: string; name: string | null; experiment_name: string; condition: string }>(
    `SELECT r.run_id, o.name, e.name AS experiment_name, r.condition
     FROM runs r JOIN experiments e ON e.experiment_id = r.experiment_id LEFT JOIN org_profiles o ON o.run_id = r.run_id${fence}
     ORDER BY CASE WHEN r.condition = 'workspace' AND r.status <> 'archived' THEN 0 WHEN r.condition = 'workspace' THEN 2 ELSE 1 END, r.started_at DESC`,
    allowed === "all" ? [] : allowed,
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

export interface AskRow {
  ask_id: string;
  asked_by: string;
  asked_at: string;
  question: string;
  answer: string;
  covered: boolean | number;
  controls: string;      // json list of AI-GOV ids
  item_id: string | null;
  created_at: string;
}

/** Questions asked of the policy, newest first. */
export async function recentAsks(runId: string, limit = 50): Promise<AskRow[]> {
  const db = await readDb();
  return db.all<AskRow>(
    "SELECT ask_id, asked_by, asked_at, question, answer, covered, controls, item_id, created_at FROM asks WHERE run_id = ? ORDER BY created_at DESC LIMIT ?",
    [runId, limit]);
}

/** Questions the policy could not answer that nobody has sent to the committee: what it should hear next. */
export async function unansweredCount(runId: string): Promise<number> {
  const db = await readDb();
  const row = await db.get<{ n: unknown }>("SELECT COUNT(*) AS n FROM asks WHERE run_id = ? AND NOT covered AND item_id IS NULL", [runId]);
  return num(row?.n);
}

export interface AskWorkRow { command_id: string; kind: string; payload: string | null; status: string; result: string | null; created_at: string }

/** Asks the worker has not answered yet, and ones that failed in the last hour. */
export async function openAsks(runId: string): Promise<AskWorkRow[]> {
  const db = await readDb();
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  return db.all<AskWorkRow>(
    `SELECT command_id, kind, payload, status, result, created_at FROM commands
     WHERE run_id = ? AND kind IN ('ask', 'escalate_ask') AND (status IN ('pending', 'processing') OR (status = 'failed' AND created_at > ?))
     ORDER BY created_at DESC`, [runId, since]);
}

export interface OrganizationRow {
  run_id: string;
  name: string;
  status: string;                 // workspace | archived
  framework: string | null;
  started_at: string;
  seats: number;
  waiting: number;                // matters submitted, not yet reviewed
  needs_you: number;              // recommendations with no signature
  signed: number;
  reviews: number;
  last_review: string | null;     // meeting_date of the latest convened review
  gaps: number;                   // asks the policy could not answer, not sent on
  controls: number;               // numbered controls in the current policy
  spend_month: number;            // USD this calendar month
  cap: number | null;
  starter: string | null;         // the kit it began from, if any
}

/** Every organization with a committee, active first, newest first, with what needs attention at a glance. */
export async function organizations(month: string, allowed: Visible): Promise<OrganizationRow[]> {
  const db = await readDb();
  if (allowed !== "all" && !allowed.length) return [];
  const fence = allowed === "all" ? "" : ` AND r.run_id IN (${allowed.map(() => "?").join(", ")})`;
  const rows = await db.all<Record<string, unknown>>(
    `SELECT r.run_id, o.name, r.status, o.framework, r.started_at, r.spend_cap_usd_per_month AS cap,
            (SELECT COUNT(*) FROM agents ag WHERE ag.run_id = r.run_id AND ag.active_to IS NULL) AS seats,
            (SELECT COUNT(*) FROM items i WHERE i.run_id = r.run_id AND i.status = 'submitted') AS waiting,
            (SELECT COUNT(*) FROM decisions d JOIN meetings m ON m.meeting_id = d.meeting_id
              LEFT JOIN attestations a ON a.decision_id = d.decision_id
              WHERE d.run_id = r.run_id AND m.convened AND a.attestation_id IS NULL) AS needs_you,
            (SELECT COUNT(*) FROM attestations a WHERE a.run_id = r.run_id AND a.outcome <> 'deferred') AS signed,
            (SELECT COUNT(*) FROM meetings m WHERE m.run_id = r.run_id AND m.convened) AS reviews,
            (SELECT MAX(m.meeting_date) FROM meetings m WHERE m.run_id = r.run_id AND m.convened) AS last_review,
            (SELECT COUNT(*) FROM asks k WHERE k.run_id = r.run_id AND NOT k.covered AND k.item_id IS NULL) AS gaps,
            (SELECT pv.control_count FROM policy_versions pv WHERE pv.run_id = r.run_id ORDER BY pv.sim_month DESC LIMIT 1) AS controls,
            (SELECT COALESCE(SUM(l.cost_usd), 0) FROM llm_calls l WHERE l.run_id = r.run_id AND l.created_at LIKE ?) AS spend_month,
            (SELECT c.target FROM config_changes c WHERE c.run_id = r.run_id AND c.area = 'starter' ORDER BY c.changed_at LIMIT 1) AS starter
     FROM runs r JOIN org_profiles o ON o.run_id = r.run_id
     WHERE r.condition = 'workspace'${fence}
     ORDER BY CASE WHEN r.status = 'archived' THEN 1 ELSE 0 END, r.started_at DESC`,
    [`${month}%`, ...(allowed === "all" ? [] : allowed)],
  );
  return rows.map((r) => ({
    run_id: String(r.run_id), name: String(r.name), status: String(r.status), framework: (r.framework as string | null) ?? null,
    started_at: String(r.started_at), seats: num(r.seats), waiting: num(r.waiting), needs_you: num(r.needs_you), signed: num(r.signed),
    reviews: num(r.reviews), last_review: (r.last_review as string | null) ?? null, gaps: num(r.gaps), controls: num(r.controls),
    spend_month: Number(r.spend_month ?? 0), cap: r.cap === null || r.cap === undefined ? null : Number(r.cap),
    starter: (r.starter as string | null) ?? null,
  }));
}

export interface RegisterRow {
  item_id: string;
  kind: string;                  // tool | vendor | use_case
  title: string;
  description: string;
  details: string | null;
  status: string;                // approved | rejected | submitted | in_review | recommended
  risk_tier: string | null;
  submitted_by: string;
  decided_on: string | null;
  actor: string | null;          // who signed
  rationale: string | null;      // the signer's words: the conditions, in effect
  recommended: string | null;
  attestation_id: string | null;
}

/** Every AI tool, vendor, and use case the committee has seen: what is allowed, what is not, and what is still waiting. */
export async function toolRegister(runId: string): Promise<RegisterRow[]> {
  const db = await readDb();
  const rows = await db.all<RegisterRow>(
    `SELECT i.item_id, i.kind, i.title, i.description, i.details, i.status, i.risk_tier, i.submitted_by, i.decided_on,
            a.actor, a.rationale, d.outcome AS recommended, a.attestation_id
     FROM items i
     LEFT JOIN decisions d ON d.ref_id = i.item_id AND d.run_id = i.run_id
     LEFT JOIN attestations a ON a.decision_id = d.decision_id AND a.outcome <> 'deferred'
     WHERE i.run_id = ? AND i.kind IN ('tool', 'vendor', 'use_case') AND i.status <> 'withdrawn'
     ORDER BY CASE i.status WHEN 'approved' THEN 0 WHEN 'rejected' THEN 1 ELSE 2 END, i.title, a.created_at DESC`,
    [runId]);
  // a matter reviewed more than once (deferred, then brought back) has a decision row per review; one line per matter
  const seen = new Map<string, RegisterRow>();
  for (const r of rows) {
    const have = seen.get(r.item_id);
    if (!have || (!have.attestation_id && r.attestation_id)) seen.set(r.item_id, r);
  }
  return [...seen.values()];
}
