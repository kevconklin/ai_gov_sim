import "server-only";
import { readDb } from "@/lib/db";
import { placeholders } from "@/lib/db/values";

export interface UseCaseRow {
  use_case_id: string;
  run_id: string;
  bank_id: string;
  title: string;
  description: string;
  lob: string | null;
  details: string;
  risk_tier: string | null;
  status: string;
  proposed_month: string;
  decided_month: string | null;
  live_month: string | null;
  retired_month: string | null;
  proposer_name: string | null;
  proposer_seat: string | null;
}

export async function useCasesFor(runIds: string[]): Promise<UseCaseRow[]> {
  if (runIds.length === 0) return [];
  const db = await readDb();
  return db.all<UseCaseRow>(
    `SELECT u.use_case_id, u.run_id, u.bank_id, u.title, u.description, u.lob, u.details, u.risk_tier, u.status,
            u.proposed_month, u.decided_month, u.live_month, u.retired_month, a.name AS proposer_name, a.seat AS proposer_seat
     FROM use_cases u LEFT JOIN agents a ON a.agent_id = u.proposer_agent_id
     WHERE u.run_id IN (${placeholders(runIds.length)}) ORDER BY u.proposed_month, u.title`,
    runIds,
  );
}

export async function useCaseDetail(useCaseId: string) {
  const db = await readDb();
  const [history, decisions, votes, engine, changes] = await Promise.all([
    db.all<{ history_id: string; sim_month: string; from_status: string | null; to_status: string; source: string }>(
      "SELECT history_id, sim_month, from_status, to_status, source FROM use_case_history WHERE use_case_id = ? ORDER BY sim_month, history_id",
      [useCaseId],
    ),
    db.all<{ decision_id: string; sim_month: string; outcome: string; yes_votes: number; no_votes: number; abstentions: number; kind: string }>(
      `SELECT d.decision_id, d.sim_month, d.outcome, d.yes_votes, d.no_votes, d.abstentions, d.kind FROM decisions d
       WHERE d.ref_id = ? OR d.ref_id IN (SELECT change_id FROM status_changes WHERE use_case_id = ?) ORDER BY d.sim_month`,
      [useCaseId, useCaseId],
    ),
    db.all<{ decision_id: string; name: string; seat: string; vote: string; rationale: string | null }>(
      `SELECT d.decision_id, a.name, a.seat, v.vote, v.rationale FROM decisions d
       JOIN votes v ON v.meeting_id = d.meeting_id AND v.item_id = d.item_id
       JOIN agents a ON a.agent_id = v.agent_id
       WHERE d.ref_id = ? OR d.ref_id IN (SELECT change_id FROM status_changes WHERE use_case_id = ?)
       ORDER BY d.sim_month, a.seat`,
      [useCaseId, useCaseId],
    ),
    db.all<{ decision_id: string; sim_month: string; classification: string; estimates: string; plan: string }>(
      "SELECT decision_id, sim_month, classification, estimates, plan FROM engine_decisions WHERE use_case_id = ?",
      [useCaseId],
    ),
    db.all<{ change_id: string; sim_month: string; new_status: string; rationale: string | null; status: string }>(
      "SELECT change_id, sim_month, new_status, rationale, status FROM status_changes WHERE use_case_id = ? ORDER BY sim_month",
      [useCaseId],
    ),
  ]);
  return { history, decisions, votes, engine, changes };
}
