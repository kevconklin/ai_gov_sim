import { Chip, Empty, TableWrap } from "@/components/ui";
import { BANK_LABELS, SEVERITY_COLORS } from "@/lib/constants";
import { fmtRealTs, fmtUsd } from "@/lib/format";
import type { CheckpointRow, CommandRow, InterventionRow } from "@/lib/queries/control";
import type { RunRow } from "@/lib/queries/runs";

export function RunsTable({ runs }: { runs: RunRow[] }) {
  if (runs.length === 0) return <Empty>No runs.</Empty>;
  return (
    <TableWrap>
      <table className="tbl">
        <thead><tr><th>Run</th><th>Experiment</th><th>Bank</th><th>Condition</th><th className="num">Rep</th><th className="num">Seed</th><th>Status</th><th>Start</th><th>Current sim month</th><th>Fork of</th><th className="num">Cap / sim month</th><th>Started (UTC)</th></tr></thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.run_id}>
              <td>{r.run_id}</td><td>{r.experiment_id}</td><td>{BANK_LABELS[r.bank_id] ?? r.bank_id}</td><td>{r.condition}</td><td className="num">{r.replicate}</td><td className="num">{r.seed}</td>
              <td><Chip>{r.status}</Chip></td><td>{r.start_month}</td><td>{r.current_month ?? "-"}</td>
              <td>{r.parent_run_id ? `${r.parent_run_id} @ ${r.fork_month ?? "?"}` : "-"}</td>
              <td className="num">{r.spend_cap_usd_per_month !== null ? fmtUsd(r.spend_cap_usd_per_month, true) : "-"}</td><td>{fmtRealTs(r.started_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

const STATUS_COLOR: Record<string, string | undefined> = { failed: SEVERITY_COLORS.high, done: SEVERITY_COLORS.low, pending: SEVERITY_COLORS.medium };

export function CommandsTable({ rows }: { rows: CommandRow[] }) {
  if (rows.length === 0) return <Empty>None.</Empty>;
  return (
    <TableWrap>
      <table className="tbl">
        <thead><tr><th>Created (UTC)</th><th>Processed (UTC)</th><th>Run</th><th>Kind</th><th>Payload</th><th>Reason</th><th>Status</th><th>Result</th></tr></thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.command_id} title={c.command_id}>
              <td>{fmtRealTs(c.created_at)}</td><td>{fmtRealTs(c.processed_at)}</td><td>{c.run_id ?? "-"}</td><td>{c.kind}</td>
              <td><code>{c.payload}</code></td><td>{c.reason}</td><td><Chip color={STATUS_COLOR[c.status]}>{c.status}</Chip></td><td><code>{c.result ?? ""}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export function InterventionsTable({ rows }: { rows: InterventionRow[] }) {
  if (rows.length === 0) return <Empty>None.</Empty>;
  return (
    <TableWrap>
      <table className="tbl">
        <thead><tr><th>Real time (UTC)</th><th>Run</th><th>Sim month</th><th>Kind</th><th>Source</th><th>Description</th></tr></thead>
        <tbody>
          {rows.map((i) => (
            <tr key={i.intervention_id}>
              <td>{fmtRealTs(i.real_ts)}</td><td>{i.run_id ?? "all"}</td><td>{i.sim_month ?? "-"}</td><td>{i.kind}</td><td>{i.source}</td><td>{i.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export function CheckpointsTable({ rows }: { rows: CheckpointRow[] }) {
  if (rows.length === 0) return <Empty>None.</Empty>;
  return (
    <TableWrap>
      <table className="tbl">
        <thead><tr><th>Created (UTC)</th><th>Run</th><th>Sim month</th><th>URI</th><th>Git sha</th></tr></thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.checkpoint_id}><td>{fmtRealTs(c.created_at)}</td><td>{c.run_id}</td><td>{c.sim_month}</td><td><code>{c.uri}</code></td><td>{c.git_sha?.slice(0, 10) ?? "-"}</td></tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}
