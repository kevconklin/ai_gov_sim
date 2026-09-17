import { ChartPanel } from "@/components/chart-panel";
import { TimeSeriesChart, type SeriesDef } from "@/components/charts/time-series";
import { NoRuns, SelectionHeader } from "@/components/selection-header";
import { BankName, Chip, Empty, Panel, TableWrap } from "@/components/ui";
import { BANK_COLORS, BANK_LABELS, SEAT_LABELS, SEATS, SEVERITY_COLORS } from "@/lib/constants";
import { fmtNum, fmtRealTs } from "@/lib/format";
import type { SearchParams } from "@/lib/params";
import { callTotals, failedCalls, retriedCalls, type CallIssueRow } from "@/lib/queries/health";
import { metricRows, pivot } from "@/lib/queries/metrics";
import { alertsFor } from "@/lib/queries/overview";
import { resolveSelection } from "@/lib/queries/runs";

function CallTable({ rows }: { rows: CallIssueRow[] }) {
  if (rows.length === 0) return <Empty>None.</Empty>;
  return (
    <TableWrap>
      <table className="tbl">
        <thead><tr><th>Real time (UTC)</th><th>Run</th><th>Sim month</th><th>Model</th><th>Purpose</th><th>Status</th><th className="num">Attempt</th><th>Error</th></tr></thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.call_id}>
              <td><a href={`/logs?call=${encodeURIComponent(c.call_id)}`}>{fmtRealTs(c.created_at)}</a></td>
              <td>{c.run_id ?? "-"}</td><td>{c.sim_month ?? "-"}</td><td>{c.model}</td><td>{c.purpose}</td><td>{c.status}</td><td className="num">{c.attempt}</td><td>{c.error ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export default async function HealthPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const sel = await resolveSelection(sp);
  if (sel.runs.length === 0) return <><SelectionHeader title="Health" sel={sel} /><NoRuns /></>;
  const runIds = sel.runs.map((r) => r.run_id);
  const [alerts, failed, retried, totals, rows] = await Promise.all([
    alertsFor(runIds, false),
    failedCalls(runIds),
    retriedCalls(runIds),
    callTotals(runIds),
    metricRows(runIds, ["suspicion_rate", "catchphrase_alerts", "false_outcome_claims", "ngram_repeat_rate"]),
  ]);
  const bankSeries: SeriesDef[] = sel.runs.map((r) => ({ key: r.bank_id, label: BANK_LABELS[r.bank_id] ?? r.bank_id, color: BANK_COLORS[r.bank_id] ?? "var(--muted)" }));
  const suspicion = pivot(rows.filter((r) => r.metric === "suspicion_rate"), (r) => r.bank_id);
  const catchphrase = pivot(rows.filter((r) => r.metric === "catchphrase_alerts"), (r) => r.bank_id);
  const falseClaims = pivot(rows.filter((r) => r.metric === "false_outcome_claims"), (r) => r.bank_id);
  const bySeat = SEATS.map((seat) => {
    const row: Record<string, string | number> = { seat };
    for (const r of sel.runs) {
      const seatRows = rows.filter((x) => x.run_id === r.run_id && x.dimension === seat);
      row[`${r.bank_id}_catchphrase_alerts`] = seatRows.filter((x) => x.metric === "catchphrase_alerts").reduce((a, x) => a + (x.value ?? 0), 0);
      row[`${r.bank_id}_false_outcome_claims`] = seatRows.filter((x) => x.metric === "false_outcome_claims").reduce((a, x) => a + (x.value ?? 0), 0);
      const ng = seatRows.filter((x) => x.metric === "ngram_repeat_rate").sort((a, b) => a.sim_month.localeCompare(b.sim_month)).at(-1);
      row[`${r.bank_id}_ngram_repeat_rate_latest`] = ng?.value ?? "";
    }
    return row;
  });

  return (
    <>
      <SelectionHeader title="Health" subtitle="Repetition, suspicion, false claims, and API reliability. Real timestamps shown in UTC." sel={sel} />
      <div className="mb-3 grid grid-cols-1 gap-3 xl:grid-cols-3">
        <ChartPanel title="Suspicion rate" csvRows={suspicion} csvName="health-suspicion-rate"><TimeSeriesChart data={suspicion} xKey="sim_month" series={bankSeries} height={180} /></ChartPanel>
        <ChartPanel title="Catchphrase alerts (all seats)" csvRows={catchphrase} csvName="health-catchphrase-alerts"><TimeSeriesChart data={catchphrase} xKey="sim_month" series={bankSeries} height={180} /></ChartPanel>
        <ChartPanel title="False outcome claims (all seats)" csvRows={falseClaims} csvName="health-false-outcome-claims"><TimeSeriesChart data={falseClaims} xKey="sim_month" series={bankSeries} height={180} /></ChartPanel>
      </div>
      <div className="mb-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
        <ChartPanel title="Repetition by seat (run totals; 5-gram repeat is latest month)" csvRows={bySeat} csvName="health-by-seat">
          <TableWrap>
            <table className="tbl">
              <thead>
                <tr><th>Seat</th>{sel.runs.map((r) => <th key={r.run_id} colSpan={3}>{BANK_LABELS[r.bank_id]}</th>)}</tr>
                <tr><th />{sel.runs.map((r) => ["Catchphrase", "False claims", "5-gram"].map((h) => <th key={`${r.run_id}${h}`} className="num">{h}</th>))}</tr>
              </thead>
              <tbody>
                {bySeat.map((row) => (
                  <tr key={String(row.seat)}>
                    <td>{SEAT_LABELS[String(row.seat)]}</td>
                    {sel.runs.map((r) => ["catchphrase_alerts", "false_outcome_claims", "ngram_repeat_rate_latest"].map((k) => <td key={`${r.run_id}${k}`} className="num">{fmtNum(typeof row[`${r.bank_id}_${k}`] === "number" ? (row[`${r.bank_id}_${k}`] as number) : null)}</td>))}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </ChartPanel>
        <Panel title="LLM call reliability">
          <table className="tbl">
            <thead><tr><th>Bank</th><th className="num">Calls</th><th className="num">Failed</th><th className="num">Retries</th></tr></thead>
            <tbody>
              {sel.runs.map((r) => {
                const t = totals.find((x) => x.run_id === r.run_id);
                return <tr key={r.run_id}><td><BankName bankId={r.bank_id} /></td><td className="num">{t?.total ?? 0}</td><td className="num">{t?.failed ?? 0}</td><td className="num">{t?.retries ?? 0}</td></tr>;
              })}
            </tbody>
          </table>
        </Panel>
      </div>
      <Panel title={`Alerts (${alerts.length})`} className="mb-3">
        {alerts.length === 0 ? <Empty>No alerts.</Empty> : (
          <TableWrap>
            <table className="tbl">
              <thead><tr><th>Real time (UTC)</th><th>Sim month</th><th>Run</th><th>Kind</th><th>Severity</th><th>Message</th><th>Ack</th></tr></thead>
              <tbody>
                {alerts.map((a) => (
                  <tr key={a.alert_id}>
                    <td>{fmtRealTs(a.created_at)}</td><td>{a.sim_month ?? "-"}</td><td>{a.run_id ?? "all"}</td><td>{a.kind}</td>
                    <td><Chip color={a.severity === "critical" ? SEVERITY_COLORS.high : a.severity === "warning" ? SEVERITY_COLORS.medium : undefined}>{a.severity}</Chip></td>
                    <td>{a.message}</td><td>{a.acknowledged ? "yes" : "no"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>
      <Panel title={`Failed calls (${failed.length})`} className="mb-3"><CallTable rows={failed} /></Panel>
      <Panel title={`Retried calls (${retried.length})`}><CallTable rows={retried} /></Panel>
    </>
  );
}
