import "server-only";
import { readDb } from "@/lib/db";

export interface SeatVoteRow {
  seat: string;
  title: string;
  vote: "yes" | "no" | "abstain" | "absent";
  strength: number | null;     // 1-5 how strongly the ballot is held; null for a ballot cast before strength existed
  support: number | null;      // 1-5 the sealed position before the debate
  rationale: string | null;
}

export interface ReviewVotes {
  meeting_id: string;
  meeting_date: string;
  recommended: string;         // the committee's outcome
  signed: string | null;       // what a person signed, if anyone has
  yes: number;
  no: number;
  abstain: number;
  debate_skipped: boolean;
  seats: SeatVoteRow[];
}

/** Every review of one matter, oldest first, with each seat's leaning before the debate and its ballot after. */
export async function voteHistory(runId: string, itemId: string): Promise<ReviewVotes[]> {
  const db = await readDb();
  const short = (itemId.split("/").pop() ?? itemId).toUpperCase();   // IT-001, or the run-scoped id a link carries
  const meetings = await db.all<{ meeting_id: string; meeting_date: string; outcome: string; yes_votes: number; no_votes: number; abstentions: number; debate_skipped: number | null; signed: string | null }>(
    `SELECT d.meeting_id, m.meeting_date, d.outcome, d.yes_votes, d.no_votes, d.abstentions, m.debate_skipped,
            (SELECT a.outcome FROM attestations a WHERE a.decision_id = d.decision_id ORDER BY a.created_at DESC LIMIT 1) AS signed
     FROM decisions d JOIN meetings m ON m.meeting_id = d.meeting_id
     WHERE d.run_id = ? AND d.item_id = ? ORDER BY m.meeting_date, d.meeting_id`, [runId, short]);
  if (!meetings.length) return [];
  const ids = meetings.map((m) => m.meeting_id);
  const marks = ids.map(() => "?").join(", ");
  const [votes, positions, seated] = await Promise.all([
    db.all<{ meeting_id: string; seat: string; title: string; vote: string; strength: number | null; rationale: string | null }>(
      `SELECT v.meeting_id, a.seat, a.title, v.vote, v.strength, v.rationale FROM votes v JOIN agents a ON a.agent_id = v.agent_id
       WHERE v.meeting_id IN (${marks}) AND v.item_id = ?`, [...ids, short]),
    db.all<{ meeting_id: string; seat: string; support: number }>(
      `SELECT p.meeting_id, a.seat, p.support FROM positions p JOIN agents a ON a.agent_id = p.agent_id
       WHERE p.meeting_id IN (${marks}) AND p.item_id = ?`, [...ids, short]),
    // who sat: whoever recorded a position or a ballot in that review, in the committee's speaking order
    db.all<{ seat: string; title: string; ord: number }>(
      `SELECT a.seat, a.title, MIN(a.active_from) AS ord FROM agents a WHERE a.run_id = ? GROUP BY a.seat, a.title ORDER BY ord, a.seat`, [runId]),
  ]);
  return meetings.map((m) => {
    const v = new Map(votes.filter((x) => x.meeting_id === m.meeting_id).map((x) => [x.seat, x]));
    const p = new Map(positions.filter((x) => x.meeting_id === m.meeting_id).map((x) => [x.seat, Number(x.support)]));
    const sat = seated.filter((s) => v.has(s.seat) || p.has(s.seat));
    return {
      meeting_id: m.meeting_id, meeting_date: m.meeting_date, recommended: m.outcome, signed: m.signed,
      yes: Number(m.yes_votes), no: Number(m.no_votes), abstain: Number(m.abstentions), debate_skipped: Boolean(m.debate_skipped),
      seats: sat.map((s) => {
        const ballot = v.get(s.seat);
        const vote = ballot ? (ballot.vote === "yes" || ballot.vote === "no" ? ballot.vote : "abstain") : "absent";
        return { seat: s.seat, title: s.title, vote, strength: ballot?.strength == null ? null : Number(ballot.strength),
                 support: p.has(s.seat) ? p.get(s.seat)! : null, rationale: ballot?.rationale ?? null };
      }),
    };
  });
}
