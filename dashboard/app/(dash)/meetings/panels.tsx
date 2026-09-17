import { Chip, Empty, Panel, TableWrap } from "@/components/ui";
import { SEAT_LABELS, SEVERITY_COLORS } from "@/lib/constants";
import { parseJson } from "@/lib/db/values";
import type { AgendaItem, InboxRow, NewsRow, PositionRow, VoteRow } from "@/lib/queries/meetings";

const VOTE_COLOR: Record<string, string> = { yes: SEVERITY_COLORS.low!, no: SEVERITY_COLORS.high!, abstain: "var(--muted)" };

function byAgent<T extends { agent_id: string; name: string; seat: string }>(rows: T[]): { agent_id: string; name: string; seat: string }[] {
  const seen = new Map<string, { agent_id: string; name: string; seat: string }>();
  for (const r of rows) if (!seen.has(r.agent_id)) seen.set(r.agent_id, { agent_id: r.agent_id, name: r.name, seat: r.seat });
  return [...seen.values()];
}

export function VotesPanel({ agenda, votes }: { agenda: AgendaItem[]; votes: VoteRow[] }) {
  const items = agenda.filter((a) => votes.some((v) => v.item_id === a.item_id));
  const agents = byAgent(votes);
  return (
    <Panel title="Votes (secret ballot)">
      {votes.length === 0 ? <Empty>No votes recorded.</Empty> : (
        <TableWrap>
          <table className="tbl">
            <thead><tr><th>Member</th>{items.map((i) => <th key={i.item_id} title={i.title}>{i.item_id}</th>)}</tr></thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.agent_id}>
                  <td>{a.name} <span className="muted">{SEAT_LABELS[a.seat] ?? a.seat}</span></td>
                  {items.map((i) => {
                    const v = votes.find((x) => x.agent_id === a.agent_id && x.item_id === i.item_id);
                    return <td key={i.item_id} title={v?.rationale ?? ""}>{v ? <Chip color={VOTE_COLOR[v.vote]}>{v.vote}</Chip> : "-"}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Panel>
  );
}

export function PositionsPanel({ agenda, positions, sealed }: { agenda: AgendaItem[]; positions: PositionRow[]; sealed: boolean }) {
  return (
    <Panel title="Private positions">
      {sealed ? <Empty>Sealed until voting closes.</Empty> : positions.length === 0 ? <Empty>No positions.</Empty> : (
        <div className="flex flex-col gap-2">
          {agenda.filter((a) => positions.some((p) => p.item_id === a.item_id)).map((a) => (
            <details key={a.item_id}>
              <summary className="cursor-pointer">{a.item_id}: {a.title}</summary>
              <table className="tbl mt-1">
                <thead><tr><th>Member</th><th className="num">Support</th><th className="num">Stance</th><th>Summary</th></tr></thead>
                <tbody>
                  {positions.filter((p) => p.item_id === a.item_id).map((p) => {
                    const body = parseJson<{ summary?: string }>(p.position, {});
                    return (
                      <tr key={p.agent_id}>
                        <td>{p.name} <span className="muted">{SEAT_LABELS[p.seat] ?? p.seat}</span></td>
                        <td className="num">{p.support}</td>
                        <td className="num">{p.stance_score ?? "-"}</td>
                        <td>{body.summary ?? p.position}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </details>
          ))}
        </div>
      )}
    </Panel>
  );
}

export function PacketPanel({ inbox, news }: { inbox: InboxRow[]; news: NewsRow[] }) {
  return (
    <Panel title="Packet: inbox and news">
      {inbox.length + news.length === 0 ? <Empty>No inbox or news items this month.</Empty> : null}
      <ul className="flex flex-col gap-1">
        {inbox.map((i) => (
          <li key={i.item_id}>
            <details>
              <summary className="cursor-pointer">{i.sent_date} · {i.subject} <span className="muted">from {i.sender_name} to {i.recipient_seat ? SEAT_LABELS[i.recipient_seat] ?? i.recipient_seat : "committee"}</span></summary>
              <div className="whitespace-pre-wrap pl-3">{i.body}</div>
            </details>
          </li>
        ))}
        {news.map((n) => (
          <li key={n.news_id}>
            <details>
              <summary className="cursor-pointer">{n.published_date} · {n.headline} <span className="muted">{n.outlet}</span></summary>
              <div className="pl-3">{n.body}</div>
            </details>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
