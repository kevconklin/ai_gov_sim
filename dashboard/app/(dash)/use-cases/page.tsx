import { BankTabs, NoRuns, SelectionHeader } from "@/components/selection-header";
import { BankName, Chip, Empty, Panel, TableWrap } from "@/components/ui";
import { SEAT_LABELS, SEVERITY_COLORS, USE_CASE_STATUSES } from "@/lib/constants";
import { first, href, type SearchParams } from "@/lib/params";
import { useCasesFor } from "@/lib/queries/use-cases";
import { pickRun, resolveSelection } from "@/lib/queries/runs";
import { UseCaseDetail } from "./detail";

export default async function UseCasesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const sel = await resolveSelection(sp);
  const run = pickRun(sel, sp);
  if (!run) return <><SelectionHeader title="Use cases" sel={sel} /><NoRuns /></>;

  const all = await useCasesFor(sel.runs.map((r) => r.run_id));
  const mine = all.filter((u) => u.run_id === run.run_id);
  const selected = mine.find((u) => u.use_case_id === first(sp, "uc"));

  return (
    <>
      <SelectionHeader title="Use cases" subtitle="Portfolio board by status. Months are sim months." sel={sel} />
      <Panel title="Status counts" className="mb-3">
        <TableWrap>
          <table className="tbl">
            <thead><tr><th>Bank</th>{USE_CASE_STATUSES.map((s) => <th key={s} className="num">{s}</th>)}<th className="num">total</th></tr></thead>
            <tbody>
              {sel.runs.map((r) => {
                const rows = all.filter((u) => u.run_id === r.run_id);
                return (
                  <tr key={r.run_id}>
                    <td><BankName bankId={r.bank_id} condition={r.condition} /></td>
                    {USE_CASE_STATUSES.map((s) => <td key={s} className="num">{rows.filter((u) => u.status === s).length}</td>)}
                    <td className="num">{rows.length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      </Panel>
      <div className="mb-3"><BankTabs path="/use-cases" sp={sp} sel={sel} current={run} reset={["uc"]} /></div>
      {selected ? <UseCaseDetail useCase={selected} closeHref={href("/use-cases", sp, { uc: null })} /> : null}
      <div className="overflow-x-auto">
        <div className="grid min-w-[980px] grid-cols-7 gap-2">
          {USE_CASE_STATUSES.map((status) => {
            const cards = mine.filter((u) => u.status === status);
            return (
              <div key={status} className="panel p-2" style={{ background: "var(--panel-2)" }}>
                <div className="mb-2 flex justify-between font-semibold"><span>{status}</span><span className="muted">{cards.length}</span></div>
                <div className="flex flex-col gap-2">
                  {cards.length === 0 ? <Empty>None</Empty> : null}
                  {cards.map((u) => (
                    <a key={u.use_case_id} href={href("/use-cases", sp, { uc: u.use_case_id })} className="panel block p-2 no-underline" style={{ color: "var(--text)", borderColor: u.use_case_id === selected?.use_case_id ? "var(--accent)" : undefined }}>
                      <div className="font-medium">{u.title}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {u.risk_tier ? <Chip color={SEVERITY_COLORS[u.risk_tier]}>{u.risk_tier}</Chip> : <Chip>unclassified</Chip>}
                        {u.lob ? <Chip>{u.lob}</Chip> : null}
                      </div>
                      <div className="muted mt-1 text-xs">
                        proposed {u.proposed_month}
                        {u.decided_month ? ` · decided ${u.decided_month}` : ""}
                        {u.live_month ? ` · live ${u.live_month}` : ""}
                        {u.retired_month ? ` · retired ${u.retired_month}` : ""}
                      </div>
                      {u.proposer_name ? <div className="muted text-xs">by {u.proposer_name}, {SEAT_LABELS[u.proposer_seat ?? ""] ?? u.proposer_seat}</div> : null}
                    </a>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
