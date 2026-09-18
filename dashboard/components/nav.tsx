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

export function Nav() {
  return (
    <nav className="sticky top-0 flex h-screen w-44 shrink-0 flex-col gap-4 overflow-y-auto border-r p-3" style={{ borderColor: "var(--border)", background: "var(--panel)" }}>
      <div>
        <div className="font-semibold">AI Governance</div>
        <div className="muted text-xs">Human-convened reviews</div>
      </div>
      <Links links={REVIEW_LINKS} />
      <div>
        <div className="muted mb-1 px-2 text-xs uppercase tracking-wide">Simulation</div>
        <Links links={SIMULATION_LINKS} />
      </div>
      <div className="mt-auto flex flex-col gap-2">
        <ThemeToggle />
        <form method="post" action="/logout">
          <button className="btn w-full" type="submit">Sign out</button>
        </form>
      </div>
    </nav>
  );
}
