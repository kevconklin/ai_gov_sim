import { FilterForm } from "@/components/filter-form";
import { BankTabs, NoRuns, SelectionHeader } from "@/components/selection-header";
import { Chip, Empty, Panel, TabLinks } from "@/components/ui";
import { SEAT_LABELS, SEATS } from "@/lib/constants";
import { first, href, type SearchParams } from "@/lib/params";
import { meetingDetail, meetingsForRun } from "@/lib/queries/meetings";
import { pickRun, resolveSelection } from "@/lib/queries/runs";
import { PacketPanel, PositionsPanel, VotesPanel } from "./panels";

export default async function MeetingsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const sel = await resolveSelection(sp);
  const run = pickRun(sel, sp);
  if (!run) return <><SelectionHeader title="Meetings" sel={sel} /><NoRuns /></>;

  const meetings = await meetingsForRun(run.run_id);
  const wantedMonth = first(sp, "month");
  const current = meetings.find((m) => m.sim_month === wantedMonth) ?? meetings.at(-1);
  const detail = current ? await meetingDetail(current.meeting_id) : null;
  const seat = first(sp, "seat") ?? "";
  const transcript = detail ? detail.messages.filter((m) => !seat || m.seat === seat) : [];

  return (
    <>
      <SelectionHeader title="Meetings" subtitle="All dates are sim dates." sel={sel} />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <BankTabs path="/meetings" sp={sp} sel={sel} current={run} reset={["month"]} />
        <TabLinks items={meetings.map((m) => ({ href: href("/meetings", sp, { month: m.sim_month }), label: m.meeting_date, active: m.meeting_id === current?.meeting_id }))} />
      </div>
      {!detail ? (
        <Empty>No meetings for this run yet.</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="flex min-w-0 flex-col gap-3">
            <Panel title={`Agenda, ${detail.meeting.meeting_date}`} actions={<Chip>{detail.meeting.status}</Chip>}>
              <table className="tbl">
                <thead><tr><th>Item</th><th>Kind</th><th>Title</th><th>Outcome</th></tr></thead>
                <tbody>
                  {detail.agenda.map((a) => {
                    const d = detail.decisions.find((x) => x.item_id === a.item_id);
                    return (
                      <tr key={a.item_id}>
                        <td>{a.item_id}</td><td>{a.kind}</td><td>{a.title}</td>
                        <td>{d ? `${d.outcome} (${d.yes_votes}-${d.no_votes}-${d.abstentions})` : "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Panel>
            <Panel
              title={`Transcript (${transcript.length} messages)`}
              actions={
                <FilterForm
                  keep={{ exp: sel.experimentId ?? undefined, rep: String(sel.replicate ?? ""), bank: run.bank_id, month: detail.meeting.sim_month }}
                  fields={[{ name: "seat", label: "Seat", value: seat, options: [{ value: "", label: "All seats" }, ...SEATS.map((s) => ({ value: s, label: SEAT_LABELS[s] ?? s }))] }]}
                />
              }
            >
              <ol className="flex flex-col gap-2">
                {transcript.map((m) => (
                  <li key={m.msg_id} className={m.agent_id ? "" : "muted italic"}>
                    <div className="text-xs">
                      <span className="font-semibold" style={{ color: m.agent_id ? "var(--text)" : "var(--muted)" }}>{m.name ? `${m.name}, ${SEAT_LABELS[m.seat ?? ""] ?? m.seat}` : "Meeting"}</span>
                      <span className="muted"> · {m.phase}{m.round !== null ? ` round ${m.round}` : ""} · #{m.seq}</span>
                    </div>
                    <div className="whitespace-pre-wrap">{m.text}</div>
                  </li>
                ))}
              </ol>
              {transcript.length === 0 ? <Empty>No messages for this filter.</Empty> : null}
            </Panel>
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            <VotesPanel agenda={detail.agenda} votes={detail.votes} />
            <PositionsPanel agenda={detail.agenda} positions={detail.positions} sealed={detail.meeting.status !== "closed"} />
            <Panel title="Minutes">
              {detail.meeting.minutes_text ? <div className="whitespace-pre-wrap">{detail.meeting.minutes_text}</div> : <Empty>No minutes yet.</Empty>}
            </Panel>
            <PacketPanel inbox={detail.inbox} news={detail.news} />
          </div>
        </div>
      )}
    </>
  );
}
