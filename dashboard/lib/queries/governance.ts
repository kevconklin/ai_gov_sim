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
    `SELECT a.attestation_id, a.decision_id, d.item_id, a.actor, a.outcome,
            d.outcome AS recommended, a.rationale, a.created_at, a.source
     FROM attestations a JOIN decisions d ON d.decision_id = a.decision_id
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
}

/** Present for a workspace; absent for a simulated run, whose organisation is a fictional bank. */
export async function orgProfile(runId: string): Promise<OrgRow | undefined> {
  const db = await readDb();
  return db.get<OrgRow>("SELECT name, risk_appetite, facts FROM org_profiles WHERE run_id = ?", [runId]);
}
