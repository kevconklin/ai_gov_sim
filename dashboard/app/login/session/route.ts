import { NextResponse } from "next/server";
import { getAuthConfig } from "@/lib/auth/config";
import { safeNext, sameOrigin } from "@/lib/auth/origin";
import { verifyPassword } from "@/lib/auth/password";
import { encodeUser } from "@/lib/auth/session";
import { SESSION_COOKIE, SESSION_TTL_MS, signSession } from "@/lib/auth/token";
import { clearFailures, LOCK_ADDRESS_AFTER, LOCK_AFTER, recentFailures, recordFailure, userByEmail } from "@/lib/auth/users";

const FAILURE_DELAY_MS = 600;

function back(request: Request, next: string, error: string): NextResponse {
  const url = new URL("/login", request.url);
  url.searchParams.set("error", error);
  if (next !== "/") url.searchParams.set("next", next);
  return NextResponse.redirect(url, 303);
}

/** The caller's address as the proxy reports it, else the connection's; only used to count failures. */
export function addressOf(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return (forwarded ? forwarded.split(",")[0]! : request.headers.get("x-real-ip") ?? "local").trim().slice(0, 64);
}

export function sessionCookie(request: Request) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: request.headers.get("x-forwarded-proto") === "https" || new URL(request.url).protocol === "https:",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}

/** POST /login/session (form: email, password, next). Checks the account and sets the signed session cookie. */
export async function POST(request: Request) {
  const cfg = getAuthConfig();
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return back(request, "/", "invalid");
  }
  const next = safeNext(form.get("next"));
  if (!cfg.ok) return back(request, next, "config");
  if (!sameOrigin(request)) return back(request, next, "invalid");

  const email = form.get("email");
  const password = form.get("password");
  if (typeof email !== "string" || typeof password !== "string" || !password || password.length > 1024) return back(request, next, "invalid");

  // a wall for credential stuffing: too many failures for this email, or from this address, and the answer
  // is "locked" whatever the password is, for the rest of the window
  const address = addressOf(request);
  const failures = await recentFailures(email, address);
  if (failures.email >= LOCK_AFTER || failures.address >= LOCK_ADDRESS_AFTER) {
    await new Promise((r) => setTimeout(r, FAILURE_DELAY_MS));
    return back(request, next, "locked");
  }

  const user = await userByEmail(email);
  // the same delay and message whether the account or the password is wrong
  if (!user || user.disabled_at || !verifyPassword(password, user.password_hash)) {
    await recordFailure(email, address);
    await new Promise((r) => setTimeout(r, FAILURE_DELAY_MS));
    return back(request, next, "incorrect");
  }
  await clearFailures(email);

  const mustChange = Boolean(user.must_change);
  const res = NextResponse.redirect(new URL(mustChange ? "/account?first=1" : next, request.url), 303);
  res.cookies.set(SESSION_COOKIE, await signSession(cfg.secret, encodeUser({ user_id: user.user_id, email: user.email, name: user.name, role: user.role, version: Number(user.session_version ?? 0) })), sessionCookie(request));
  return res;
}
