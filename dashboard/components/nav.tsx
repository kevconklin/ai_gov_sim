import Link from "next/link";
import { ThemeToggle } from "./theme-toggle";

// Reviews are the product. The simulation is the test bench a committee is tried on before it
// is trusted with real decisions, so its pages sit underneath rather than alongside.
const REVIEW_LINKS: [string, string][] = [
  ["/reviews", "Reviews"],
  ["/control", "Control"],
];

const SIMULATION_LINKS: [string, string][] = [
  ["/overview", "Overview"],
  ["/meetings", "Meetings"],
  ["/policy", "Policy"],
  ["/use-cases", "Use cases"],
  ["/outcomes", "Outcomes"],
  ["/people", "People"],
  ["/engine", "Reality engine"],
  ["/health", "Health"],
  ["/compare", "Compare"],
  ["/logs", "Log explorer"],
];

function Links({ links }: { links: [string, string][] }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {links.map(([path, label]) => (
        <li key={path}>
          <Link href={path} className="block rounded px-2 py-1 no-underline hover:bg-[var(--panel-2)]" style={{ color: "var(--text)" }}>
            {label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Menu() {
  return (
    <>
      <Links links={REVIEW_LINKS} />
      <div>
        <div className="muted mb-1 px-2 text-xs">Simulation test bench</div>
        <Links links={SIMULATION_LINKS} />
      </div>
      <div className="flex flex-col gap-2 md:mt-auto">
        <ThemeToggle />
        <form method="post" action="/logout">
          <button className="btn w-full" type="submit">Sign out</button>
        </form>
      </div>
    </>
  );
}

const BRAND = { fontFamily: "var(--font-doc)", fontSize: 19, lineHeight: 1.2, fontWeight: 500 } as const;

/** A sidebar where there is room for one; on a phone, a bar with the menu folded away under it. */
export function Nav() {
  const surface = { borderColor: "var(--border)", background: "var(--panel)" };
  return (
    <>
      <nav className="sticky top-0 hidden h-screen w-44 shrink-0 flex-col gap-4 overflow-y-auto border-r p-3 md:flex" style={surface}>
        <div style={BRAND}>AI governance</div>
        <Menu />
      </nav>
      <details className="border-b md:hidden" style={surface}>
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3">
          <span style={BRAND}>AI governance</span>
          <span className="btn">Menu</span>
        </summary>
        <div className="flex flex-col gap-4 px-3 pb-4">
          <Menu />
        </div>
      </details>
    </>
  );
}
