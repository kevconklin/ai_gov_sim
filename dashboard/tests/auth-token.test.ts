import { describe, expect, it } from "vitest";
import { getAuthConfig } from "@/lib/auth/config";
import { constantTimeEqual, signSession, verifySession } from "@/lib/auth/token";

const SECRET = "a-test-secret-that-is-long-enough-1234567890";
const WHO = "chief.risk@example.invalid";

describe("session tokens", () => {
  it("signs and verifies a fresh token", async () => {
    const now = 1_800_000_000_000;
    const token = await signSession(SECRET, WHO, now, 60_000);
    const result = await verifySession(SECRET, token, now + 1_000);
    expect(result).toEqual({ ok: true, expiresAt: now + 60_000, operator: WHO });
  });

  it("rejects expired tokens", async () => {
    const now = 1_800_000_000_000;
    const token = await signSession(SECRET, WHO, now, 60_000);
    expect(await verifySession(SECRET, token, now + 60_000)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects tokens signed with another secret or tampered", async () => {
    const token = await signSession(SECRET, WHO);
    expect((await verifySession(`${SECRET}x`, token)).ok).toBe(false);
    const [exp, nonce, who, sig] = token.split(".");
    const extended = `${Number(exp) + 10_000_000}.${nonce}.${who}.${sig}`;
    expect(await verifySession(SECRET, extended)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects missing and malformed tokens", async () => {
    expect(await verifySession(SECRET, undefined)).toEqual({ ok: false, reason: "missing" });
    expect(await verifySession(SECRET, "abc")).toEqual({ ok: false, reason: "malformed" });
    expect(await verifySession(SECRET, "12.nonce.who.!!!")).toEqual({ ok: false, reason: "malformed" });
  });

  it("carries the operator inside the signature, so it cannot be swapped", async () => {
    const token = await signSession(SECRET, WHO);
    const [exp, nonce, , sig] = token.split(".");
    const impostor = Buffer.from("someone.else@example.invalid").toString("base64url");
    expect(await verifySession(SECRET, `${exp}.${nonce}.${impostor}.${sig}`))
      .toEqual({ ok: false, reason: "bad_signature" });
  });

  it("refuses a token from before operator binding rather than acting anonymously", async () => {
    const token = await signSession(SECRET, WHO);
    const [exp, nonce, , sig] = token.split(".");
    expect(await verifySession(SECRET, `${exp}.${nonce}.${sig}`)).toEqual({ ok: false, reason: "malformed" });
  });

  it("compares strings in constant time semantics", async () => {
    expect(await constantTimeEqual("hunter2", "hunter2")).toBe(true);
    expect(await constantTimeEqual("hunter2", "hunter3")).toBe(false);
    expect(await constantTimeEqual("short", "a much longer value")).toBe(false);
  });
});

describe("auth config", () => {
  it("fails closed in production when env is missing", () => {
    expect(getAuthConfig({ NODE_ENV: "production" }).ok).toBe(false);
    expect(getAuthConfig({ NODE_ENV: "production", DASHBOARD_PASSWORD: "x" }).ok).toBe(false);
  });

  it("rejects short secrets", () => {
    expect(getAuthConfig({ NODE_ENV: "production", DASHBOARD_PASSWORD: "x", DASHBOARD_SESSION_SECRET: "short" }).ok).toBe(false);
  });

  it("accepts full config and uses dev fallback only outside production", () => {
    const full = getAuthConfig({ NODE_ENV: "production", DASHBOARD_PASSWORD: "pw", DASHBOARD_SESSION_SECRET: SECRET });
    expect(full).toMatchObject({ ok: true, devFallback: false });
    expect(getAuthConfig({ NODE_ENV: "development" })).toMatchObject({ ok: true, devFallback: true });
  });
});
