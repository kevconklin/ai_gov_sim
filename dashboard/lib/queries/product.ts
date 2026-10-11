import "server-only";
import { readDb } from "@/lib/db";
import { num, parseJson } from "@/lib/db/values";

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
              WHERE d.run_id = r.run_id AND m.convened AND m.status = 'closed' AND a.attestation_id IS NULL) AS needs_you,
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

export interface UseCaseRow {
  item_id: string;
  title: string;
  description: string;
  details: string | null;
  status: string;                // intake: submitted | in_review | recommended | approved | rejected | withdrawn
  stage: string | null;          // life: approved | building | piloting | live | paused | retired
  owner: string | null;
  risk_tier: string | null;
  submitted_by: string;
  submitted_on: string;
  decided_on: string | null;
  review_due: string | null;
  stage_changed_on: string | null;
  last_actor: string | null;     // who signed the latest decision on it
  last_outcome: string | null;
  last_attestation: string | null;
}

/** Every AI use case an organization has brought, across its whole life. Re-review matters are folded into their original. */
export async function useCases(runId: string): Promise<UseCaseRow[]> {
  const db = await readDb();
  return db.all<UseCaseRow>(
    `SELECT i.item_id, i.title, i.description, i.details, i.status, i.stage, i.owner, i.risk_tier, i.submitted_by, i.submitted_on,
            i.decided_on, i.review_due, i.stage_changed_on,
            (SELECT a.actor FROM attestations a JOIN decisions d ON d.decision_id = a.decision_id WHERE d.ref_id = i.item_id ORDER BY a.created_at DESC LIMIT 1) AS last_actor,
            (SELECT a.outcome FROM attestations a JOIN decisions d ON d.decision_id = a.decision_id WHERE d.ref_id = i.item_id ORDER BY a.created_at DESC LIMIT 1) AS last_outcome,
            (SELECT a.attestation_id FROM attestations a JOIN decisions d ON d.decision_id = a.decision_id WHERE d.ref_id = i.item_id ORDER BY a.created_at DESC LIMIT 1) AS last_attestation
     FROM items i
     WHERE i.run_id = ? AND i.kind = 'use_case' AND i.status <> 'withdrawn' AND i.details NOT LIKE '%"rereview_of"%'
     ORDER BY i.submitted_on DESC, i.item_id DESC`, [runId]);
}

export interface StageChangeRow { from_stage: string | null; to_stage: string; changed_by: string; changed_on: string; note: string }

export async function stageHistory(itemId: string): Promise<StageChangeRow[]> {
  const db = await readDb();
  return db.all<StageChangeRow>("SELECT from_stage, to_stage, changed_by, changed_on, note FROM stage_changes WHERE item_id = ? ORDER BY created_at, change_id", [itemId]);
}

/** The re-review matters opened for one use case, so its page can point at them. */
export async function rereviewsOf(runId: string, itemId: string): Promise<{ item_id: string; title: string; status: string; submitted_on: string }[]> {
  const db = await readDb();
  return db.all("SELECT item_id, title, status, submitted_on FROM items WHERE run_id = ? AND details LIKE ? ORDER BY submitted_on DESC",
    [runId, `%"rereview_of": "${itemId}"%`]);
}

// ---- the story of one matter, and the record of everything --------------------------------------

export interface Event {
  at: string;                 // ISO date or timestamp, for ordering
  when: string;               // what to show
  kind: string;               // submitted | flagged | reviewed | signed | sent_back | applied | recommended | stage | owner | rereview | ask | change
  who: string | null;
  title: string;
  body: string | null;
  href: string | null;        // where to read more
  tone: "you" | "ai" | "ok" | "no" | "wait" | "objection" | null;
}

const short = (id: string) => id.split("/").pop() ?? id;
const whoOf = (s: string | null | undefined) => (s ? s.replace(/ <.*>$/, "") : null);

