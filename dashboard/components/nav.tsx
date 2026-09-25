"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { initials } from "@/lib/reviews/model";
import { ThemeToggle } from "./theme-toggle";

const STROKE = { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const ICONS: Record<string, ReactNode> = {
  reviews: <><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" /></>,
  control: <><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></>,
  overview: <><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="5" rx="1.5" /><rect x="13" y="11" width="8" height="10" rx="1.5" /><rect x="3" y="14" width="8" height="7" rx="1.5" /></>,
  meetings: <><circle cx="9" cy="8" r="3" /><path d="M3 19c.5-3 3-5 6-5s5.5 2 6 5" /><circle cx="17" cy="9" r="2.3" /><path d="M16.5 14c2.5.2 4 1.8 4.5 4.5" /></>,
  policy: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></>,
  usecases: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M8 5v14" /></>,
  outcomes: <><path d="M4 18l5-6 4 3 7-8" /><path d="M16 7h4v4" /></>,
  people: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.7-3.7 3.6-6 7-6s6.3 2.3 7 6" /></>,
  engine: <><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /></>,
  health: <><path d="M3 12h4l2-5 3 10 3-7 2 2h4" /></>,
  compare: <><path d="M12 3v18" /><path d="M4 8l4-4 4 4M20 16l-4 4-4-4" /></>,
  logs: <><path d="M5 4h14v16H5z" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  close: <><path d="M6 6l12 12M18 6L6 18" /></>,
  out: <><path d="M10 4H5v16h5" /><path d="M14 8l5 4-5 4M19 12H9" /></>,
};

function Icon({ name }: { name: string }) {
  return <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden {...STROKE}>{ICONS[name]}</svg>;
}

type Item = { href: string; label: string; icon: string };

// Reviews are the product. The simulation is the test bench a committee is tried on before it
// is trusted with real decisions, so its pages sit underneath, folded away by default.
const PRODUCT: Item[] = [
  { href: "/reviews", label: "Reviews", icon: "reviews" },
  { href: "/control", label: "Control", icon: "control" },
];
const SIMULATION: Item[] = [
  { href: "/overview", label: "Overview", icon: "overview" },
  { href: "/meetings", label: "Meetings", icon: "meetings" },
  { href: "/policy", label: "Policy", icon: "policy" },
  { href: "/use-cases", label: "Use cases", icon: "usecases" },
  { href: "/outcomes", label: "Outcomes", icon: "outcomes" },
  { href: "/people", label: "People", icon: "people" },
  { href: "/engine", label: "Reality engine", icon: "engine" },
  { href: "/health", label: "Health", icon: "health" },
  { href: "/compare", label: "Compare", icon: "compare" },
  { href: "/logs", label: "Log explorer", icon: "logs" },
];

function NavLink({ item, current, onPick }: { item: Item; current: boolean; onPick?: () => void }) {
  return (
    <Link href={item.href} className="nav-link" aria-current={current ? "page" : undefined} onClick={onPick}>
      <Icon name={item.icon} />
      <span>{item.label}</span>
    </Link>
  );
}

function Brand() {
  return (
    <Link href="/reviews" className="nav-brand">
      <span aria-hidden className="nav-mark">AI</span>
      <span>Governance</span>
    </Link>
  );
}

function Menu({ pathname, operator, onPick }: { pathname: string; operator: string | null; onPick?: () => void }) {
  const inSimulation = SIMULATION.some((i) => pathname.startsWith(i.href));
  return (
    <>
      <ul className="nav-list">
        {PRODUCT.map((item) => <li key={item.href}><NavLink item={item} current={pathname.startsWith(item.href)} onPick={onPick} /></li>)}
      </ul>
      <details className="nav-group" open={inSimulation}>
        <summary className="nav-group-head">
          <span>Simulation</span>
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden {...STROKE} className="nav-chev"><path d="M9 6l6 6-6 6" /></svg>
        </summary>
        <ul className="nav-list">
          {SIMULATION.map((item) => <li key={item.href}><NavLink item={item} current={pathname.startsWith(item.href)} onPick={onPick} /></li>)}
        </ul>
      </details>
      <div className="nav-foot">
        <ThemeToggle />
        <div className="nav-user">
          <span className="rv-avatar is-you" aria-hidden>{operator ? initials(operator) : "?"}</span>
          <span className="nav-user-name">{operator ?? "Signed in"}</span>
          <form method="post" action="/logout">
            <button className="nav-out" type="submit" title="Sign out" aria-label="Sign out"><Icon name="out" /></button>
          </form>
        </div>
      </div>
    </>
  );
}

/** A sidebar where there is room for one; on a phone, a top bar with the menu behind a button. */
export function Nav({ operator }: { operator: string | null }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      <nav className="nav" aria-label="Main">
        <Brand />
        <Menu pathname={pathname} operator={operator} />
      </nav>
      <div className="nav-bar">
        <Brand />
        <button type="button" className="nav-menu-btn" aria-expanded={open} aria-controls="nav-sheet" onClick={() => setOpen((o) => !o)}>
          <Icon name={open ? "close" : "menu"} />
          <span>{open ? "Close" : "Menu"}</span>
        </button>
      </div>
      {open ? (
        <div id="nav-sheet" className="nav-sheet">
          <Menu pathname={pathname} operator={operator} onPick={() => setOpen(false)} />
        </div>
      ) : null}
    </>
  );
}
