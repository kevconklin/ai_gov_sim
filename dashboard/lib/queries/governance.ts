import "server-only";
import { readDb } from "@/lib/db";

export interface AwaitingRow {
  decision_id: string;
  run_id: string;
  meeting_id: string;
  sim_month: string;
  item_id: string;
  kind: string;
  ref_id: string;
  recommended: string;
  yes_votes: number;
  no_votes: number;
  abstentions: number;
  risk_tier: string | null;
}

export interface DissentRow {
  decision_id: string;
  agent_id: string;
  seat: string;
  name: string;
  rationale: string | null;
}

export interface SynthesisRow {
  synthesis_id: string;
  meeting_id: string;
  sim_month: string;
  item_id: string;
  spread: number;
  split: boolean | number;
  for_seats: string;
  against_seats: string;
  undecided_seats: string;
  checks: string;
  narrative: string | null;
  agenda: string;
}

export interface AttestedRow {
  attestation_id: string;
  decision_id: string;
  item_id: string;
  title: string;
  item_kind: string | null;
  kind: string;
  risk_tier: string | null;
  yes_votes: number;
  no_votes: number;
  actor: string;
  outcome: string;
  recommended: string;
  rationale: string;
  created_at: string;
  source: string;
}

/**
 * Decisions a committee recorded that no one has attested to yet.
 *
 * Only meetings a human called. A scheduled meeting's decisions are applied by the ungated
 * research path and never wait on anyone; including them would conflate "waiting on a person"
 * with "already handled".
 *
 * This is the queue that replaces the meeting as the forcing function, so its depth is the
 * governance-health signal worth watching: a queue that grows means oversight is falling behind.
 */
export async function awaitingAttestation(runId: string): Promise<AwaitingRow[]> {
  const db = await readDb();
  return db.all<AwaitingRow>(
    `SELECT d.decision_id, d.run_id, d.meeting_id, d.sim_month, d.item_id, d.kind, d.ref_id,
            d.outcome AS recommended, d.yes_votes, d.no_votes, d.abstentions, u.risk_tier AS risk_tier
     FROM decisions d
     JOIN meetings m ON m.meeting_id = d.meeting_id
     LEFT JOIN attestations a ON a.decision_id = d.decision_id
     LEFT JOIN use_cases u ON u.use_case_id = d.ref_id
     WHERE d.run_id = ? AND a.attestation_id IS NULL AND m.convened
     ORDER BY d.sim_month DESC, d.item_id`,
    [runId],
  );
}

/**
 * Members who voted against the way each item carried. Abstentions are not dissent.
 *
 * On the risk tiers named in config/attestation.yaml the worker refuses an attestation that
 * leaves any of these unanswered, so the page has to show them before it asks for a decision.
 */
export async function dissentsAwaiting(runId: string): Promise<DissentRow[]> {
  const db = await readDb();
  return db.all<DissentRow>(
    `SELECT d.decision_id, v.agent_id, ag.seat, ag.name, v.rationale
     FROM decisions d
     JOIN meetings m ON m.meeting_id = d.meeting_id
     LEFT JOIN attestations a ON a.decision_id = d.decision_id
     JOIN votes v ON v.meeting_id = d.meeting_id AND v.item_id = d.item_id
     JOIN agents ag ON ag.agent_id = v.agent_id
     WHERE d.run_id = ? AND a.attestation_id IS NULL AND m.convened
       AND v.vote = CASE WHEN d.outcome = 'approved' THEN 'no' ELSE 'yes' END
     ORDER BY d.decision_id, ag.seat`,
    [runId],
  );
}

/**
 * Advisory items that were heard but never put to a vote.
 *
 * The meeting's agenda comes along because the question itself is only stored there: a panel
 * that shows "ADV-001" without saying what was asked is no use to anyone reading it later.
 */
export async function recentSyntheses(runId: string): Promise<SynthesisRow[]> {
  const db = await readDb();
  return db.all<SynthesisRow>(
    `SELECT s.synthesis_id, s.meeting_id, m.sim_month, s.item_id, s.spread, s.split,
            s.for_seats, s.against_seats, s.undecided_seats, s.checks, s.narrative, m.agenda
     FROM syntheses s JOIN meetings m ON m.meeting_id = s.meeting_id
     WHERE s.run_id = ? ORDER BY m.sim_month DESC, s.item_id LIMIT 50`,
    [runId],
  );
}

