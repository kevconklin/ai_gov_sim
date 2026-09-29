/** Role words shared by server and client code; nothing here touches the database. */
export type OrgRole = "runs" | "decides" | "asks";
export type GlobalRole = "operator" | "member";
export const ORG_ROLES: OrgRole[] = ["runs", "decides", "asks"];
export const ROLE_WORDS: Record<OrgRole, string> = { runs: "Runs it", decides: "Decides", asks: "Asks and submits" };
export const ROLE_HELP: Record<OrgRole, string> = {
  runs: "Settings, the committee, documents, budget, people, and everything below.",
  decides: "Convenes reviews and signs decisions, and everything below.",
  asks: "Submits matters, asks the policy, and reads the record.",
};

export const RANK: Record<OrgRole, number> = { asks: 0, decides: 1, runs: 2 };

export function atLeast(role: OrgRole | null, need: OrgRole): boolean {
  return role !== null && RANK[role] >= RANK[need];
}
