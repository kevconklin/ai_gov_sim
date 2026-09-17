import "server-only";
import { readDb } from "@/lib/db";
import { num, numOrNull, parseJson } from "@/lib/db/values";

export interface MeetingSummary { meeting_id: string; sim_month: string; meeting_date: string; status: string }
export interface AgendaItem { item_id: string; kind: string; title: string; ref_id?: string }
export interface MessageRow { msg_id: string; agent_id: string | null; name: string | null; seat: string | null; phase: string; round: number | null; seq: number; text: string }
export interface PositionRow { agent_id: string; name: string; seat: string; item_id: string; support: number; stance_score: number | null; position: string }
export interface VoteRow { agent_id: string; name: string; seat: string; item_id: string; vote: string; rationale: string | null }
export interface DecisionRow { decision_id: string; item_id: string; kind: string; ref_id: string; outcome: string; yes_votes: number; no_votes: number; abstentions: number }
export interface InboxRow { item_id: string; sent_date: string; recipient_seat: string | null; sender_name: string; sender_title: string; subject: string; body: string }
export interface NewsRow { news_id: string; published_date: string; outlet: string; headline: string; body: string }

export async function meetingsForRun(runId: string): Promise<MeetingSummary[]> {
  const db = await readDb();
  return db.all<MeetingSummary>("SELECT meeting_id, sim_month, meeting_date, status FROM meetings WHERE run_id = ? ORDER BY meeting_date", [runId]);
}

export async function meetingDetail(meetingId: string) {
  const db = await readDb();
  const meeting = await db.get<{ meeting_id: string; run_id: string; bank_id: string; sim_month: string; meeting_date: string; agenda: string; minutes_json: string | null; minutes_text: string | null; status: string }>(
    "SELECT meeting_id, run_id, bank_id, sim_month, meeting_date, agenda, minutes_json, minutes_text, status FROM meetings WHERE meeting_id = ?",
    [meetingId],
  );
  if (!meeting) return null;
  const [messages, positions, votes, decisions, inbox, news] = await Promise.all([
    db.all<MessageRow>(
      `SELECT m.msg_id, m.agent_id, a.name, a.seat, m.phase, m.round, m.seq, m.text
       FROM messages m LEFT JOIN agents a ON a.agent_id = m.agent_id
       WHERE m.meeting_id = ? ORDER BY m.seq`,
      [meetingId],
    ),
    db.all<PositionRow>(
      `SELECT p.agent_id, a.name, a.seat, p.item_id, p.support, p.stance_score, p.position
       FROM positions p JOIN agents a ON a.agent_id = p.agent_id WHERE p.meeting_id = ? ORDER BY p.item_id, a.seat`,
      [meetingId],
    ),
    db.all<VoteRow>(
      `SELECT v.agent_id, a.name, a.seat, v.item_id, v.vote, v.rationale
       FROM votes v JOIN agents a ON a.agent_id = v.agent_id WHERE v.meeting_id = ? ORDER BY v.item_id, a.seat`,
      [meetingId],
    ),
    db.all<DecisionRow>(
      "SELECT decision_id, item_id, kind, ref_id, outcome, yes_votes, no_votes, abstentions FROM decisions WHERE meeting_id = ? ORDER BY item_id",
      [meetingId],
    ),
    db.all<InboxRow>(
      "SELECT item_id, sent_date, recipient_seat, sender_name, sender_title, subject, body FROM inbox_items WHERE run_id = ? AND sim_month = ? ORDER BY sent_date",
      [meeting.run_id, meeting.sim_month],
    ),
    db.all<NewsRow>(
      "SELECT news_id, published_date, outlet, headline, body FROM news_items WHERE run_id = ? AND sim_month = ? ORDER BY published_date",
      [meeting.run_id, meeting.sim_month],
    ),
  ]);
  return {
    meeting,
    agenda: parseJson<AgendaItem[]>(meeting.agenda, []),
    messages: messages.map((m) => ({ ...m, seq: num(m.seq), round: numOrNull(m.round) })),
    positions: positions.map((p) => ({ ...p, support: num(p.support), stance_score: numOrNull(p.stance_score) })),
    votes,
    decisions: decisions.map((d) => ({ ...d, yes_votes: num(d.yes_votes), no_votes: num(d.no_votes), abstentions: num(d.abstentions) })),
    inbox,
    news,
  };
}