/**
 * Attestations already on record, newest first.
 *
 * `recommended` travels beside `outcome` so an override is visible: if humans never override,
 * they are rubber-stamping, and that is worth seeing rather than hiding.
 */
export async function recentAttestations(runId: string): Promise<AttestedRow[]> {
  const db = await readDb();
  return db.all<AttestedRow>(
    `SELECT a.attestation_id, a.decision_id, d.item_id, COALESCE(i.title, u.title, d.item_id) AS title,
            i.kind AS item_kind, d.kind, COALESCE(i.risk_tier, u.risk_tier) AS risk_tier, d.yes_votes, d.no_votes,
            a.actor, a.outcome, d.outcome AS recommended, a.rationale, a.created_at, a.source
     FROM attestations a JOIN decisions d ON d.decision_id = a.decision_id
     LEFT JOIN items i ON i.item_id = d.ref_id
     LEFT JOIN use_cases u ON u.use_case_id = d.ref_id
     WHERE a.run_id = ? ORDER BY a.created_at DESC LIMIT 50`,
    [runId],
  );
}

/**
 * The most recent completed `candidates` command for a run.
 *
 * Priority is computed by the worker from config/agenda_priority.yaml and is deliberately not
 * recomputed here: two implementations would drift, and the whole point of the ranking is that
 * it can be explained. The page shows the last ranking with its timestamp and offers a refresh.
 */
export async function latestCandidates(runId: string): Promise<{ at: string; result: unknown } | null> {
  const db = await readDb();
  const row = await db.get<{ processed_at: string | null; created_at: string; result: string | null }>(
    `SELECT processed_at, created_at, result FROM commands
     WHERE run_id = ? AND kind = 'candidates' AND status = 'done'
     ORDER BY COALESCE(processed_at, created_at) DESC LIMIT 1`,
    [runId],
  );
  if (!row) return null;
  try {
    return { at: row.processed_at ?? row.created_at, result: JSON.parse(row.result ?? "null") };
  } catch {
    return { at: row.processed_at ?? row.created_at, result: null };
  }
}

export interface ItemRow {
  item_id: string;
  kind: string;
  title: string;
  description: string;
  risk_tier: string | null;
  status: string;
  submitted_by: string;
  submitted_on: string;
  decided_on: string | null;
}

/** Everything that has come through intake, newest first. */
export async function intakeItems(runId: string): Promise<ItemRow[]> {
  const db = await readDb();
  return db.all<ItemRow>(
    `SELECT item_id, kind, title, description, risk_tier, status, submitted_by, submitted_on, decided_on
     FROM items WHERE run_id = ? ORDER BY submitted_on DESC, item_id DESC LIMIT 200`,
    [runId],
  );
}

export interface SeatRow {
  seat: string;
  name: string;
  title: string;
  persona_text: string | null;
}

/** The committee as it sits now. A null brief means the member is briefed from a persona file (the simulation). */
export async function committeeSeats(runId: string): Promise<SeatRow[]> {
  const db = await readDb();
  return db.all<SeatRow>(
    `SELECT seat, name, title, persona_text FROM agents WHERE run_id = ? AND active_to IS NULL ORDER BY seat`,
    [runId],
  );
}

export interface OrgRow {
  name: string;
  risk_appetite: string;
  facts: string;
  seats: string; // json list: speaking order
  framework: string | null;
  business_goals: string | null;
  ai_landscape: string | null;
  ai_tools: string | null;
}

/** Present for a workspace; absent for a simulated run, whose organisation is a fictional bank. */
export async function orgProfile(runId: string): Promise<OrgRow | undefined> {
  const db = await readDb();
  return db.get<OrgRow>("SELECT name, risk_appetite, facts, seats, framework, business_goals, ai_landscape, ai_tools FROM org_profiles WHERE run_id = ?", [runId]);
}

export interface DecisionRow {
  decision_id: string;
  meeting_id: string;
  meeting_date: string;
  item_id: string;
  kind: string;
  item_kind: string | null;
  title: string;
  description: string | null;
  recommended: string;
  risk_tier: string | null;
  submitted_by: string | null;
  review_total: number;
  review_signed: number;
  yes_votes: number;
  no_votes: number;
  abstentions: number;
}

