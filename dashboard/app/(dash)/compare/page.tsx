import { ChartPanel } from "@/components/chart-panel";
import { BandChart } from "@/components/charts/band-chart";
import { CsvButton } from "@/components/csv-button";
import { SelectionHeader } from "@/components/selection-header";
import { Empty, Panel } from "@/components/ui";
import { bandRowsToCsv, conditionBands, conditionColor, perRunValues, type BandKind } from "@/lib/compare";
import { metricDef } from "@/lib/metrics-catalog";
import { all, first, type SearchParams } from "@/lib/params";
import { experimentRuns, firstHighIncidentMonths, firstMraMonths, longMetrics } from "@/lib/queries/compare";
import { resolveSelection } from "@/lib/queries/runs";
import { MetricPicker } from "./metric-picker";
import { SurvivalPanel } from "./survival-panel";

const DEFAULT_METRICS = ["use_cases_live", "ai_revenue_monthly", "control_count", "incidents"];

export default async function ComparePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const sel = await resolveSelection(sp);
  if (!sel.experimentId) return <><SelectionHeader title="Compare" sel={sel} /><Empty>No experiments.</Empty></>;

  const picked = all(sp, "m").filter((m) => metricDef(m));
  const metrics = picked.length > 0 ? picked : DEFAULT_METRICS;
  const band: BandKind = first(sp, "band") === "boot" ? "boot" : "minmax";
  const dim = first(sp, "dim") ?? "";
  const runs = await experimentRuns(sel.experimentId);
  const runIds = runs.map((r) => r.run_id);
  const [rows, mra, incident] = await Promise.all([longMetrics(runIds, metrics), firstMraMonths(runIds), firstHighIncidentMonths(runIds)]);
  const conditions = [...new Set(runs.map((r) => r.condition))].sort();
  const series = conditions.map((c, i) => ({ key: c, label: c, color: conditionColor(c, i) }));
  const replicateCounts = conditions.map((c) => `${c}: ${runs.filter((r) => r.condition === c).length} replicate run(s)`).join(" · ");

  const runMeta = new Map(runs.map((r) => [r.run_id, r]));
  const longCsv = metrics.flatMap((m) => {
    const def = metricDef(m)!;
    return perRunValues(def, rows, dim).map((v) => {
      const r = runMeta.get(v.run_id);
      return { experiment_id: sel.experimentId, metric: m, dimension: dim || `(${def.agg})`, condition: r?.condition ?? "", replicate: r?.replicate ?? null, bank_id: r?.bank_id ?? "", run_id: v.run_id, sim_month: v.sim_month, value: v.value };
    });
  });

  return (
    <>
      <SelectionHeader title="Compare" subtitle={`Runs grouped by condition across replicates (forks excluded). ${replicateCounts}`} sel={sel}>
        <CsvButton rows={longCsv} filename={`compare-${sel.experimentId}-long`} label="Download all (long CSV)" />
      </SelectionHeader>
      <MetricPicker selected={metrics} band={band} dim={dim} experimentId={sel.experimentId} replicate={sel.replicate} />
      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
        {metrics.map((m) => {
          const def = metricDef(m)!;
          const data = conditionBands(perRunValues(def, rows, dim), runs, band);
          const dimLabel = def.dims.length === 0 ? "" : dim && def.dims.includes(dim) ? ` [${dim}]` : ` [${def.agg === "total_row" ? "total" : def.agg} over dimensions]`;
          return (
            <ChartPanel key={m} title={`${def.label}${dimLabel}, mean with ${band === "boot" ? "95% bootstrap CI" : "min-max"}`} csvRows={bandRowsToCsv(data)} csvName={`compare-${m}`}>
              <BandChart data={data} xKey="sim_month" series={series} />
            </ChartPanel>
          );
        })}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
        <SurvivalPanel title="Time to first MRA (or worse)" name="first-mra" runs={runs} firstMonths={mra} />
        <SurvivalPanel title="Time to first high-severity incident" name="first-high-incident" runs={runs} firstMonths={incident} />
      </div>
      <Panel className="mt-3" title="Notes">
        <p className="muted">
          Incidents for survival analysis are events with severity high and type in: incident, data_leak, model_error, complaint_wave, shadow_ai_discovery.
          Time is months from run start (start month = 1); runs without the event are censored at their last completed sim month.
          Bootstrap bands use 2,000 seeded resamples of replicate means; with one replicate the band collapses to the mean.
        </p>
      </Panel>
    </>
  );
}
