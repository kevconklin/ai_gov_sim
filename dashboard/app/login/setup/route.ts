import { NextResponse } from "next/server";
import { getAuthConfig } from "@/lib/auth/config";
import { sameOrigin } from "@/lib/auth/origin";
import { encodeUser } from "@/lib/auth/session";
import { SESSION_COOKIE, signSession } from "@/lib/auth/token";
import { countUsers, createUser } from "@/lib/auth/users";
import { sessionCookie } from "../session/route";

function back(request: Request, error: string): NextResponse {
  const url = new URL("/login", request.url);
  url.searchParams.set("error", error);
  return NextResponse.redirect(url, 303);
}

/** POST /login/setup: the first account, allowed only while there are none. It is an operator. */
export async function POST(request: Request) {
  const cfg = getAuthConfig();
  if (!cfg.ok) return back(request, "config");
  if (!sameOrigin(request)) return back(request, "invalid");
  if ((await countUsers()) > 0) return back(request, "exists");
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return back(request, "invalid");
  }
  const name = String(form.get("name") ?? "");
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  const made = await createUser({ email, name, password, role: "operator", createdBy: "first sign-in", mustChange: false });
  if (!made.ok) {
    const url = new URL("/login", request.url);
    url.searchParams.set("error", "setup");
    url.searchParams.set("why", made.error);
    return NextResponse.redirect(url, 303);
  }
  const res = NextResponse.redirect(new URL("/organizations", request.url), 303);
  res.cookies.set(SESSION_COOKIE, await signSession(cfg.secret, encodeUser({ user_id: made.user_id, email: email.trim().toLowerCase(), name: name.trim(), role: "operator", version: 0 })), sessionCookie(request));
  return res;
}
