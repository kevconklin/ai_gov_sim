import { Chip, Empty, Json, Panel } from "@/components/ui";
import { SEAT_LABELS } from "@/lib/constants";
import { parseJson } from "@/lib/db/values";
import type { UseCaseRow } from "@/lib/queries/use-cases";
import { useCaseDetail } from "@/lib/queries/use-cases";

export async function UseCaseDetail({ useCase, closeHref }: { useCase: UseCaseRow; closeHref: string }) {
  const d = await useCaseDetail(useCase.use_case_id);
  return (
    <Panel title={useCase.title} actions={<a className="btn no-underline" href={closeHref} style={{ color: "var(--text)" }}>Close</a>} className="mb-3">
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <div>
          <h3 className="mb-1 font-semibold">Proposal</h3>
          <p className="mb-2">{useCase.description}</p>
          <Json value={parseJson(useCase.details, {})} />
          <h3 className="mb-1 mt-2 font-semibold">Status history</h3>
          <table className="tbl">
            <thead><tr><th>Sim month</th><th>From</th><th>To</th><th>Source</th></tr></thead>
            <tbody>{d.history.map((h) => <tr key={h.history_id}><td>{h.sim_month}</td><td>{h.from_status ?? "-"}</td><td>{h.to_status}</td><td>{h.source}</td></tr>)}</tbody>
          </table>
        </div>
        <div>
          <h3 className="mb-1 font-semibold">Decisions and votes</h3>
          {d.decisions.length === 0 ? <Empty>Not decided yet.</Empty> : null}
          {d.decisions.map((dec) => (
            <div key={dec.decision_id} className="mb-2">
              <div className="mb-1">{dec.sim_month} · {dec.kind} · <Chip>{dec.outcome}</Chip> {dec.yes_votes}-{dec.no_votes}-{dec.abstentions}</div>
              <table className="tbl">
                <tbody>
                  {d.votes.filter((v) => v.decision_id === dec.decision_id).map((v) => (
                    <tr key={`${v.name}${v.seat}`}><td>{v.name} <span className="muted">{SEAT_LABELS[v.seat] ?? v.seat}</span></td><td>{v.vote}</td><td className="muted">{v.rationale}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {d.changes.map((c) => <div key={c.change_id} className="muted">{c.sim_month}: proposed {c.new_status} ({c.status}) {c.rationale}</div>)}
        </div>
        <div>
          <h3 className="mb-1 font-semibold">Engine estimates and plan</h3>
          {d.engine.length === 0 ? <Empty>No engine record (not approved).</Empty> : null}
          {d.engine.map((e) => (
            <div key={e.decision_id}>
              <a href={`/engine?decision=${encodeURIComponent(e.decision_id)}`}>Open in reality engine inspector</a>
              <Json text={e.estimates} />
              <div className="mt-1 font-semibold">Plan (outcomes)</div>
              <Json text={e.plan} />
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}
