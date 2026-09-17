import "server-only";
import { readDb } from "@/lib/db";
import { numOrNull } from "@/lib/db/values";

export interface AgentRow {
  agent_id: string;
  seat: string;
  name: string;
  title: string;
  persona_file: string;
  active_from: string;
  active_to: string | null;
  stance_baseline: number;
  replaced_agent_id: string | null;
  replacement_reason: string | null;
}

export interface VoteHistoryRow {
  seat: string;
  name: string;
  sim_month: string;
  meeting_date: string;
  item_id: string;
  vote: string;
  outcome: string | null;
  kind: string | null;
}

export async function agentsForRun(runId: string): Promise<AgentRow[]> {
  const db = await readDb();
  const rows = await db.all<AgentRow>(
    `SELECT agent_id, seat, name, title, persona_file, active_from, active_to, stance_baseline, replaced_agent_id, replacement_reason
     FROM agents WHERE run_id = ? ORDER BY seat, active_from`,
    [runId],
  );
  return rows.map((r) => ({ ...r, stance_baseline: numOrNull(r.stance_baseline) ?? 0 }));
}

export async function voteHistory(runId: string): Promise<VoteHistoryRow[]> {
  const db = await readDb();
  return db.all<VoteHistoryRow>(
    `SELECT a.seat, a.name, m.sim_month, m.meeting_date, v.item_id, v.vote, d.outcome, d.kind
     FROM votes v
     JOIN agents a ON a.agent_id = v.agent_id
     JOIN meetings m ON m.meeting_id = v.meeting_id
     LEFT JOIN decisions d ON d.meeting_id = v.meeting_id AND d.item_id = v.item_id
     WHERE v.run_id = ? ORDER BY m.meeting_date, v.item_id`,
    [runId],
  );
}
