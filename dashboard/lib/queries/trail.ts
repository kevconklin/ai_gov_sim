import "server-only";
import { readDb } from "@/lib/db";
import type { TrailPerspective, TrailSignature } from "@/lib/reviews/trail";

/** Views filed on advisory items, which take no ballot. */
export async function perspectivesFor(meetingId: string): Promise<TrailPerspective[]> {
  const db = await readDb();
  return db.all<TrailPerspective>(
    `SELECT a.seat, p.item_id, p.stance, p.position, p.key_concern, p.would_change_my_mind
     FROM perspectives p JOIN agents a ON a.agent_id = p.agent_id WHERE p.meeting_id = ? ORDER BY p.item_id, a.seat`,
    [meetingId],
  );
}

/** Who signed what came out of this review. */
export async function signaturesFor(meetingId: string): Promise<TrailSignature[]> {
  const db = await readDb();
  return db.all<TrailSignature>(
    `SELECT a.decision_id, a.actor, a.outcome, a.rationale, a.source, a.created_at
     FROM attestations a JOIN decisions d ON d.decision_id = a.decision_id WHERE d.meeting_id = ? ORDER BY a.created_at`,
    [meetingId],
  );
}

/**
 * Who called the review, and when it started and finished. The command that convened it is the
 * only place that is recorded: its reason opens with the session's name, and its result names
 * the meeting it produced. A review called from the command line has no such row.
 */
export async function convenerOf(runId: string, meetingId: string): Promise<{ who: string; at: string; finishedAt: string | null } | null> {
  const db = await readDb();
  const rows = await db.all<{ reason: string; created_at: string; processed_at: string | null; result: string | null }>(
    `SELECT reason, created_at, processed_at, result FROM commands
     WHERE run_id = ? AND kind = 'convene' AND status = 'done' ORDER BY created_at DESC LIMIT 200`,
    [runId],
  );
  const row = rows.find((r) => {
    try {
      return (JSON.parse(r.result ?? "{}") as { meeting_id?: string }).meeting_id === meetingId;
    } catch {
      return false;
    }
  });
  if (!row) return null;
  return { who: row.reason.split(": convening")[0] ?? row.reason, at: row.created_at, finishedAt: row.processed_at };
}

export interface ReviewRow {
  meeting_id: string;
  meeting_date: string;
  status: string;
  agenda: string;
  decisions: number;
  signed: number;
  seats: number;
}

/** Every review a person called for this customer, newest first. */
export async function reviewsHeld(runId: string): Promise<ReviewRow[]> {
  const db = await readDb();
  return db.all<ReviewRow>(
    `SELECT m.meeting_id, m.meeting_date, m.status, m.agenda,
            (SELECT COUNT(*) FROM decisions d WHERE d.meeting_id = m.meeting_id) AS decisions,
            (SELECT COUNT(*) FROM attestations a JOIN decisions d ON d.decision_id = a.decision_id WHERE d.meeting_id = m.meeting_id) AS signed,
            (SELECT COUNT(DISTINCT x.agent_id) FROM messages x WHERE x.meeting_id = m.meeting_id AND x.agent_id IS NOT NULL) AS seats
     FROM meetings m WHERE m.run_id = ? AND m.convened ORDER BY m.meeting_date DESC, m.meeting_id DESC LIMIT 100`,
    [runId],
  );
}
