import "server-only";
import { cookies } from "next/headers";
import { getAuthConfig } from "./config";
import { SESSION_COOKIE, verifySession } from "./token";

async function session() {
  const cfg = getAuthConfig();
  if (!cfg.ok) return { ok: false as const, reason: "config" };
  const store = await cookies();
  return verifySession(cfg.secret, store.get(SESSION_COOKIE)?.value);
}

/** Defense in depth for write paths: re-check the session inside the handler. */
export async function hasValidSession(): Promise<boolean> {
  return (await session()).ok;
}

/**
 * Who the current session says is acting, from the signed cookie.
 *
 * Actions that go on the record read this instead of a form field, so the name cannot be
 * changed per submission. It identifies a session, not a verified person: one shared
 * credential means anyone holding it can open a session under any name. What it does give is
 * a name fixed at sign-in, signed, and the same across every action that session takes.
 */
export async function currentOperator(): Promise<string | null> {
  const result = await session();
  return result.ok ? result.operator : null;
}
