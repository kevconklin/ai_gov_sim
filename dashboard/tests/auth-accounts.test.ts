import { describe, expect, it } from "vitest";
import { atLeast, RANK } from "@/lib/auth/roles";
import { hashPassword, temporaryPassword, verifyPassword } from "@/lib/auth/password";
import { decodeUser, encodeUser } from "@/lib/auth/account-token";

describe("passwords", () => {
  it("hash in the format the worker writes, and verify", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(stored.startsWith("scrypt$16384$8$1$")).toBe(true);
    expect(verifyPassword("correct horse battery staple", stored)).toBe(true);
    expect(verifyPassword("wrong", stored)).toBe(false);
    expect(verifyPassword("x", "garbage")).toBe(false);
    expect(() => hashPassword("short")).toThrow(/12 characters/);
  });
  it("a hash the Python side made verifies here", () => {
    // hashlib.scrypt("a long enough password", salt=b"0123456789abcdef", n=16384, r=8, p=1, dklen=32)
    const stored = "scrypt$16384$8$1$MDEyMzQ1Njc4OWFiY2RlZg==$ZLwG9iYvHnmiXfqjHercJb4IPuxh9hrA/9iDtdjOSHw=";
    expect(verifyPassword("a long enough password", stored)).toBe(true);
    expect(verifyPassword("a long enough passwore", stored)).toBe(false);
  });
  it("temporary passwords are long enough and readable", () => {
    const t = temporaryPassword();
    expect(t.length).toBeGreaterThanOrEqual(12);
    expect(t).toMatch(/^[a-z]+-[a-z]+-\d+$/);
  });
});

describe("roles", () => {
  it("rank in order and a missing membership allows nothing", () => {
    expect(RANK.runs).toBeGreaterThan(RANK.decides);
    expect(RANK.decides).toBeGreaterThan(RANK.asks);
    expect(atLeast("decides", "asks")).toBe(true);
    expect(atLeast("asks", "decides")).toBe(false);
    expect(atLeast(null, "asks")).toBe(false);
  });
});

describe("session body", () => {
  it("round-trips an account and refuses anything else", () => {
    const u = { user_id: "u1", email: "dana@harbor.example", name: "Dana", role: "operator" as const, version: 3 };
    expect(decodeUser(encodeUser(u))).toEqual(u);
    expect(decodeUser("Kevin Conklin, CRO")).toBeNull();
    expect(decodeUser(JSON.stringify({ u: "x", e: "y", n: "z", r: "king", v: 0 }))).toBeNull();
    expect(decodeUser(JSON.stringify({ u: "x", e: "y", n: "z", r: "member" }))).toBeNull();      // no version: an older cookie
  });
});
