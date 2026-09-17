import { ChartPanel } from "@/components/chart-panel";
import { TimeSeriesChart } from "@/components/charts/time-series";
import { BANK_LABELS } from "@/lib/constants";
import { conditionColor, kmByCondition, timeToEvent, type CompareRun } from "@/lib/compare";
import { medianSurvival } from "@/lib/stats/km";

export function SurvivalPanel({ title, name, runs, firstMonths }: { title: string; name: string; runs: CompareRun[]; firstMonths: Map<string, string> }) {
  const subjects = timeToEvent(runs, firstMonths);
  const { rows, curves } = kmByCondition(subjects);
  const conditions = [...curves.keys()];
  const series = conditions.map((c, i) => ({ key: c, label: c, color: conditionColor(c, i) }));
  const csv = [
    ...rows.map((r) => ({ kind: "curve", ...r })),
    ...subjects.map((s) => ({ kind: "subject", run_id: s.run_id, condition: s.condition, replicate: s.replicate, bank_id: s.bank_id, month: s.time, event: s.event ? 1 : 0, event_month: s.event_month })),
  ];
  return (
    <ChartPanel title={`${title} (Kaplan-Meier)`} csvRows={csv} csvName={`compare-km-${name}`}>
      <TimeSeriesChart data={rows} xKey="month" series={series} step yDomain={[0, 1]} height={200} xLabel="months since run start" />
      <table className="tbl mt-2">
        <thead><tr><th>Condition</th><th className="num">Runs</th><th className="num">Events</th><th className="num">Median (months)</th></tr></thead>
        <tbody>
          {conditions.map((c) => {
            const subs = subjects.filter((s) => s.condition === c);
            const med = medianSurvival(curves.get(c) ?? []);
            return <tr key={c}><td>{c}</td><td className="num">{subs.length}</td><td className="num">{subs.filter((s) => s.event).length}</td><td className="num">{med ?? "not reached"}</td></tr>;
          })}
        </tbody>
      </table>
      <details className="mt-1">
        <summary className="cursor-pointer">Per run</summary>
        <table className="tbl">
          <thead><tr><th>Run</th><th>Bank</th><th>Condition</th><th className="num">Rep</th><th className="num">Months</th><th>Status</th></tr></thead>
          <tbody>
            {subjects.map((s) => (
              <tr key={s.run_id}><td>{s.run_id}</td><td>{BANK_LABELS[s.bank_id] ?? s.bank_id}</td><td>{s.condition}</td><td className="num">{s.replicate}</td><td className="num">{s.time}</td><td>{s.event ? `event ${s.event_month}` : "censored"}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </ChartPanel>
  );
}
