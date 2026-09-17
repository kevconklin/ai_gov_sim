import { ChartPanel } from "@/components/chart-panel";
import { BankName, Chip, Json, Panel, TableWrap } from "@/components/ui";
import { parseJson } from "@/lib/db/values";
import { fmtNum } from "@/lib/format";
import { rangeRows, stateDelta } from "@/lib/json-flatten";
import type { engineDecisionDetail } from "@/lib/queries/engine";

type Detail = NonNullable<Awaited<ReturnType<typeof engineDecisionDetail>>>;

function RangeTable({ value }: { value: unknown }) {
  const { ranges, scalars } = rangeRows(value);
  return (
    <TableWrap>
      <table className="tbl">
        <thead><tr><th>Quantity</th><th className="num">Low</th><th className="num">Mode</th><th className="num">High</th><th>Other</th></tr></thead>
        <tbody>
          {ranges.map((r) => <tr key={r.path}><td>{r.path}</td><td className="num">{fmtNum(r.low)}</td><td className="num">{fmtNum(r.mode)}</td><td className="num">{fmtNum(r.high)}</td><td className="muted">{r.extra}</td></tr>)}
          {scalars.map(([k, v]) => <tr key={k}><td>{k}</td><td colSpan={3} className="num">{v}</td><td /></tr>)}
        </tbody>
      </table>
    </TableWrap>
  );
}

export function DecisionDetail({ detail }: { detail: Detail }) {
  const { decision, draws, useCase, history } = detail;
  const delta = stateDelta(parseJson(detail.before, {}), parseJson(detail.after, {}));
  const drawCsv = draws.map((d) => ({ draw_id: d.draw_id, sim_month: d.sim_month, variable: d.variable, dist: d.dist, params: d.params, seed: d.seed, value: d.value }));
  return (
    <div className="flex flex-col gap-3">
      <Panel title={<span>{useCase?.title ?? decision.use_case_id} {useCase ? <BankName bankId={useCase.bank_id} /> : null}</span>} actions={<><Chip>{decision.sim_month}</Chip>{useCase ? <Chip>{useCase.status}</Chip> : null}</>}>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div><h3 className="mb-1 font-semibold">Classifier output</h3><Json text={decision.classification} /></div>
          <div><h3 className="mb-1 font-semibold">Priors (engine_params.yaml)</h3><Json text={decision.priors} /></div>
        </div>
      </Panel>
      <Panel title="Estimator ranges (five estimators)"><RangeTable value={parseJson(decision.estimates, {})} /></Panel>
      <Panel title="Blended distributions"><RangeTable value={parseJson(decision.blended, {})} /></Panel>
      <ChartPanel title={`Seeded draws (${draws.length})`} csvRows={drawCsv} csvName={`engine-draws-${decision.decision_id}`}>
        <TableWrap>
          <table className="tbl">
            <thead><tr><th>Variable</th><th>Dist</th><th>Params</th><th className="num">Seed</th><th className="num">Value</th></tr></thead>
            <tbody>{draws.map((d) => <tr key={d.draw_id}><td>{d.variable}</td><td>{d.dist}</td><td className="muted">{d.params}</td><td className="num">{d.seed}</td><td className="num">{fmtNum(d.value)}</td></tr>)}</tbody>
          </table>
        </TableWrap>
      </ChartPanel>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel title="Plan and use-case status changes">
          <Json text={decision.plan} />
          <table className="tbl mt-2">
            <thead><tr><th>Sim month</th><th>From</th><th>To</th><th>Source</th></tr></thead>
            <tbody>{history.map((h) => <tr key={h.history_id}><td>{h.sim_month}</td><td>{h.from_status ?? "-"}</td><td>{h.to_status}</td><td>{h.source}</td></tr>)}</tbody>
          </table>
        </Panel>
        <Panel title="Company state change (previous month → decision month)">
          {delta.length === 0 ? <p className="muted">No state rows for these months.</p> : (
            <TableWrap>
              <table className="tbl">
                <thead><tr><th>Field</th><th className="num">Before</th><th className="num">After</th></tr></thead>
                <tbody>{delta.map((d) => <tr key={d.path}><td>{d.path}</td><td className="num">{String(d.before ?? "-")}</td><td className="num">{String(d.after ?? "-")}</td></tr>)}</tbody>
              </table>
            </TableWrap>
          )}
        </Panel>
      </div>
    </div>
  );
}
