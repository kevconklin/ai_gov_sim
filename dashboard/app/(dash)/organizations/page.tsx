import Link from "next/link";
import { isOperator, visibleRuns } from "@/lib/auth/access";
import { openAlerts, organizations, queueWait } from "@/lib/queries/product";
import { Acknowledge } from "./alerts";
import { allUsers } from "@/lib/auth/users";
import { currentUser } from "@/lib/auth/session";
import { AccountAdmin, InviteOperatorForm } from "../reviews/people-forms";
import { FRAMEWORK_LABELS, plural } from "@/lib/reviews/model";
import { Chip, Help, Icon } from "../reviews/parts";

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const KIT_LABELS: Record<string, string> = { general_business: "General business", regulated: "Regulated", software: "Software and SaaS" };

function since(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : days < 30 ? `${days} days ago` : days < 365 ? `${Math.floor(days / 30)} months ago` : `${Math.floor(days / 365)} years ago`;
}

/** Every organization with a committee, and what each needs from a person right now. */
export default async function OrganizationsPage() {
  const month = new Date().toISOString().slice(0, 7);
  const allowed = await visibleRuns();
  const [rows, operator, alerts, wait] = await Promise.all([organizations(month, allowed), isOperator(), openAlerts(allowed), queueWait()]);
  const workerDown = wait && wait.minutes >= 5;
  const [accounts, me] = operator ? await Promise.all([allUsers(), currentUser()]) : [[], null];
  const ops = accounts.filter((a) => a.role === "operator" && !a.disabled_at);
  const active = rows.filter((r) => r.status !== "archived");
  const archived = rows.filter((r) => r.status === "archived");
  const needing = active.filter((r) => r.needs_you > 0).length;
  const totals = active.reduce((t, r) => ({ waiting: t.waiting + r.waiting, needs: t.needs + r.needs_you, gaps: t.gaps + r.gaps, spend: t.spend + r.spend_month }), { waiting: 0, needs: 0, gaps: 0, spend: 0 });

  const table = (list: typeof rows) => (
    <div className="rv-table-wrap">
      <table className="rv-table">
        <thead><tr><th>Organization</th><th>Needs attention</th><th>Framework</th><th>Last review</th><th className="num">Signed</th><th className="num">Spend this month</th><th /></tr></thead>
        <tbody>
          {list.map((r) => {
            const run = encodeURIComponent(r.run_id);
            const overCap = r.cap !== null && r.spend_month >= r.cap;
            return (
              <tr key={r.run_id}>
                <td><Link href={`/reviews?run=${run}`} className="rv-cell">{r.name}</Link><span className="rv-sub">{r.starter ? KIT_LABELS[r.starter] ?? r.starter : "Blank start"}, {plural(r.seats, "seat")}{r.controls ? `, ${plural(r.controls, "control")}` : ""}, set up {since(r.started_at)}</span></td>
                <td>{r.status === "archived" ? <Chip tone="wait">Archived</Chip> : r.needs_you ? <Chip tone="you" solid>{plural(r.needs_you, "decision")} to sign</Chip> : r.waiting ? <Chip tone="wait" dot>{r.waiting} waiting</Chip> : r.gaps ? <Chip tone="wait">{plural(r.gaps, "gap")}</Chip> : <Chip tone="ok" dot>Nothing waiting</Chip>}</td>
                <td className="muted">{FRAMEWORK_LABELS[r.framework ?? "none"] ?? r.framework}</td>
                <td className="muted">{r.reviews ? `${r.last_review} (${plural(r.reviews, "review")})` : "None yet"}</td>
                <td className="num">{r.signed}</td>
                <td className="num" style={overCap ? { color: "var(--no)", fontWeight: 600 } : undefined}>{usd(r.spend_month)}{r.cap !== null ? <span className="muted"> / {usd(r.cap)}</span> : null}</td>
                <td><Link href={`/reviews?run=${run}`} aria-label={`Open ${r.name}`}><Icon name="chevron" className="rv-chev" /></Link></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="rv">
      <header className="rv-top">
        <div className="flex flex-wrap items-center gap-2.5"><h1 className="rv-org">Organizations</h1><Chip plain>{active.length} active</Chip></div>
        {operator ? <Link href="/reviews?open=customer" className="rv-btn rv-btn-you"><Icon name="plus" /> New organization</Link> : null}
      </header>

      {workerDown ? (
        <div className="rv-banner" data-tone="no"><Icon name="alert" /><span className="flex-1">Nothing has picked up work for {wait.minutes} minutes (a {wait.kind.replace(/_/g, " ")} is waiting). The worker is not running. <code>scripts/run-local.sh status</code></span></div>
      ) : null}
      {alerts.map((a) => (
        <div key={a.alert_id} className="rv-banner" data-tone={a.severity === "critical" ? "no" : "wait"}>
          <Icon name="alert" /><span className="flex-1">{a.org_name ? <strong>{a.org_name}: </strong> : null}{a.message}<span className="muted text-xs"> {a.created_at.slice(0, 16).replace("T", " ")}</span></span>
          {operator ? <Acknowledge alertId={a.alert_id} /> : null}
        </div>
      ))}

      <div className="rv-tiles">
        <span className={`rv-tile${needing ? " is-hot" : ""}`} data-tone="you"><span className="rv-tile-icon"><Icon name="pen" /></span><span><span className="rv-tile-count">{totals.needs}</span><span className="rv-tile-label">{totals.needs === 1 ? "Decision to sign" : "Decisions to sign"}</span></span></span>
        <span className="rv-tile" data-tone="wait"><span className="rv-tile-icon"><Icon name="inbox" /></span><span><span className="rv-tile-count">{totals.waiting}</span><span className="rv-tile-label">Waiting for review</span></span></span>
        <span className="rv-tile" data-tone="ai"><span className="rv-tile-icon"><Icon name="chat" /></span><span><span className="rv-tile-count">{totals.gaps}</span><span className="rv-tile-label">Policy gaps</span></span></span>
        <span className="rv-tile" data-tone="ok"><span className="rv-tile-icon"><Icon name="flag" /></span><span><span className="rv-tile-count">{usd(totals.spend)}</span><span className="rv-tile-label">Spent this month</span></span></span>
      </div>

      <section className="rv-board">
        <nav className="rv-tabs" aria-label="Organizations"><span className="rv-tab" aria-current="page">Active<span className="rv-tab-count">{active.length}</span></span><span className="rv-lead"><Help right><p><strong>One row per organization.</strong> Blue means a decision is waiting for your signature; amber means matters are waiting or the policy could not answer a question. Open a row for its Reviews page.</p></Help></span></nav>
        {active.length === 0 ? (
          <div className="rv-empty"><span className="rv-empty-icon" data-tone="you"><Icon name="users" /></span><span>{operator ? <>No organization yet. <Link href="/reviews?open=customer">Set one up</Link> in about five minutes.</> : "You are not a member of any organization yet. Ask the person who runs governance to add you."}</span></div>
        ) : table(active)}
      </section>

      {operator ? (
        <details className="rv-board rv-fold-board">
          <summary className="rv-tabs" aria-label="Accounts"><span className="rv-tab" aria-current="page">Accounts<span className="rv-tab-count">{accounts.length}</span></span><span className="rv-lead muted text-xs">{ops.length === 1 ? "1 operator" : `${ops.length} operators`}</span></summary>
          <div className="rv-rows">
            {accounts.map((a) => (
              <div key={a.user_id} className="rv-rowline" style={{ cursor: "default", alignItems: "flex-start" }}>
                <span className="rv-riskmark" data-tone={a.disabled_at ? "no" : a.role === "operator" ? "ai" : "ok"} />
                <span className="min-w-0">
                  <span className="rv-rowtitle">{a.name}</span>
                  <span className="rv-rowmeta">{a.disabled_at ? <Chip tone="no" dot>Disabled</Chip> : a.must_change ? <Chip tone="wait">Temporary password</Chip> : a.role === "operator" ? <Chip tone="ai">Operator</Chip> : <Chip plain>Member</Chip>}<span className="muted text-xs">{a.email}</span></span>
                </span>
                <span className="rv-rowend"><AccountAdmin userId={a.user_id} name={a.name} disabled={Boolean(a.disabled_at)} isSelf={a.user_id === me?.user_id} /></span>
              </div>
            ))}
          </div>
          <details className="rv-fold" style={{ margin: "0.75rem" }}>
            <summary className="rv-fold-head"><span>Add an operator</span></summary>
            <div className="rv-fold-body"><InviteOperatorForm /></div>
          </details>
        </details>
      ) : null}

      {archived.length ? (
        <section className="rv-board">
          <nav className="rv-tabs" aria-label="Archived"><span className="rv-tab" aria-current="page">Archived<span className="rv-tab-count">{archived.length}</span></span></nav>
          {table(archived)}
        </section>
      ) : null}
    </div>
  );
}
