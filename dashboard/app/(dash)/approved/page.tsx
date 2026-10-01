import Link from "next/link";
import { visibleRuns } from "@/lib/auth/access";
import { first, type SearchParams } from "@/lib/params";
import { currentScope, toolRegister } from "@/lib/queries/product";
import { groupRegister } from "@/lib/register/group";
import { Chip, Help, Icon } from "../reviews/parts";
import { Register } from "./register";

/** What staff may use, may not, and what is still being looked at, kept from signed decisions. Nothing is typed in here. */
export default async function ApprovedPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const scope = await currentScope(first(sp, "run"), await visibleRuns());
  if (!scope) return <div className="rv"><h1 className="rv-org">No committee yet</h1></div>;
  const rows = await toolRegister(scope.run_id);
  const g = groupRegister(rows);
  const run = encodeURIComponent(scope.run_id);
  return (
    <div className="rv">
      <header className="rv-top">
        <div className="flex flex-wrap items-center gap-2.5"><h1 className="rv-org">Approved tools</h1><Chip plain>{scope.name}</Chip><Help><p><strong>Written from signed decisions only.</strong> To change it, submit a matter and have a person sign the outcome.</p></Help></div>
        <Link href={`/reviews?run=${run}&open=submit:tool`} className="rv-btn rv-btn-you"><Icon name="plus" /> Submit a tool</Link>
      </header>
      <div className="rv-tiles">
        <span className="rv-tile" data-tone="ok"><span className="rv-tile-icon"><Icon name="check" /></span><span><span className="rv-tile-count">{g.allowed.length}</span><span className="rv-tile-label">Allowed</span></span></span>
        <span className="rv-tile" data-tone="no"><span className="rv-tile-icon"><Icon name="x" /></span><span><span className="rv-tile-count">{g.notAllowed.length}</span><span className="rv-tile-label">Not allowed</span></span></span>
        <span className="rv-tile" data-tone="wait"><span className="rv-tile-icon"><Icon name="inbox" /></span><span><span className="rv-tile-count">{g.pending.length}</span><span className="rv-tile-label">Being looked at</span></span></span>
      </div>
      <Register rows={rows} run={run} />
    </div>
  );
}
