import { FilterForm } from "@/components/filter-form";
import { BankName, Chip, Empty, Json, Panel, TableWrap } from "@/components/ui";
import { SEVERITY_COLORS } from "@/lib/constants";
import { first, href, intParam, type SearchParams } from "@/lib/params";
import { eventsFor } from "@/lib/queries/events";
import { distinctValues } from "@/lib/queries/logs";
import { listAllRuns } from "@/lib/queries/runs";

const PAGE = 100;

export async function EventsTab({ sp, runOptions }: { sp: SearchParams; runOptions: { value: string; label: string }[] }) {
  const run = first(sp, "run");
  const type = first(sp, "type");
  const month = first(sp, "month");
  const page = intParam(sp, "page", 0, 0, 100_000);
  const [runs, types, months] = await Promise.all([listAllRuns(), distinctValues("events", "type"), distinctValues("events", "sim_month")]);
  const runIds = run ? runs.filter((r) => r.run_id === run).map((r) => r.run_id) : runs.map((r) => r.run_id);
  const events = await eventsFor(runIds, { type, month, limit: PAGE + 1, offset: page * PAGE });
  const shown = events.slice(0, PAGE);

  return (
    <div className="flex flex-col gap-3">
      <Panel>
        <FilterForm
          keep={{ tab: "events" }}
          fields={[
            { name: "run", label: "Run", value: run ?? "", options: runOptions },
            { name: "type", label: "Type", value: type ?? "", options: [{ value: "", label: "All" }, ...types.map((t) => ({ value: t, label: t }))] },
            { name: "month", label: "Sim month", value: month ?? "", options: [{ value: "", label: "All" }, ...months.map((m) => ({ value: m, label: m }))] },
          ]}
        />
      </Panel>
      <Panel title={`Events (page ${page + 1})`}>
        {shown.length === 0 ? <Empty>No events match.</Empty> : (
          <TableWrap>
            <table className="tbl">
              <thead><tr><th>Sim month</th><th>Run</th><th>Bank</th><th>Type</th><th>Severity</th><th>Source</th><th>Payload</th></tr></thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.event_id}>
                    <td>{e.sim_month}</td><td>{e.run_id}</td><td><BankName bankId={e.bank_id} /></td><td>{e.type}</td>
                    <td>{e.severity ? <Chip color={SEVERITY_COLORS[e.severity]}>{e.severity}</Chip> : "-"}</td><td>{e.source}</td>
                    <td className="w-1/2"><details><summary className="cursor-pointer">{e.event_id}</summary><Json text={e.payload} /></details></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        <div className="mt-2 flex gap-2">
          {page > 0 ? <a className="btn no-underline" style={{ color: "var(--text)" }} href={href("/logs", sp, { page: page - 1 })}>Previous</a> : null}
          {events.length > PAGE ? <a className="btn no-underline" style={{ color: "var(--text)" }} href={href("/logs", sp, { page: page + 1 })}>Next</a> : null}
        </div>
      </Panel>
    </div>
  );
}
