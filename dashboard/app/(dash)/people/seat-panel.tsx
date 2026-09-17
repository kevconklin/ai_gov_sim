import { ChartPanel } from "@/components/chart-panel";
import { TimeSeriesChart } from "@/components/charts/time-series";
import { Chip, Empty, Stat } from "@/components/ui";
import { BANK_COLORS, SEAT_LABELS, SEVERITY_COLORS } from "@/lib/constants";
import { fmtNum, fmtPct } from "@/lib/format";
import { pivot, type MetricRow } from "@/lib/queries/metrics";
import type { AgentRow, VoteHistoryRow } from "@/lib/queries/people";

export const SEAT_METRICS = [
  "stance_score", "stance_drift", "speaking_share", "type_token_ratio", "ngram_repeat_rate", "catchphrase_alerts",
  "objection_count", "dissent_by_seat", "influence", "position_shift_rate", "false_outcome_claims",
] as const;

function lastValue(rows: MetricRow[], metric: string): number | null {
  return rows.filter((r) => r.metric === metric).sort((a, b) => a.sim_month.localeCompare(b.sim_month)).at(-1)?.value ?? null;
}

function total(rows: MetricRow[], metric: string): number {
  return rows.filter((r) => r.metric === metric).reduce((a, r) => a + (r.value ?? 0), 0);
}

export function SeatPanel({ seat, bankId, agents, votes, rows }: { seat: string; bankId: string; agents: AgentRow[]; votes: VoteHistoryRow[]; rows: MetricRow[] }) {
  const current = agents.find((a) => a.active_to === null) ?? agents.at(-1);
  const stance = pivot(rows.filter((r) => r.metric === "stance_score" || r.metric === "speaking_share"), (r) => r.metric);
  const csv = pivot(rows, (r) => r.metric);
  const title = (
    <span>
      {SEAT_LABELS[seat] ?? seat}
      {current ? <span className="muted font-normal"> · {current.name}, {current.title}</span> : null}
    </span>
  );
  return (
    <ChartPanel title={title} csvRows={csv} csvName={`people-${bankId}-${seat}`}>
      {current ? <div className="muted mb-1 text-xs">Persona {current.persona_file} · baseline stance {current.stance_baseline}</div> : <Empty>No agent in this seat.</Empty>}
      <TimeSeriesChart
        data={stance}
        xKey="sim_month"
        height={150}
        yDomain={[1, 5]}
        series={[{ key: "stance_score", label: "Stance score", color: BANK_COLORS[bankId] ?? "var(--accent)" }]}
        referenceY={current ? [{ y: current.stance_baseline, label: "baseline" }] : []}
      />
      <div className="mt-2 grid grid-cols-4 gap-1.5">
        <Stat label="Speaking share" value={fmtPct(lastValue(rows, "speaking_share"))} />
        <Stat label="Stance drift" value={fmtNum(lastValue(rows, "stance_drift"))} />
        <Stat label="Type-token ratio" value={fmtNum(lastValue(rows, "type_token_ratio"))} />
        <Stat label="5-gram repeat" value={fmtPct(lastValue(rows, "ngram_repeat_rate"))} />
        <Stat label="Catchphrase alerts" value={fmtNum(total(rows, "catchphrase_alerts"))} />
        <Stat label="Objections" value={fmtNum(total(rows, "objection_count"))} />
        <Stat label="Dissent / influence" value={`${fmtPct(lastValue(rows, "dissent_by_seat"), 0)} / ${fmtPct(lastValue(rows, "influence"), 0)}`} />
        <Stat label="Pos. shift / false claims" value={`${fmtPct(lastValue(rows, "position_shift_rate"), 0)} / ${fmtNum(total(rows, "false_outcome_claims"))}`} />
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer">Vote history ({votes.length})</summary>
        <table className="tbl mt-1">
          <thead><tr><th>Meeting</th><th>Member</th><th>Item</th><th>Kind</th><th>Vote</th><th>Outcome</th></tr></thead>
          <tbody>
            {votes.map((v, i) => (
              <tr key={i}>
                <td>{v.meeting_date}</td><td>{v.name}</td><td>{v.item_id}</td><td>{v.kind ?? "-"}</td>
                <td><Chip color={v.vote === "no" ? SEVERITY_COLORS.high : v.vote === "yes" ? SEVERITY_COLORS.low : undefined}>{v.vote}</Chip></td>
                <td>{v.outcome ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <div className="mt-2">
        <div className="font-semibold">Turnover</div>
        {agents.length <= 1 ? <span className="muted">No turnover.</span> : (
          <ul>
            {agents.map((a) => (
              <li key={a.agent_id}>
                {a.name}: {a.active_from} to {a.active_to ?? "present"}
                {a.replacement_reason ? <span className="muted"> · replaced predecessor: {a.replacement_reason}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </ChartPanel>
  );
}
