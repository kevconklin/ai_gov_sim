import { ChartPanel } from "@/components/chart-panel";
import { TimeSeriesChart, type ChartRow } from "@/components/charts/time-series";
import { FilterForm } from "@/components/filter-form";
import { PolicyDiff } from "@/components/policy-diff";
import { BankTabs, NoRuns, SelectionHeader } from "@/components/selection-header";
import { Chip, Empty, Panel, TabLinks } from "@/components/ui";
import { BANK_COLORS, BANK_LABELS } from "@/lib/constants";
import { first, href, type SearchParams } from "@/lib/params";
import { controlDelta, splitControls } from "@/lib/policy-text";
import { policyText, policyVersions, type PolicyVersionMeta } from "@/lib/queries/policy";
import { pickRun, resolveSelection, type RunRow } from "@/lib/queries/runs";

function overlay(versions: PolicyVersionMeta[], runs: RunRow[], field: "word_count" | "control_count"): ChartRow[] {
  const byMonth = new Map<string, ChartRow>();
  for (const v of versions) {
    if (!runs.some((r) => r.run_id === v.run_id)) continue;
    const row = byMonth.get(v.sim_month) ?? { sim_month: v.sim_month };
    row[v.bank_id] = v[field];
    byMonth.set(v.sim_month, row);
  }
  return [...byMonth.values()].sort((a, b) => String(a.sim_month).localeCompare(String(b.sim_month)));
}

export default async function PolicyPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const sel = await resolveSelection(sp);
  const run = pickRun(sel, sp);
  if (!run) return <><SelectionHeader title="Policy" sel={sel} /><NoRuns /></>;

  const versions = await policyVersions(sel.runs.map((r) => r.run_id));
  const mine = versions.filter((v) => v.run_id === run.run_id);
  const current = mine.find((v) => v.sim_month === first(sp, "month")) ?? mine.at(-1);
  const idx = current ? mine.indexOf(current) : -1;
  const base = mine.find((v) => v.sim_month === first(sp, "from")) ?? (idx > 0 ? mine[idx - 1] : undefined);
  const mode = first(sp, "diff") === "words" ? "words" : "lines";
  const [text, baseText] = await Promise.all([
    current ? policyText(run.run_id, current.sim_month) : null,
    base ? policyText(run.run_id, base.sim_month) : null,
  ]);
  const series = sel.runs.map((r) => ({ key: r.bank_id, label: BANK_LABELS[r.bank_id] ?? r.bank_id, color: BANK_COLORS[r.bank_id] ?? "var(--muted)" }));
  const words = overlay(versions, sel.runs, "word_count");
  const controls = overlay(versions, sel.runs, "control_count");
  const delta = current && base ? controlDelta(base.controls, current.controls) : null;

  return (
    <>
      <SelectionHeader title="Policy" subtitle="Policy text as committed at the end of each sim month." sel={sel} />
      <div className="mb-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
        <ChartPanel title="Policy word count" csvRows={words} csvName="policy-word-count"><TimeSeriesChart data={words} xKey="sim_month" series={series} height={180} /></ChartPanel>
        <ChartPanel title="Numbered controls" csvRows={controls} csvName="policy-control-count"><TimeSeriesChart data={controls} xKey="sim_month" series={series} height={180} /></ChartPanel>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <BankTabs path="/policy" sp={sp} sel={sel} current={run} reset={["month", "from"]} />
        <TabLinks items={mine.map((v) => ({ href: href("/policy", sp, { month: v.sim_month, from: null }), label: v.sim_month, active: v.sim_month === current?.sim_month }))} />
      </div>
      {!current || text === null ? (
        <Empty>No policy versions for this run yet.</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <Panel title={`Policy as of ${current.sim_month}`} actions={<><Chip>{current.control_count} controls</Chip><Chip>{current.word_count} words</Chip><Chip>grade {current.readability ?? "-"}</Chip></>}>
            <div className="muted mb-2 text-xs">git {current.git_sha.slice(0, 10)}</div>
            <pre className="code">
              {splitControls(text).map((p, i) => (p.control ? <span key={i} className="ctrl-id">{p.text}</span> : <span key={i}>{p.text}</span>))}
            </pre>
          </Panel>
          <Panel
            title={base ? `Diff ${base.sim_month} → ${current.sim_month}` : "Diff"}
            actions={
              <FilterForm
                keep={{ exp: sel.experimentId ?? undefined, rep: String(sel.replicate ?? ""), bank: run.bank_id, month: current.sim_month }}
                fields={[
                  { name: "from", label: "From", value: base?.sim_month ?? "", options: mine.filter((v) => v.sim_month < current.sim_month).map((v) => ({ value: v.sim_month, label: v.sim_month })) },
                  { name: "diff", label: "Mode", value: mode, options: [{ value: "lines", label: "Lines" }, { value: "words", label: "Words" }] },
                ]}
              />
            }
          >
            {delta ? (
              <div className="mb-2 flex flex-wrap gap-1">
                {delta.added.map((c) => <Chip key={`a${c}`} color="var(--c-sev-low)">+ {c}</Chip>)}
                {delta.removed.map((c) => <Chip key={`r${c}`} color="var(--c-sev-high)">- {c}</Chip>)}
                {delta.added.length + delta.removed.length === 0 ? <span className="muted">No control ids added or removed.</span> : null}
              </div>
            ) : null}
            {base && baseText !== null ? <PolicyDiff before={baseText} after={text} mode={mode} /> : <Empty>First version: nothing to compare.</Empty>}
          </Panel>
        </div>
      )}
    </>
  );
}
