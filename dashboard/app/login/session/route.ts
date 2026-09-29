import { NextResponse } from "next/server";
import { getAuthConfig } from "@/lib/auth/config";
import { safeNext, sameOrigin } from "@/lib/auth/origin";
import { verifyPassword } from "@/lib/auth/password";
import { encodeUser } from "@/lib/auth/session";
import { SESSION_COOKIE, SESSION_TTL_MS, signSession } from "@/lib/auth/token";
import { userByEmail } from "@/lib/auth/users";

const FAILURE_DELAY_MS = 600;

function back(request: Request, next: string, error: string): NextResponse {
  const url = new URL("/login", request.url);
  url.searchParams.set("error", error);
  if (next !== "/") url.searchParams.set("next", next);
  return NextResponse.redirect(url, 303);
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

  const user = await userByEmail(email);
  // the same delay and message whether the account or the password is wrong
  if (!user || user.disabled_at || !verifyPassword(password, user.password_hash)) {
    await new Promise((r) => setTimeout(r, FAILURE_DELAY_MS));
    return back(request, next, "incorrect");
  }

  const mustChange = Boolean(user.must_change);
  const res = NextResponse.redirect(new URL(mustChange ? "/account?first=1" : next, request.url), 303);
  res.cookies.set(SESSION_COOKIE, await signSession(cfg.secret, encodeUser({ user_id: user.user_id, email: user.email, name: user.name, role: user.role })), sessionCookie(request));
  return res;
}
