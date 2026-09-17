import { BankTabs, NoRuns, SelectionHeader } from "@/components/selection-header";
import { SEATS } from "@/lib/constants";
import type { SearchParams } from "@/lib/params";
import { metricRows } from "@/lib/queries/metrics";
import { agentsForRun, voteHistory } from "@/lib/queries/people";
import { pickRun, resolveSelection } from "@/lib/queries/runs";
import { SeatPanel, SEAT_METRICS } from "./seat-panel";

export default async function PeoplePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const sel = await resolveSelection(sp);
  const run = pickRun(sel, sp);
  if (!run) return <><SelectionHeader title="People" sel={sel} /><NoRuns /></>;
  const [agents, votes, rows] = await Promise.all([agentsForRun(run.run_id), voteHistory(run.run_id), metricRows([run.run_id], [...SEAT_METRICS])]);

  return (
    <>
      <SelectionHeader title="People" subtitle="One panel per committee seat. Stance: 1 very cautious to 5 very aggressive." sel={sel} />
      <div className="mb-3"><BankTabs path="/people" sp={sp} sel={sel} current={run} /></div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {SEATS.map((seat) => (
          <SeatPanel
            key={seat}
            seat={seat}
            bankId={run.bank_id}
            agents={agents.filter((a) => a.seat === seat)}
            votes={votes.filter((v) => v.seat === seat)}
            rows={rows.filter((r) => r.dimension === seat)}
          />
        ))}
      </div>
    </>
  );
}
