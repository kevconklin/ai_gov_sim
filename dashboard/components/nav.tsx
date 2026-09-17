import Link from "next/link";
import { ThemeToggle } from "./theme-toggle";

const LINKS: [string, string][] = [
  ["/", "Overview"],
  ["/meetings", "Meetings"],
  ["/policy", "Policy"],
  ["/use-cases", "Use cases"],
  ["/outcomes", "Outcomes"],
  ["/people", "People"],
  ["/engine", "Reality engine"],
  ["/health", "Health"],
  ["/compare", "Compare"],
  ["/logs", "Log explorer"],
  ["/control", "Control"],
];

export function Nav() {
  return (
    <nav className="sticky top-0 flex h-screen w-44 shrink-0 flex-col gap-4 overflow-y-auto border-r p-3" style={{ borderColor: "var(--border)", background: "var(--panel)" }}>
      <div>
        <div className="font-semibold">Governance Sim</div>
        <div className="muted text-xs">Research dashboard</div>
      </div>
      <ul className="flex flex-col gap-0.5">
        {LINKS.map(([path, label]) => (
          <li key={path}>
            <Link href={path} className="block rounded px-2 py-1 no-underline hover:bg-[var(--panel-2)]" style={{ color: "var(--text)" }}>
              {label}
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-auto flex flex-col gap-2">
        <ThemeToggle />
        <form method="post" action="/logout">
          <button className="btn w-full" type="submit">Sign out</button>
        </form>
      </div>
    </nav>
  );
}
