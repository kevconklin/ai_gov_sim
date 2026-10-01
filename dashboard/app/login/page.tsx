import { getAuthConfig } from "@/lib/auth/config";
import { safeNext } from "@/lib/auth/origin";
import { MIN_PASSWORD } from "@/lib/auth/password";
import { countUsers } from "@/lib/auth/users";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  incorrect: "That email and password do not match an account.",
  invalid: "Enter your email and password.",
  config: "Sign-in is disabled: the server is missing its session secret.",
  exists: "The first account already exists. Sign in instead.",
  setup: "The account could not be made.",
  locked: "Too many failed sign-ins for that email or from this address. Wait 15 minutes and try again.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(typeof sp.next === "string" ? sp.next : "/");
  const error = typeof sp.error === "string" ? ERRORS[sp.error] : undefined;
  const why = typeof sp.why === "string" ? sp.why : undefined;
  const cfg = getAuthConfig();
  const firstRun = cfg.ok && (await countUsers()) === 0;
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="panel w-96 p-5">
        <h1 className="mb-1 text-base font-semibold">AI Governance</h1>
        <p className="muted mb-4">{firstRun ? "No accounts yet. Make the first one; it runs the service." : "Sign in"}</p>
        {!cfg.ok ? <p style={{ color: "var(--c-sev-high)" }}>{cfg.error}</p> : firstRun ? (
          <form method="post" action="/login/setup" className="flex flex-col gap-3">
            <label className="flex flex-col gap-1"><span className="muted">Your name</span><input className="field" name="name" autoComplete="name" required minLength={2} maxLength={200} autoFocus /></label>
            <label className="flex flex-col gap-1"><span className="muted">Email</span><input className="field" type="email" name="email" autoComplete="username" required maxLength={200} /></label>
            <label className="flex flex-col gap-1"><span className="muted">Password</span><input className="field" type="password" name="password" autoComplete="new-password" required minLength={MIN_PASSWORD} /><span className="muted text-xs">At least {MIN_PASSWORD} characters.</span></label>
            {error ? <p style={{ color: "var(--c-sev-high)" }}>{error}{why ? ` ${why}` : ""}</p> : null}
            <button className="btn btn-primary" type="submit">Create the first account</button>
          </form>
        ) : (
          <form method="post" action="/login/session" className="flex flex-col gap-3">
            {cfg.devFallback ? <p className="muted">Dev mode: DASHBOARD_SESSION_SECRET is not set; a development secret is in use.</p> : null}
            <input type="hidden" name="next" value={next} />
            <label className="flex flex-col gap-1"><span className="muted">Email</span><input className="field" type="email" name="email" autoComplete="username" required autoFocus maxLength={200} /></label>
            <label className="flex flex-col gap-1"><span className="muted">Password</span><input className="field" type="password" name="password" autoComplete="current-password" required /></label>
            {error ? <p style={{ color: "var(--c-sev-high)" }}>{error}{why ? ` ${why}` : ""}</p> : null}
            <button className="btn btn-primary" type="submit">Sign in</button>
            <p className="muted text-xs">No account? Ask the person who runs governance here to invite you.</p>
          </form>
        )}
      </div>
    </main>
  );
}
