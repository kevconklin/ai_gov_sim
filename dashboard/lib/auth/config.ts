/** Auth settings from env. Fails closed in production when anything is missing. */
export type AuthConfig =
  | { ok: true; password: string; secret: string; devFallback: boolean }
  | { ok: false; error: string };

const DEV_PASSWORD = "dev-password";
const DEV_SECRET = "dev-only-session-secret-not-for-production-use-000";
const MIN_SECRET_LENGTH = 32;

export function getAuthConfig(env: Record<string, string | undefined> = process.env): AuthConfig {
  const password = env.DASHBOARD_PASSWORD ?? "";
  const secret = env.DASHBOARD_SESSION_SECRET ?? "";
  const production = env.NODE_ENV === "production";

  if (password && secret) {
    if (secret.length < MIN_SECRET_LENGTH) {
      return { ok: false, error: `DASHBOARD_SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters.` };
    }
    return { ok: true, password, secret, devFallback: false };
  }
  if (production) {
    return { ok: false, error: "DASHBOARD_PASSWORD and DASHBOARD_SESSION_SECRET must be set in production." };
  }
  return {
    ok: true,
    password: password || DEV_PASSWORD,
    secret: secret || DEV_SECRET,
    devFallback: true,
  };
}
