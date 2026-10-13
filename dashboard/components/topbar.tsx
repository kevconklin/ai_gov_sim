"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { initials } from "@/lib/reviews/model";

export interface SwitchOption { run_id: string; label: string; group: "Organizations" | "Archived" | "Simulated runs" }

/** The bar every page shares: which organization you are looking at, a search of its record, and you. */
export function TopBar({ options, operator }: { options: SwitchOption[]; operator: string | null }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const router = useRouter();
  const current = sp.get("run") ?? options[0]?.run_id ?? "";
  const groups = ["Organizations", "Archived", "Simulated runs"] as const;
  // pages that are about one organization keep it when it changes; the rest go to Reviews
  const perOrg = ["/reviews", "/portfolio", "/committee", "/record", "/ask", "/approved", "/policy-record", "/spend", "/decide", "/matter"];
  const target = perOrg.some((p) => pathname === p || pathname.startsWith(`${p}/`)) && pathname !== "/decide" && pathname !== "/matter" ? pathname : "/reviews";
  return (
    <div className="topbar">
      {options.length ? (
        <label className="topbar-switch" title="Switch organization">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3" y="4" width="8" height="16" rx="1.5" /><rect x="13" y="9" width="8" height="11" rx="1.5" /></svg>
          <select aria-label="Organization" value={current} onChange={(e) => router.push(`${target}?run=${encodeURIComponent(e.currentTarget.value)}`)}>
            {groups.map((g) => { const list = options.filter((o) => o.group === g); return list.length ? <optgroup key={g} label={g}>{list.map((o) => <option key={o.run_id} value={o.run_id}>{o.label}</option>)}</optgroup> : null; })}
          </select>
        </label>
      ) : null}
      <form className="topbar-search" action="/record" method="get" role="search">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4-4" /></svg>
        <input type="hidden" name="run" value={current} />
        <input name="q" placeholder="Search the record: a tool, a control, a person" aria-label="Search the record" />
      </form>
      <div className="topbar-right">
        <Link href="/account" className="topbar-user" title="Your account">
          <span className="rv-avatar is-you" aria-hidden>{operator ? initials(operator) : "?"}</span>
          <span>{operator ?? "Signed in"}</span>
        </Link>
      </div>
    </div>
  );
}
