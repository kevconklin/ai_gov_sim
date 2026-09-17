import { getAuthConfig } from "@/lib/auth/config";
import { safeNext } from "@/lib/auth/origin";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  incorrect: "Incorrect password.",
  invalid: "Enter the password.",
  config: "Sign-in is disabled: the server is missing auth configuration.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(typeof sp.next === "string" ? sp.next : "/");
  const error = typeof sp.error === "string" ? ERRORS[sp.error] : undefined;
  const cfg = getAuthConfig();
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="panel w-80 p-5">
        <h1 className="mb-1 text-base font-semibold">Governance Sim</h1>
        <p className="muted mb-4">Researcher dashboard</p>
        {cfg.ok ? (
          <form method="post" action="/login/session" className="flex flex-col gap-3">
            {cfg.devFallback ? <p className="muted">Dev mode: auth env vars are not set; the default dev password from the README is in use.</p> : null}
            <input type="hidden" name="next" value={next} />
            <label className="flex flex-col gap-1">
              <span className="muted">Password</span>
              <input className="field" type="password" name="password" autoComplete="current-password" required autoFocus />
            </label>
            {error ? <p style={{ color: "var(--c-sev-high)" }}>{error}</p> : null}
            <button className="btn btn-primary" type="submit">Sign in</button>
          </form>
        ) : (
          <p style={{ color: "var(--c-sev-high)" }}>{cfg.error}</p>
        )}
      </div>
    </main>
  );
}
