import { FilterForm } from "@/components/filter-form";
import { Chip, Empty, Json, Panel, TableWrap } from "@/components/ui";
import { SEVERITY_COLORS } from "@/lib/constants";
import { fmtInt, fmtRealTs, fmtUsd } from "@/lib/format";
import { first, href, intParam, type SearchParams } from "@/lib/params";
import { callDetail, distinctValues, listCalls, PAGE_SIZE, type CallFilters } from "@/lib/queries/logs";

const opts = (values: string[], allLabel: string) => [{ value: "", label: allLabel }, ...values.map((v) => ({ value: v, label: v }))];

export async function CallsTab({ sp, runOptions }: { sp: SearchParams; runOptions: { value: string; label: string }[] }) {
  const filters: CallFilters = { run: first(sp, "run"), purpose: first(sp, "purpose"), model: first(sp, "model"), status: first(sp, "status"), month: first(sp, "month") };
  const page = intParam(sp, "page", 0, 0, 100_000);
  const callId = first(sp, "call");
  const [{ rows, total }, purposes, models, statuses, months, detail] = await Promise.all([
    listCalls(filters, page),
    distinctValues("llm_calls", "purpose"),
    distinctValues("llm_calls", "model"),
    distinctValues("llm_calls", "status"),
    distinctValues("llm_calls", "sim_month"),
    callId ? callDetail(callId) : Promise.resolve(null),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-3">
      <Panel>
        <FilterForm
          keep={{ tab: "calls" }}
          fields={[
            { name: "run", label: "Run", value: filters.run ?? "", options: runOptions },
            { name: "purpose", label: "Purpose", value: filters.purpose ?? "", options: opts(purposes, "All") },
            { name: "model", label: "Model", value: filters.model ?? "", options: opts(models, "All") },
            { name: "status", label: "Status", value: filters.status ?? "", options: opts(statuses, "All") },
            { name: "month", label: "Sim month", value: filters.month ?? "", options: opts(months, "All") },
          ]}
        />
      </Panel>
      {callId ? (
        detail ? (
          <Panel title={`Call ${detail.call_id}`} actions={<a className="btn no-underline" style={{ color: "var(--text)" }} href={href("/logs", sp, { call: null })}>Close</a>}>
            <div className="mb-2 flex flex-wrap gap-1">
              <Chip>{fmtRealTs(detail.created_at)}</Chip><Chip>run {detail.run_id ?? "-"}</Chip><Chip>agent {detail.agent_id ?? "-"}</Chip><Chip>sim {detail.sim_month ?? "-"}</Chip>
              <Chip>{detail.model}</Chip><Chip>{detail.purpose}</Chip><Chip color={detail.status === "ok" ? undefined : SEVERITY_COLORS.high}>{detail.status}</Chip><Chip>attempt {detail.attempt}</Chip>
              <Chip>in {fmtInt(detail.input_tokens)} / cached {fmtInt(detail.cached_tokens)} / cache write {fmtInt(detail.cache_write_tokens)} / out {fmtInt(detail.output_tokens)}</Chip>
              <Chip>{fmtUsd(detail.cost_usd, true)}</Chip>
              {detail.batch ? <Chip>batch {detail.batch_id} / {detail.custom_id}</Chip> : null}
              {detail.stop_reason ? <Chip>stop {detail.stop_reason}</Chip> : null}
            </div>
            {detail.error ? <p className="mb-2" style={{ color: "var(--c-sev-high)" }}>{detail.error}</p> : null}
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              <div><h3 className="mb-1 font-semibold">Request</h3><Json text={detail.request} /></div>
              <div><h3 className="mb-1 font-semibold">Response</h3><Json text={detail.response} /></div>
            </div>
          </Panel>
        ) : (
          <Empty>Call {callId} not found.</Empty>
        )
      ) : null}
      <Panel title={`LLM calls (${total})`} actions={<span className="muted">page {page + 1} of {pages}</span>}>
        {rows.length === 0 ? <Empty>No calls match.</Empty> : (
          <TableWrap>
            <table className="tbl">
              <thead>
                <tr><th>Real time (UTC)</th><th>Run</th><th>Sim month</th><th>Model</th><th>Purpose</th><th>Status</th><th className="num">Try</th><th className="num">In</th><th className="num">Cached</th><th className="num">Out</th><th className="num">Cost</th><th>Batch</th></tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.call_id} style={c.call_id === callId ? { background: "var(--panel-2)" } : undefined}>
                    <td><a href={href("/logs", sp, { call: c.call_id })}>{fmtRealTs(c.created_at)}</a></td>
                    <td>{c.run_id ?? "-"}</td><td>{c.sim_month ?? "-"}</td><td>{c.model}</td><td>{c.purpose}</td>
                    <td>{c.status === "ok" ? "ok" : <Chip color={SEVERITY_COLORS.high}>{c.status}</Chip>}</td>
                    <td className="num">{c.attempt}</td><td className="num">{fmtInt(c.input_tokens)}</td><td className="num">{fmtInt(c.cached_tokens)}</td><td className="num">{fmtInt(c.output_tokens)}</td>
                    <td className="num">{fmtUsd(c.cost_usd, true)}</td><td>{c.batch ? "yes" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        <div className="mt-2 flex gap-2">
          {page > 0 ? <a className="btn no-underline" style={{ color: "var(--text)" }} href={href("/logs", sp, { page: page - 1, call: null })}>Previous</a> : null}
          {page + 1 < pages ? <a className="btn no-underline" style={{ color: "var(--text)" }} href={href("/logs", sp, { page: page + 1, call: null })}>Next</a> : null}
        </div>
      </Panel>
    </div>
  );
}
