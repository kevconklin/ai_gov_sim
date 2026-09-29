import "server-only";
import { atLeast, type OrgRole } from "./roles";
import { currentUser } from "./session";
import { membershipsFor } from "./users";

export { atLeast };

/** The role the signed-in person holds in one organization. An operator runs every organization. */
export async function orgRole(runId: string): Promise<OrgRole | null> {
  const user = await currentUser();
  if (!user) return null;
  if (user.role === "operator") return "runs";
  const mine = await membershipsFor(user.user_id);
  return mine.find((m) => m.run_id === runId)?.role ?? null;
}

/** The organizations this person may see: every run for an operator, only memberships for anyone else. */
export async function visibleRuns(): Promise<"all" | string[]> {
  const user = await currentUser();
  if (!user) return [];
  if (user.role === "operator") return "all";
  return (await membershipsFor(user.user_id)).map((m) => m.run_id);
}

export async function isOperator(): Promise<boolean> {
  return (await currentUser())?.role === "operator";
}