/**
 * Decisions from reviews a person called that nobody has signed yet, with enough about each
 * matter to decide on it: what it is called, what it is, and how far its review is from taking
 * effect. A review applies when its last matter is signed, so the page shows "1 of 2 signed".
 */
export async function decisionsToSign(runId: string): Promise<DecisionRow[]> {
  const db = await readDb();
  return db.all<DecisionRow>(
    `SELECT d.decision_id, d.meeting_id, m.meeting_date, d.item_id, d.kind, i.kind AS item_kind,
            COALESCE(i.title, u.title, d.item_id) AS title, COALESCE(i.description, u.description) AS description,
            d.outcome AS recommended, COALESCE(i.risk_tier, u.risk_tier) AS risk_tier, i.submitted_by,
            d.yes_votes, d.no_votes, d.abstentions,
            (SELECT COUNT(*) FROM decisions d2 WHERE d2.meeting_id = d.meeting_id) AS review_total,
            (SELECT COUNT(*) FROM decisions d3 JOIN attestations a3 ON a3.decision_id = d3.decision_id
              WHERE d3.meeting_id = d.meeting_id) AS review_signed
     FROM decisions d
     JOIN meetings m ON m.meeting_id = d.meeting_id
     LEFT JOIN attestations a ON a.decision_id = d.decision_id
     LEFT JOIN items i ON i.item_id = d.ref_id
     LEFT JOIN use_cases u ON u.use_case_id = d.ref_id
     WHERE d.run_id = ? AND a.attestation_id IS NULL AND m.convened
     ORDER BY m.meeting_date DESC, d.item_id`,
    [runId],
  );
}

export interface BallotRow {
  decision_id: string;
  agent_id: string;
  seat: string;
  vote: string;
  rationale: string | null;
}

/** Every ballot on the decisions still to be signed, so the page can draw who sat and how they voted. */
export async function ballotsToSign(runId: string): Promise<BallotRow[]> {
  const db = await readDb();
  return db.all<BallotRow>(
    `SELECT d.decision_id, v.agent_id, ag.seat, v.vote, v.rationale
     FROM decisions d
     JOIN meetings m ON m.meeting_id = d.meeting_id
     LEFT JOIN attestations a ON a.decision_id = d.decision_id
     JOIN votes v ON v.meeting_id = d.meeting_id AND v.item_id = d.item_id
     JOIN agents ag ON ag.agent_id = v.agent_id
     WHERE d.run_id = ? AND a.attestation_id IS NULL AND m.convened`,
    [runId],
  );
}

export interface WaitingMatter {
  ref_id: string;
  source: "item" | "use_case" | "policy_edit" | "status_change";
  item_kind: string;
  title: string;
  risk_tier: string | null;
  since: string;
  submitted_by: string | null;
  description: string | null;
  details: string | null; // json
}

/**
 * Everything waiting for a review, whether it came through intake or a member raised it.
 * Read straight from the tables, not from the last ranking, so a matter submitted a minute ago
 * is on the page even though the worker has not ranked it yet.
 */
export async function waitingMatters(runId: string): Promise<WaitingMatter[]> {
  const db = await readDb();
  const [items, useCases, edits] = await Promise.all([
    db.all<WaitingMatter>(
      `SELECT item_id AS ref_id, 'item' AS source, kind AS item_kind, title, risk_tier, submitted_on AS since, submitted_by, description, details
       FROM items WHERE run_id = ? AND status = 'submitted'`, [runId]),
    db.all<WaitingMatter>(
      `SELECT use_case_id AS ref_id, 'use_case' AS source, 'use_case' AS item_kind, title, risk_tier,
              proposed_month AS since, NULL AS submitted_by, description, details
       FROM use_cases WHERE run_id = ? AND status = 'proposed'`, [runId]),
    db.all<WaitingMatter>(
      `SELECT edit_id AS ref_id, 'policy_edit' AS source, 'policy_edit' AS item_kind, section AS title,
              NULL AS risk_tier, sim_month AS since, NULL AS submitted_by, text AS description, NULL AS details
       FROM policy_edits WHERE run_id = ? AND status = 'proposed'`, [runId]),
  ]);
  return [...items, ...useCases, ...edits];
}

export interface WorkRow {
  command_id: string;
  kind: string;
  payload: string | null;
  status: string;
  result: string | null;
  created_at: string;
}