/** Everything that happened to one matter, oldest first: the answer to "how did we get here". */
export async function matterStory(runId: string, itemId: string): Promise<{ item: Record<string, unknown> | null; events: Event[] }> {
  const db = await readDb();
  const run = encodeURIComponent(runId);
  const item = await db.get<Record<string, unknown>>("SELECT * FROM items WHERE item_id = ? AND run_id = ?", [itemId, runId]);
  if (!item) return { item: null, events: [] };
  const sid = short(itemId);
  const events: Event[] = [];
  const details = parseJson<Record<string, unknown>>(String(item.details ?? "{}"), {});

  events.push({ at: `${item.submitted_on}T00:00:00`, when: String(item.submitted_on), kind: "submitted", who: whoOf(String(item.submitted_by)),
    title: `Submitted as ${String(item.kind).replace(/_/g, " ")}${item.risk_tier ? `, ${item.risk_tier} risk` : ""}`,
    body: String(item.description ?? ""), href: null, tone: "you" });
  const cited = Array.isArray(details.related_decisions) ? (details.related_decisions as string[]) : [];
  if (cited.length) events.push({ at: `${item.submitted_on}T00:00:01`, when: String(item.submitted_on), kind: "cited", who: null, title: `Cited earlier decisions: ${cited.join(", ")}`, body: null, href: null, tone: null });
  const flagged = Array.isArray(details.flagged_text) ? (details.flagged_text as string[]) : [];
  if (flagged.length) events.push({ at: `${item.submitted_on}T00:00:02`, when: String(item.submitted_on), kind: "flagged", who: null, title: "Flagged at intake: text addressed to the advisers", body: flagged.join("; "), href: null, tone: "objection" });
  if (typeof details.rereview_of === "string") events.push({ at: `${item.submitted_on}T00:00:00`, when: String(item.submitted_on), kind: "rereview", who: null, title: "Opened as a scheduled re-review", body: null, href: `/matter?run=${run}&id=${encodeURIComponent(details.rereview_of)}`, tone: "ai" });

  const reviews = await db.all<{ meeting_id: string; meeting_date: string; convened: unknown; status: string; outcome: string; yes_votes: unknown; no_votes: unknown; decision_id: string; debate_skipped: unknown; debate_skip_p: unknown }>(
    `SELECT m.meeting_id, m.meeting_date, m.convened, m.status, d.outcome, d.yes_votes, d.no_votes, d.decision_id, m.debate_skipped, m.debate_skip_p
     FROM decisions d JOIN meetings m ON m.meeting_id = d.meeting_id WHERE d.ref_id = ? ORDER BY m.meeting_date, d.decision_id`, [itemId]);
  for (const r of reviews) {
    const conv = await db.get<{ reason: string; created_at: string; processed_at: string | null }>("SELECT reason, created_at, processed_at FROM commands WHERE run_id = ? AND kind = 'convene' AND status = 'done' AND result LIKE ? ORDER BY created_at LIMIT 1", [runId, `%${r.meeting_id}%`]);
    // real times where the record has them: when the person pressed Convene, and when the review finished
    const startedAt = conv?.created_at ?? `${r.meeting_date}T09:00:00`;
    const finishedAt = conv?.processed_at ?? `${r.meeting_date}T10:00:00`;
    events.push({ at: startedAt, when: startedAt.slice(0, 16).replace("T", " "), kind: "convened", who: whoOf(conv?.reason.split(":")[0] ?? null), title: "Review convened", body: null, href: `/reviews?run=${run}&tab=reviews&open=trail:${encodeURIComponent(r.meeting_id)}~${sid}`, tone: "you" });
    const recs = await db.all<{ kind: string; title: string; seat_title: string }>("SELECT r.kind, r.title, a.title AS seat_title FROM recommendations r JOIN agents a ON a.agent_id = r.agent_id WHERE r.meeting_id = ? AND r.item_id = ?", [r.meeting_id, sid]);
    events.push({ at: finishedAt, when: finishedAt.slice(0, 16).replace("T", " "), kind: "reviewed", who: "The committee",
      title: `Recommended ${r.outcome === "approved" ? "approving" : "rejecting"}, ${num(r.yes_votes)} to ${num(r.no_votes)}${r.debate_skipped ? ` (debate skipped at ${Math.round(Number(r.debate_skip_p ?? 0) * 100)}%)` : ""}`,
      body: recs.length ? `Also recommended: ${recs.map((x) => `${x.title} (${x.seat_title})`).join("; ")}` : null,
      href: `/reviews?run=${run}&tab=reviews&open=trail:${encodeURIComponent(r.meeting_id)}~${sid}`, tone: "ai" });
    const att = await db.get<{ actor: string; outcome: string; rationale: string; created_at: string; attestation_id: string }>("SELECT actor, outcome, rationale, created_at, attestation_id FROM attestations WHERE decision_id = ?", [r.decision_id]);
    if (att) {
      const overruled = att.outcome !== "deferred" && att.outcome !== r.outcome;
      events.push({ at: att.created_at, when: att.created_at.slice(0, 16).replace("T", " "), kind: att.outcome === "deferred" ? "sent_back" : "signed", who: whoOf(att.actor),
        title: att.outcome === "deferred" ? "Sent back for another look" : `Signed ${att.outcome}${overruled ? ", overruling the committee" : ""}`,
        body: att.rationale, href: `/reviews?run=${run}&tab=decided&open=record:${encodeURIComponent(att.attestation_id)}`, tone: att.outcome === "approved" ? "ok" : att.outcome === "rejected" ? "no" : "wait" });
      const applied = await db.all<{ target: string; title: string; status: string; applied_as: string | null }>("SELECT target, title, status, applied_as FROM document_revisions WHERE meeting_id = ? AND item_id = ? AND status = 'applied'", [r.meeting_id, sid]);
      for (const a of applied) events.push({ at: att.created_at.replace(/\.\d+/, ".9"), when: att.created_at.slice(0, 10), kind: "applied", who: whoOf(att.actor),
        title: a.target === "policy" ? `Policy section “${a.title}” revised, as the committee drafted` : `${a.title} became a new version, as the committee drafted`, body: null,
        href: a.target === "policy" ? `/policy-record?run=${run}` : `/reviews?run=${run}&tab=settings&open=document:${encodeURIComponent(a.applied_as ?? "")}`, tone: "ok" });
    } else if (r.status === "closed") {
      events.push({ at: finishedAt.replace(/\.\d+/, ".9"), when: finishedAt.slice(0, 16).replace("T", " "), kind: "waiting", who: null, title: "Waiting for your decision", body: null, href: `/decide?run=${run}&d=${encodeURIComponent(r.decision_id)}`, tone: "you" });
    }
  }
  const stages = await db.all<{ from_stage: string | null; to_stage: string; changed_by: string; changed_on: string; note: string; created_at: string }>("SELECT * FROM stage_changes WHERE item_id = ? ORDER BY created_at", [itemId]);
  for (const sc of stages) events.push({ at: sc.created_at, when: sc.changed_on, kind: sc.note.startsWith("Owner set") ? "owner" : "stage", who: whoOf(sc.changed_by),
    title: sc.note.startsWith("Owner set") ? "Owner named" : sc.from_stage && sc.from_stage !== sc.to_stage ? `Moved from ${sc.from_stage} to ${sc.to_stage}` : `Stage: ${sc.to_stage}`, body: sc.note, href: `/portfolio?run=${run}&open=${encodeURIComponent(itemId)}`, tone: sc.to_stage === "retired" || sc.to_stage === "paused" ? "wait" : "ok" });
  const later = await db.all<{ item_id: string; submitted_on: string; status: string }>("SELECT item_id, submitted_on, status FROM items WHERE run_id = ? AND details LIKE ?", [runId, `%"rereview_of": "${itemId}"%`]);
  for (const l of later) events.push({ at: `${l.submitted_on}T00:00:00`, when: l.submitted_on, kind: "rereview", who: null, title: `Re-review opened (${l.status.replace(/_/g, " ")})`, body: null, href: `/matter?run=${run}&id=${encodeURIComponent(l.item_id)}`, tone: "ai" });
  const ask = typeof details.ask_id === "string" ? await db.get<{ asked_by: string; asked_at: string; question: string }>("SELECT asked_by, asked_at, question FROM asks WHERE ask_id = ?", [details.ask_id]) : undefined;
  if (ask) events.unshift({ at: `${ask.asked_at}T00:00:00`, when: ask.asked_at, kind: "ask", who: whoOf(ask.asked_by), title: "Asked of the policy first; it could not answer", body: ask.question, href: `/ask?run=${run}`, tone: "ai" });
  events.sort((a, b) => a.at.localeCompare(b.at));
  return { item, events };
}

