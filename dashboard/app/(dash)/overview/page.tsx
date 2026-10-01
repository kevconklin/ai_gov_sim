import { ChartPanel } from "@/components/chart-panel";
import { TimeSeriesChart } from "@/components/charts/time-series";
import { NoRuns, SelectionHeader } from "@/components/selection-header";
import { BankName, Chip, Panel, Stat } from "@/components/ui";
import { BANK_COLORS, BANK_LABELS, SEVERITY_COLORS } from "@/lib/constants";
import { fmtInt, fmtUsd } from "@/lib/format";
import type { SearchParams } from "@/lib/params";
import { latest, metricRows, pivot, sumOver, type MetricRow } from "@/lib/queries/metrics";
import { alertsFor, openCountsFor, spendFor } from "@/lib/queries/overview";
import { resolveSelection, type RunRow } from "@/lib/queries/runs";

const HEADLINE = ["use_cases_live", "ai_revenue_monthly", "incidents", "findings", "control_count", "ai_spend_cumulative"];

export default async function OverviewPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const sel = await resolveSelection(sp);
  if (sel.runs.length === 0) return <><SelectionHeader title="Overview" sel={sel} /><NoRuns /></>;

  const runIds = sel.runs.map((r) => r.run_id);
  const [rows, alerts] = await Promise.all([metricRows(runIds, HEADLINE), alertsFor(runIds, true)]);
  const cards = await Promise.all(sel.runs.map((run) => BankCard({ run, rows })));
  const revenue = pivot(rows.filter((r) => r.metric === "ai_revenue_monthly"), (r) => r.bank_id);
  const series = sel.runs.map((r) => ({ key: r.bank_id, label: BANK_LABELS[r.bank_id] ?? r.bank_id, color: BANK_COLORS[r.bank_id] ?? "var(--muted)" }));

  return (
    <>
      <SelectionHeader title="Overview" subtitle="Both banks, chosen experiment and replicate. Simulated outcomes depend on engine_params.yaml." sel={sel} />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">{cards}</div>
      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
        <ChartPanel title="AI revenue per sim month" csvRows={revenue} csvName="overview-ai-revenue">
          <TimeSeriesChart data={revenue} xKey="sim_month" series={series} />
        </ChartPanel>
        <Panel title={`Open alerts (${alerts.length})`}>
          {alerts.length === 0 ? (
            <p className="muted">No open alerts.</p>
          ) : (
            <table className="tbl">
              <thead><tr><th>Sim month</th><th>Bank</th><th>Kind</th><th>Severity</th><th>Message</th></tr></thead>
              <tbody>
                {alerts.map((a) => (
                  <tr key={a.alert_id}>
                    <td>{a.sim_month ?? "-"}</td>
                    <td>{BANK_LABELS[sel.runs.find((r) => r.run_id === a.run_id)?.bank_id ?? ""] ?? "all"}</td>
                    <td>{a.kind}</td>
                    <td><Chip color={a.severity === "critical" ? SEVERITY_COLORS.high : a.severity === "warning" ? SEVERITY_COLORS.medium : undefined}>{a.severity}</Chip></td>
                    <td>{a.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </>
  );
}

async function BankCard({ run, rows }: { run: RunRow; rows: MetricRow[] }) {
  const [spend, counts] = await Promise.all([spendFor(run.run_id, run.current_month), openCountsFor(run.run_id)]);
  const month = run.current_month;
  const at = (metric: string, dim = "") => latest(rows, run.run_id, metric, dim)?.value ?? null;
  const incidentsLatest = rows.filter((r) => r.run_id === run.run_id && r.metric === "incidents" && r.sim_month === month).reduce((a, r) => a + (r.value ?? 0), 0);
  const cap = run.spend_cap_usd_per_month;
  return (
    <Panel key={run.run_id} title={<BankName bankId={run.bank_id} condition={run.condition} />} actions={<Chip>{run.status}</Chip>}>
      <div className="muted mb-2 text-xs">
        Run {run.run_id} · sim month {month ?? "(not started)"} · started at {run.start_month}
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Use cases live" value={fmtInt(at("use_cases_live", "total"))} />
        <Stat label="AI revenue (sim month)" value={fmtUsd(at("ai_revenue_monthly"))} />
        <Stat label="Incidents (month / total)" value={`${fmtInt(incidentsLatest)} / ${fmtInt(sumOver(rows, run.run_id, "incidents"))}`} />
        <Stat label="Findings (total / open)" value={`${fmtInt(sumOver(rows, run.run_id, "findings"))} / ${fmtInt(counts.openFindings)}`} />
        <Stat label="Policy controls" value={fmtInt(at("control_count"))} />
        <Stat label="AI spend (cumulative, sim)" value={fmtUsd(at("ai_spend_cumulative"))} />
        <Stat label="API spend this real month" value={fmtUsd(spend.realMonthUsd, true)} hint={`${counts.pendingCommands} pending command(s)`} />
        <Stat label="API spend, current sim month" value={fmtUsd(spend.simMonthUsd, true)} hint={cap !== null ? `cap ${fmtUsd(cap, true)} per sim month (${Math.round((spend.simMonthUsd / cap) * 100)}%)` : "no cap set"} />
      </div>
    </Panel>
  );
}
