import Link from "next/link";
import { visibleRuns } from "@/lib/auth/access";
import { first, href, type SearchParams } from "@/lib/params";
import { currentScope, organizationRecord } from "@/lib/queries/product";
import { Chip, Help, Icon } from "../reviews/parts";

const KIND_WORDS: Record<string, string> = { signature: "Signatures", review: "Reviews", "use case": "Use cases", people: "People", document: "Documents", policy: "Policy", profile: "Organization", seat: "Committee", panel: "Panels", budget: "Budget", workspace: "Organization", starter: "Setup", questionnaire: "Setup" };

/** Everything anyone changed or signed, newest first, with who, when, and why. Nothing here can be edited. */
export default async function RecordPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const scope = await currentScope(first(sp, "run"), await visibleRuns());
  if (!scope) return <div className="rv"><h1 className="rv-org">No committee yet</h1></div>;
  const all = await organizationRecord(scope.run_id);
  const kind = first(sp, "kind") ?? "";
  const who = first(sp, "who") ?? "";
  const q = (first(sp, "q") ?? "").trim().toLowerCase();
  const kinds = [...new Set(all.map((e) => KIND_WORDS[e.kind] ?? e.kind))].sort();
  const people = [...new Set(all.map((e) => e.who))].sort();
  const rows = all.filter((e) => (!kind || (KIND_WORDS[e.kind] ?? e.kind) === kind) && (!who || e.who === who) && (!q || `${e.title} ${e.body ?? ""}`.toLowerCase().includes(q)));
  const to = (o: Record<string, string | null>) => href("/record", sp, o);

  return (
    <div className="rv">
      <header className="rv-top">
        <div className="flex flex-wrap items-center gap-2.5"><h1 className="rv-org">Record</h1><Chip plain>{scope.name}</Chip><Help><p><strong>Everything anyone changed or signed.</strong> Who, when, what, and why. Nothing here can be edited or removed; open any line for the full thing.</p></Help></div>
      </header>

      <form className="rv-card rv-filters" method="get">
        <input type="hidden" name="run" value={scope.run_id} />
        <input className="rv-field" name="q" defaultValue={q} placeholder="Search the record" aria-label="Search" />
        <select className="rv-field" name="kind" defaultValue={kind} aria-label="Kind"><option value="">Everything</option>{kinds.map((k) => <option key={k} value={k}>{k}</option>)}</select>
        <select className="rv-field" name="who" defaultValue={who} aria-label="Person"><option value="">Anyone</option>{people.map((p) => <option key={p} value={p}>{p}</option>)}</select>
        <button className="rv-btn" type="submit">Filter</button>
        {kind || who || q ? <Link href={to({ kind: null, who: null, q: null })} className="rv-btn rv-btn-sm">Clear</Link> : null}
      </form>

      <section className="rv-board">
        <nav className="rv-tabs" aria-label="Record"><span className="rv-tab" aria-current="page">{rows.length === all.length ? "Everything" : "Matching"}<span className="rv-tab-count">{rows.length}</span></span></nav>
        {rows.length === 0 ? <div className="rv-empty"><span className="muted">Nothing on the record matches.</span></div> : (
          <ol className="rv-story is-record">
            {rows.map((e, i) => (
              <li key={i} className="rv-story-row" data-tone={e.tone ?? undefined}>
                <span className="rv-story-mark"><Icon name={e.kind === "signature" ? "pen" : e.kind === "review" ? "users" : e.kind === "use case" ? "check" : "flag"} /></span>
                <div className="rv-story-body">
                  <div className="rv-story-head"><span className="rv-story-title">{e.title}</span><span className="rv-story-meta">{e.who}, {e.at.slice(0, 16).replace("T", " ")}</span></div>
                  {e.body ? <p className="rv-prose rv-story-text">{e.body}</p> : null}
                  {e.href ? <Link href={e.href} className="rv-story-link">Open <Icon name="chevron" className="rv-chev" /></Link> : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
