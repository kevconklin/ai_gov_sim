import "server-only";
import { cookies } from "next/headers";
import { getAuthConfig } from "./config";
import { SESSION_COOKIE, verifySession } from "./token";
import { decodeUser, type SessionUser } from "./account-token";
export { encodeUser, decodeUser, type SessionUser } from "./account-token";

export interface Account extends SessionUser {
  must_change: boolean;
}

/**
 * The cookie is a signed claim; the account is the truth. Every request looks the account up, so a
 * disabled account, a demoted operator, or a changed password (which bumps session_version) ends
 * the session at once rather than at the cookie's expiry.
 */
async function session(): Promise<Account | null> {
  const cfg = getAuthConfig();
  if (!cfg.ok) return null;
  const store = await cookies();
  const result = await verifySession(cfg.secret, store.get(SESSION_COOKIE)?.value);
  const claimed = result.ok ? decodeUser(result.operator) : null;
  if (!claimed) return null;
  const { userById } = await import("./users");
  const user = await userById(claimed.user_id);
  if (!user || user.disabled_at || Number(user.session_version ?? 0) !== claimed.version) return null;
  return { user_id: user.user_id, email: user.email, name: user.name, role: user.role, version: Number(user.session_version ?? 0), must_change: Boolean(user.must_change) };
}

/** Defense in depth for write paths: re-check the session inside the handler. */
export async function hasValidSession(): Promise<boolean> {
  return (await session()) !== null;
}

/** The signed-in account, as it is now, not as it was when the cookie was issued. */
export async function currentUser(): Promise<Account | null> {
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
