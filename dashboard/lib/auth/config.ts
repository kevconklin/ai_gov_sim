/** Auth settings from env. Fails closed in production when the session secret is missing. Accounts live in the database. */
export type AuthConfig =
  | { ok: true; secret: string; devFallback: boolean }
  | { ok: false; error: string };

const DEV_SECRET = "dev-only-session-secret-not-for-production-use-000";
const MIN_SECRET_LENGTH = 32;

export function getAuthConfig(env: Record<string, string | undefined> = process.env): AuthConfig {
  const secret = env.DASHBOARD_SESSION_SECRET ?? "";
  const production = env.NODE_ENV === "production";
  if (secret) {
    if (secret.length < MIN_SECRET_LENGTH) {
      return { ok: false, error: `DASHBOARD_SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters.` };
    }
    return { ok: true, secret, devFallback: false };
  }
  if (production) return { ok: false, error: "DASHBOARD_SESSION_SECRET must be set in production." };
  return { ok: true, secret: DEV_SECRET, devFallback: true };
}