export interface RecordEntry { at: string; kind: string; who: string; title: string; body: string | null; href: string | null; tone: Event["tone"] }

/** The organization's whole record, newest first: every change, signature, stage move, and review. */
export async function organizationRecord(runId: string, limit = 300): Promise<RecordEntry[]> {
  const db = await readDb();
  const run = encodeURIComponent(runId);
  const out: RecordEntry[] = [];
  for (const c of await db.all<{ changed_at: string; actor: string; area: string; target: string; before_value: string | null; after_value: string | null; reason: string; change_id: string }>(
    "SELECT changed_at, actor, area, target, before_value, after_value, reason, change_id FROM config_changes WHERE run_id = ? ORDER BY changed_at DESC LIMIT ?", [runId, limit])) {
    out.push({ at: c.changed_at, kind: c.area, who: whoOf(c.actor) ?? c.actor, title: `${c.area.replace(/_/g, " ")}: ${c.target}${c.after_value ? ` → ${c.after_value.slice(0, 80)}` : ""}`, body: c.reason, href: `/reviews?run=${run}&tab=changes&open=change:${encodeURIComponent(c.change_id)}`, tone: "you" });
  }
  for (const a of await db.all<{ created_at: string; actor: string; outcome: string; rationale: string; attestation_id: string; title: string; recommended: string; item_id: string }>(
    `SELECT a.created_at, a.actor, a.outcome, a.rationale, a.attestation_id, COALESCE(i.title, d.item_id) AS title, d.outcome AS recommended, d.ref_id AS item_id
     FROM attestations a JOIN decisions d ON d.decision_id = a.decision_id LEFT JOIN items i ON i.item_id = d.ref_id WHERE a.run_id = ? ORDER BY a.created_at DESC LIMIT ?`, [runId, limit])) {
    const overruled = a.outcome !== "deferred" && a.outcome !== a.recommended;
    out.push({ at: a.created_at, kind: "signature", who: whoOf(a.actor) ?? a.actor, title: `${a.outcome === "deferred" ? "Sent back" : `Signed ${a.outcome}`}${overruled ? ", overruling the committee" : ""}: ${a.title}`, body: a.rationale, href: `/matter?run=${run}&id=${encodeURIComponent(a.item_id)}`, tone: a.outcome === "approved" ? "ok" : a.outcome === "rejected" ? "no" : "wait" });
  }
  for (const s of await db.all<{ created_at: string; changed_by: string; to_stage: string; from_stage: string | null; note: string; item_id: string; title: string }>(
    "SELECT s.created_at, s.changed_by, s.to_stage, s.from_stage, s.note, s.item_id, i.title FROM stage_changes s JOIN items i ON i.item_id = s.item_id WHERE s.run_id = ? ORDER BY s.created_at DESC LIMIT ?", [runId, limit])) {
    out.push({ at: s.created_at, kind: "use case", who: whoOf(s.changed_by) ?? s.changed_by, title: `${s.title}: ${s.note.startsWith("Owner set") ? "owner named" : s.from_stage && s.from_stage !== s.to_stage ? `${s.from_stage} to ${s.to_stage}` : s.to_stage}`, body: s.note, href: `/matter?run=${run}&id=${encodeURIComponent(s.item_id)}`, tone: "ok" });
  }
  for (const m of await db.all<{ meeting_id: string; meeting_date: string; status: string; n: unknown; reason: string | null; created_at: string | null }>(
    `SELECT m.meeting_id, m.meeting_date, m.status, (SELECT COUNT(*) FROM decisions d WHERE d.meeting_id = m.meeting_id) AS n,
            (SELECT reason FROM commands c WHERE c.run_id = m.run_id AND c.kind = 'convene' AND c.result LIKE '%' || m.meeting_id || '%' LIMIT 1) AS reason,
            (SELECT created_at FROM commands c WHERE c.run_id = m.run_id AND c.kind = 'convene' AND c.result LIKE '%' || m.meeting_id || '%' LIMIT 1) AS created_at
     FROM meetings m WHERE m.run_id = ? AND m.convened ORDER BY m.meeting_date DESC LIMIT ?`, [runId, limit])) {
    out.push({ at: m.created_at ?? `${m.meeting_date}T09:00:00`, kind: "review", who: whoOf(m.reason?.split(":")[0] ?? null) ?? "A person", title: `Convened a review of ${num(m.n)} ${num(m.n) === 1 ? "matter" : "matters"}${m.status === "closed" ? "" : " (in progress)"}`, body: null, href: `/reviews?run=${run}&tab=reviews&open=trail:${encodeURIComponent(m.meeting_id)}`, tone: "ai" });
  }
  out.sort((a, b) => b.at.localeCompare(a.at));
  return out.slice(0, limit);
}
