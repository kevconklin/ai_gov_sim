import Link from "next/link";
import { organizations } from "@/lib/queries/product";
import { FRAMEWORK_LABELS, plural } from "@/lib/reviews/model";
import { Chip, Icon } from "../reviews/parts";

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const KIT_LABELS: Record<string, string> = { general_business: "General business", regulated: "Regulated", software: "Software and SaaS" };

function since(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : days < 30 ? `${days} days ago` : days < 365 ? `${Math.floor(days / 30)} months ago` : `${Math.floor(days / 365)} years ago`;
}

/** Every organization with a committee, and what each needs from a person right now. */
export default async function OrganizationsPage() {
  const month = new Date().toISOString().slice(0, 7);
  const rows = await organizations(month);
  const active = rows.filter((r) => r.status !== "archived");
  const archived = rows.filter((r) => r.status === "archived");
  const needing = active.filter((r) => r.needs_you > 0).length;
  const totals = active.reduce((t, r) => ({ waiting: t.waiting + r.waiting, needs: t.needs + r.needs_you, gaps: t.gaps + r.gaps, spend: t.spend + r.spend_month }), { waiting: 0, needs: 0, gaps: 0, spend: 0 });

  const row = (r: (typeof rows)[number]) => {
    const run = encodeURIComponent(r.run_id);
    const overCap = r.cap !== null && r.spend_month >= r.cap;
    const attention = r.needs_you > 0 ? "you" : r.waiting > 0 || r.gaps > 0 ? "wait" : "ok";
    return (
      <Link key={r.run_id} href={`/reviews?run=${run}`} className="rv-rowline">
        <span className="rv-riskmark" data-tone={r.status === "archived" ? undefined : attention} />
        <span className="min-w-0">
          <span className="rv-rowtitle">{r.name}</span>
          <span className="rv-rowmeta">
            {r.status === "archived" ? <Chip tone="wait">Archived</Chip> : null}
            {r.starter ? <Chip plain>{KIT_LABELS[r.starter] ?? r.starter}</Chip> : <Chip plain>Blank start</Chip>}
            <Chip plain>{FRAMEWORK_LABELS[r.framework ?? "none"] ?? r.framework}</Chip>
            <Chip plain>{plural(r.seats, "seat")}</Chip>
            {r.controls ? <Chip plain>{plural(r.controls, "control")}</Chip> : null}
            <Chip plain>Set up {since(r.started_at)}</Chip>
          </span>
        </span>
        <span className="rv-rowend rv-orgstats">
          {r.needs_you ? <Chip tone="you" solid>{plural(r.needs_you, "decision")} to sign</Chip> : null}
          {r.waiting ? <Chip tone="wait" dot>{r.waiting} waiting</Chip> : null}
          {r.gaps ? <Chip tone="wait">{plural(r.gaps, "gap")}</Chip> : null}
          <span className="is-wide muted text-xs">{r.reviews ? `${plural(r.reviews, "review")}, last ${r.last_review}` : "No review yet"}</span>
          <span className="is-wide muted text-xs">{plural(r.signed, "signed decision")}</span>
          <span className={`is-wide text-xs ${overCap ? "font-semibold" : "muted"}`} style={overCap ? { color: "var(--no)" } : undefined}>{usd(r.spend_month)}{r.cap !== null ? ` of ${usd(r.cap)}` : ""}</span>
          <Icon name="chevron" className="rv-chev" />
        </span>
      </Link>
    );
  };

  return (
    <div className="rv">
      <header className="rv-top">
        <div className="flex flex-wrap items-center gap-2.5"><h1 className="rv-org">Organizations</h1><Chip plain>{active.length} active</Chip></div>
        <Link href="/reviews?open=customer" className="rv-btn rv-btn-you"><Icon name="plus" /> New organization</Link>
      </header>

      <div className="rv-tiles">
        <span className={`rv-tile${needing ? " is-hot" : ""}`} data-tone="you"><span className="rv-tile-icon"><Icon name="pen" /></span><span><span className="rv-tile-count">{totals.needs}</span><span className="rv-tile-label">{totals.needs === 1 ? "Decision to sign" : "Decisions to sign"}{needing ? ` across ${plural(needing, "organization")}` : ""}</span></span></span>
        <span className="rv-tile" data-tone="wait"><span className="rv-tile-icon"><Icon name="inbox" /></span><span><span className="rv-tile-count">{totals.waiting}</span><span className="rv-tile-label">Matters waiting for review</span></span></span>
        <span className="rv-tile" data-tone="ai"><span className="rv-tile-icon"><Icon name="chat" /></span><span><span className="rv-tile-count">{totals.gaps}</span><span className="rv-tile-label">Policy gaps the committees have not heard</span></span></span>
        <span className="rv-tile" data-tone="ok"><span className="rv-tile-icon"><Icon name="flag" /></span><span><span className="rv-tile-count">{usd(totals.spend)}</span><span className="rv-tile-label">Spent this month, all organizations</span></span></span>
      </div>

      <section className="rv-board">
        <nav className="rv-tabs" aria-label="Organizations"><span className="rv-tab" aria-current="page">Active<span className="rv-tab-count">{active.length}</span></span></nav>
        {active.length === 0 ? (
          <div className="rv-empty"><span className="rv-empty-icon" data-tone="you"><Icon name="users" /></span><span>No organization yet. <Link href="/reviews?open=customer">Set one up</Link> in about five minutes.</span></div>
        ) : <div className="rv-rows">{active.map(row)}</div>}
      </section>

      {archived.length ? (
        <section className="rv-board">
          <nav className="rv-tabs" aria-label="Archived"><span className="rv-tab" aria-current="page">Archived<span className="rv-tab-count">{archived.length}</span></span></nav>
          <div className="rv-rows">{archived.map(row)}</div>
        </section>
      ) : null}
    </div>
  );
}
