import { ChartPanel } from "@/components/chart-panel";
import { TimeSeriesChart, type Marker, type SeriesDef } from "@/components/charts/time-series";
import { NoRuns, SelectionHeader } from "@/components/selection-header";
import { BankName, Chip, Panel, TableWrap } from "@/components/ui";
import { BANK_COLORS, BANK_LABELS, SEVERITY_COLORS } from "@/lib/constants";
import { parseJson } from "@/lib/db/values";
import type { SearchParams } from "@/lib/params";
import { eventsFor } from "@/lib/queries/events";
import { metricRows, pivot } from "@/lib/queries/metrics";
import { resolveSelection } from "@/lib/queries/runs";

const SIMPLE: [string, string][] = [
  ["ai_revenue_monthly", "AI revenue per month (USD)"],
  ["ai_spend_cumulative", "AI spend, cumulative (USD)"],
  ["roi_cumulative", "ROI, cumulative"],
  ["complaint_rate", "Complaints per 10k customers"],
  ["shadow_ai_rate", "Shadow AI usage rate"],
  ["effort_overrun_pct", "Effort overrun (%)"],
];

export default async function OutcomesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const sel = await resolveSelection(sp);
  if (sel.runs.length === 0) return <><SelectionHeader title="Outcomes" sel={sel} /><NoRuns /></>;
  const runIds = sel.runs.map((r) => r.run_id);
  const [rows, events] = await Promise.all([
    metricRows(runIds, [...SIMPLE.map((s) => s[0]), "incidents", "findings", "use_cases_live", "enforcement_flag"]),
    eventsFor(runIds),
  ]);
  const bankSeries: SeriesDef[] = sel.runs.map((r) => ({ key: r.bank_id, label: BANK_LABELS[r.bank_id] ?? r.bank_id, color: BANK_COLORS[r.bank_id] ?? "var(--muted)" }));
  const markers: Marker[] = events
    .filter((e) => e.severity === "high" || e.severity === "medium")
    .map((e) => ({ x: e.sim_month, label: `${e.type}`, color: BANK_COLORS[e.bank_id] ?? "var(--muted)" }));

  const incidents = pivot(rows.filter((r) => r.metric === "incidents"), (r) => `${r.bank_id}_${r.dimension}`);
  const incidentSeries: SeriesDef[] = sel.runs.flatMap((r, i) =>
    ["low", "medium", "high"].map((sev) => ({ key: `${r.bank_id}_${sev}`, label: `${BANK_LABELS[r.bank_id]} ${sev}`, color: SEVERITY_COLORS[sev]!, dashed: i > 0 })),
  );
  const findings = pivot(rows.filter((r) => r.metric === "findings"), (r) => r.bank_id);
  const live = pivot(rows.filter((r) => r.metric === "use_cases_live" && r.dimension === "total"), (r) => r.bank_id);

  return (
    <>
      <SelectionHeader title="Outcomes" subtitle="Simulated outcomes from the reality engine; they depend on engine_params.yaml. Dashed markers are medium/high events." sel={sel} />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {SIMPLE.map(([metric, title]) => {
          const data = pivot(rows.filter((r) => r.metric === metric && r.dimension === ""), (r) => r.bank_id);
          return (
            <ChartPanel key={metric} title={title} csvRows={data} csvName={`outcomes-${metric}`}>
              <TimeSeriesChart data={data} xKey="sim_month" series={bankSeries} markers={markers} />
            </ChartPanel>
          );
        })}
        <ChartPanel title="Incidents by severity (solid: first bank, dashed: second)" csvRows={incidents} csvName="outcomes-incidents">
          <TimeSeriesChart data={incidents} xKey="sim_month" series={incidentSeries} markers={markers} />
        </ChartPanel>
        <ChartPanel title="Regulatory findings (all severities)" csvRows={findings} csvName="outcomes-findings">
          <TimeSeriesChart data={findings} xKey="sim_month" series={bankSeries} markers={markers} />
        </ChartPanel>
        <ChartPanel title="Use cases live (total)" csvRows={live} csvName="outcomes-use-cases-live">
          <TimeSeriesChart data={live} xKey="sim_month" series={bankSeries} markers={markers} />
        </ChartPanel>
        <Panel title={`Events (${events.length})`}>
          <TableWrap>
            <table className="tbl">
              <thead><tr><th>Sim month</th><th>Bank</th><th>Type</th><th>Severity</th><th>Source</th><th>Summary</th></tr></thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.event_id}>
                    <td>{e.sim_month}</td>
                    <td><BankName bankId={e.bank_id} /></td>
                    <td>{e.type}</td>
                    <td>{e.severity ? <Chip color={SEVERITY_COLORS[e.severity]}>{e.severity}</Chip> : "-"}</td>
                    <td>{e.source}</td>
                    <td>{parseJson<{ summary?: string }>(e.payload, {}).summary ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Panel>
      </div>
    </>
  );
}
