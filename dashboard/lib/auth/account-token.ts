import type { GlobalRole } from "./roles";

export interface SessionUser {
  user_id: string;
  email: string;
  name: string;
  role: GlobalRole;
}

/** The signed cookie's body is the account as JSON; anything else (an old token) is refused. */
export function encodeUser(u: SessionUser): string {
  return JSON.stringify({ u: u.user_id, e: u.email, n: u.name, r: u.role });
}

export function decodeUser(text: string): SessionUser | null {
  try {
    const v = JSON.parse(text) as Record<string, unknown>;
    if (typeof v.u !== "string" || typeof v.e !== "string" || typeof v.n !== "string" || (v.r !== "operator" && v.r !== "member")) return null;
    return { user_id: v.u, email: v.e, name: v.n, role: v.r };
  } catch {
    return null;
  }
}

