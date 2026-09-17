import "server-only";
import { cookies } from "next/headers";
import { getAuthConfig } from "./config";
import { SESSION_COOKIE, verifySession } from "./token";

/** Defense in depth for write paths: re-check the session inside the handler. */
export async function hasValidSession(): Promise<boolean> {
  const cfg = getAuthConfig();
  if (!cfg.ok) return false;
  const store = await cookies();
  const result = await verifySession(cfg.secret, store.get(SESSION_COOKIE)?.value);
  return result.ok;
}