/** What has been asked of the worker and not finished, plus anything that failed in the last day. */
export async function openWork(runId: string): Promise<WorkRow[]> {
  const db = await readDb();
  return db.all<WorkRow>(
    `SELECT command_id, kind, payload, status, result, created_at FROM commands
     WHERE (run_id = ? OR (run_id IS NULL AND kind = 'create_workspace'))
       AND kind IN ('candidates', 'convene', 'attest', 'submit', 'set_brief', 'create_workspace', 'update_profile',
                    'add_document', 'retire_document', 'set_panel', 'set_spend_cap')
       AND (status IN ('pending', 'processing')
            OR (status = 'failed' AND created_at > ?
                -- a failed ranking that a later one replaced is no longer news
                AND NOT (kind = 'candidates' AND EXISTS (
                  SELECT 1 FROM commands later WHERE later.run_id = commands.run_id AND later.kind = 'candidates'
                    AND later.status = 'done' AND later.created_at > commands.created_at))))
     ORDER BY created_at DESC LIMIT 12`,
    [runId, new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()],
  );
}

/** How many matters have been settled: signed decisions plus questions that were answered. */
export async function decidedCount(runId: string): Promise<number> {
  const db = await readDb();
  const row = await db.get<{ n: number }>(
    `SELECT (SELECT COUNT(*) FROM attestations WHERE run_id = ? AND outcome <> 'deferred')
          + (SELECT COUNT(*) FROM items WHERE run_id = ? AND status = 'advised') AS n`,
    [runId, runId],
  );
  return Number(row?.n ?? 0);
}

export interface ScopeRow {
  run_id: string;
  bank_id: string;
  condition: string;
  org_name: string | null;
  experiment_name: string;
  started_at: string;
}

/** Every committee a person could be looking at: organisations first, then simulated runs. */
export async function reviewScopes(): Promise<ScopeRow[]> {
  const db = await readDb();
  return db.all<ScopeRow>(
    `SELECT r.run_id, r.bank_id, r.condition, o.name AS org_name, e.name AS experiment_name, r.started_at
     FROM runs r JOIN experiments e ON e.experiment_id = r.experiment_id
     LEFT JOIN org_profiles o ON o.run_id = r.run_id
     ORDER BY CASE WHEN r.condition = 'workspace' THEN 0 ELSE 1 END, r.started_at DESC`,
  );
}

export interface DocumentRow {
  document_id: string;
  kind: string;
  title: string;
  body: string;
  added_by: string;
  added_at: string;
}

/** Governing documents in force. Retired ones stay in the table and out of this list. */
export async function documentsInForce(runId: string): Promise<DocumentRow[]> {
  const db = await readDb();
  return db.all<DocumentRow>(
    `SELECT document_id, kind, title, body, added_by, added_at FROM documents
     WHERE run_id = ? AND retired_at IS NULL ORDER BY added_at, document_id`,
    [runId],
  );
}

export interface PanelRow {
  kind: string;
  risk_tier: string;
  seats: string; // json list
}

/** Panels this customer has changed. A kind with no row here uses the platform default. */
export async function panelOverrides(runId: string): Promise<PanelRow[]> {
  const db = await readDb();
  return db.all<PanelRow>("SELECT kind, risk_tier, seats FROM panel_rules WHERE run_id = ? ORDER BY kind, risk_tier", [runId]);
}

export interface ChangeRow {
  change_id: string;
  changed_at: string;
  actor: string;
  source: string;
  area: string;
  target: string;
  before_value: string | null;
  after_value: string | null;
  reason: string;
}

/** The record of every configuration change, newest first. Append-only: nothing edits or removes a row. */
export async function changeLog(runId: string): Promise<ChangeRow[]> {
  const db = await readDb();
  return db.all<ChangeRow>(
    `SELECT change_id, changed_at, actor, source, area, target, before_value, after_value, reason
     FROM config_changes WHERE run_id = ? ORDER BY changed_at DESC, change_id DESC LIMIT 300`,
    [runId],
  );
}

export async function spendCap(runId: string): Promise<number | null> {
  const db = await readDb();
  const row = await db.get<{ cap: number | null }>("SELECT spend_cap_usd_per_month AS cap FROM runs WHERE run_id = ?", [runId]);
  return row?.cap ?? null;
}
