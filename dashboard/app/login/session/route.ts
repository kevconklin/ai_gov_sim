import { NextResponse } from "next/server";
import { getAuthConfig } from "@/lib/auth/config";
import { safeNext, sameOrigin } from "@/lib/auth/origin";
import { constantTimeEqual, MAX_OPERATOR_LENGTH, SESSION_COOKIE, SESSION_TTL_MS, signSession } from "@/lib/auth/token";

const FAILURE_DELAY_MS = 600;

function back(request: Request, next: string, error: string): NextResponse {
  const url = new URL("/login", request.url);
  url.searchParams.set("error", error);
  if (next !== "/") url.searchParams.set("next", next);
  return NextResponse.redirect(url, 303);
}

/** POST /login/session (form: password, next). Sets the signed session cookie. */
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

  const password = form.get("password");
  if (typeof password !== "string" || password.length === 0 || password.length > 1024) {
    return back(request, next, "invalid");
  }
  if (!(await constantTimeEqual(password, cfg.password))) {
    await new Promise((r) => setTimeout(r, FAILURE_DELAY_MS));
    return back(request, next, "incorrect");
  }

  // Who is signing in goes into the signed cookie, so anything they later put on the record is
  // attributed to the session rather than to a name typed beside the action.
  const operatorRaw = form.get("operator");
  const operator = typeof operatorRaw === "string" ? operatorRaw.trim() : "";
  if (!operator || operator.length > MAX_OPERATOR_LENGTH) return back(request, next, "operator");

  const res = NextResponse.redirect(new URL(next, request.url), 303);
  res.cookies.set(SESSION_COOKIE, await signSession(cfg.secret, operator), {
    httpOnly: true,
    sameSite: "lax",
    secure: request.headers.get("x-forwarded-proto") === "https" || new URL(request.url).protocol === "https:",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return res;
}
