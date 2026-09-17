import { NoRuns, SelectionHeader } from "@/components/selection-header";
import { BankName, Chip, Empty, Panel, TableWrap } from "@/components/ui";
import { SEVERITY_COLORS } from "@/lib/constants";
import { fmtNum } from "@/lib/format";
import { first, href, type SearchParams } from "@/lib/params";
import { engineDecisionDetail, engineDecisionsFor, unlinkedDraws } from "@/lib/queries/engine";
import { resolveSelection } from "@/lib/queries/runs";
import { DecisionDetail } from "./decision-detail";

export default async function EnginePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const sel = await resolveSelection(sp);
  if (sel.runs.length === 0) return <><SelectionHeader title="Reality engine inspector" sel={sel} /><NoRuns /></>;
  const runIds = sel.runs.map((r) => r.run_id);
  const [decisions, other] = await Promise.all([engineDecisionsFor(runIds), unlinkedDraws(runIds)]);
  const wanted = first(sp, "decision") ?? decisions[0]?.decision_id;
  const detail = wanted ? await engineDecisionDetail(wanted) : null;

  return (
    <>
      <SelectionHeader title="Reality engine inspector" subtitle="Classifier output, estimator ranges, priors, blended distributions, seeded draws, and resulting state changes." sel={sel} />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <Panel title={`Approved decisions (${decisions.length})`}>
            {decisions.length === 0 ? <Empty>No engine decisions.</Empty> : (
              <ul className="flex flex-col gap-1">
                {decisions.map((d) => (
                  <li key={d.decision_id}>
                    <a href={href("/engine", sp, { decision: d.decision_id })} className="block rounded px-1 no-underline" style={{ color: "var(--text)", background: d.decision_id === wanted ? "var(--panel-2)" : undefined }}>
                      <BankName bankId={d.bank_id} /> <span className="muted">{d.sim_month}</span>
                      <div>{d.title} {d.risk_tier ? <Chip color={SEVERITY_COLORS[d.risk_tier]}>{d.risk_tier}</Chip> : null}</div>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Draws not tied to a decision">
            {other.length === 0 ? <Empty>None.</Empty> : (
              <TableWrap>
                <table className="tbl">
                  <thead><tr><th>Month</th><th>Variable</th><th>Dist</th><th className="num">Value</th></tr></thead>
                  <tbody>{other.map((d) => <tr key={d.draw_id} title={`seed ${d.seed} params ${d.params}`}><td>{d.sim_month}</td><td>{d.variable}</td><td>{d.dist}</td><td className="num">{fmtNum(d.value)}</td></tr>)}</tbody>
                </table>
              </TableWrap>
            )}
          </Panel>
        </div>
        <div className="min-w-0">
          {detail ? <DecisionDetail detail={detail} /> : wanted ? <Empty>Decision {wanted} not found.</Empty> : <Empty>Pick a decision.</Empty>}
          {detail && !runIds.includes(detail.decision.run_id) ? <p className="muted mt-2">This decision belongs to run {detail.decision.run_id}, outside the selected replicate.</p> : null}
        </div>
      </div>
    </>
  );
}
