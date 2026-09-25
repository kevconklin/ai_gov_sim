import { currentOperator } from "@/lib/auth/session";
import { Suspense } from "react";
import { Nav } from "@/components/nav";
import { readDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * The simulation's pages appear in the sidebar only when there is a simulated run to look at,
 * or when SHOW_SIMULATION=1. A customer deployment has neither, and never sees them.
 */
async function simulationAvailable(): Promise<boolean> {
  if (process.env.SHOW_SIMULATION === "1") return true;
  if (process.env.SHOW_SIMULATION === "0") return false;
  try {
    const db = await readDb();
    const row = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM runs WHERE condition <> 'workspace'");
    return Number(row?.n ?? 0) > 0;
  } catch {
    return false;
  }
}

export default async function DashLayout({ children }: { children: React.ReactNode }) {
  const [operator, showSimulation] = await Promise.all([currentOperator(), simulationAvailable()]);
  return (
    <div className="dash">
      <Suspense fallback={null}><Nav operator={operator} showSimulation={showSimulation} /></Suspense>
      <main className="dash-main">{children}</main>
    </div>
  );
}
