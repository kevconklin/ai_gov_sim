import "server-only";
import { cookies } from "next/headers";
import { getAuthConfig } from "./config";
import { SESSION_COOKIE, verifySession } from "./token";
import { decodeUser, type SessionUser } from "./account-token";
export { encodeUser, decodeUser, type SessionUser } from "./account-token";

async function session(): Promise<SessionUser | null> {
  const cfg = getAuthConfig();
  if (!cfg.ok) return null;
  const store = await cookies();
  const result = await verifySession(cfg.secret, store.get(SESSION_COOKIE)?.value);
  return result.ok ? decodeUser(result.operator) : null;
}

/** Defense in depth for write paths: re-check the session inside the handler. */
export async function hasValidSession(): Promise<boolean> {
  return (await session()) !== null;
}

/** The signed-in account. */
export async function currentUser(): Promise<SessionUser | null> {
  return session();
}

/** How the record names who acted: the account's name and email, fixed at sign-in and signed. */
export function actorOf(u: SessionUser): string {
  return `${u.name} <${u.email}>`;
}

/**
 * Who the current session says is acting, as the record names them. Actions that go on the record read
 * this instead of a form field, so the name cannot be changed per submission, and since sign-in checks a
 * password against the account, it names a verified person.
 */
export async function currentOperator(): Promise<string | null> {
  const u = await session();
  return u ? actorOf(u) : null;
}
