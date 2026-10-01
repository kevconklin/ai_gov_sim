import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
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
  const user = await currentUser();
  if (!user) redirect("/login");                    // the cookie verified but the account is gone, disabled, or reset
  const path = (await headers()).get("x-pathname") ?? "";
  if (user.must_change && !path.startsWith("/account")) redirect("/account?first=1");
  const operator = user.role === "operator";
  // the research bench and the raw logs are the operator's; a member of an organization never sees them
  const showSimulation = operator && (await simulationAvailable());
  return (
    <div className="dash">
      <Suspense fallback={null}><Nav operator={user.name} isOperator={operator} showSimulation={showSimulation} /></Suspense>
      <main className="dash-main">{children}</main>
    </div>
  );
}
