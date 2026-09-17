import { NextResponse, type NextRequest } from "next/server";
import { getAuthConfig } from "@/lib/auth/config";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/token";

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const cfg = getAuthConfig();

  if (!cfg.ok) {
    if (pathname === "/login") return NextResponse.next();
    return new NextResponse("Dashboard auth is not configured.", { status: 503 });
  }

  const result = await verifySession(cfg.secret, request.cookies.get(SESSION_COOKIE)?.value);
  if (result.ok) return NextResponse.next();

  if (isApi) {
    return NextResponse.json({ success: false, data: null, error: "Unauthorized" }, { status: 401 });
  }
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", `${pathname}${search}`);
  const res = NextResponse.redirect(loginUrl);
  if (request.cookies.has(SESSION_COOKIE)) res.cookies.delete(SESSION_COOKIE);
  return res;
}

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"],
};
