import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * scrypt$N$r$p$salt$hash, base64. The same format govern/accounts.py writes, so an account made at the
 * command line signs in here and one made here can be checked by the worker.
 */
const N = 16384, R = 8, P = 1, KEY_LEN = 32;
export const MIN_PASSWORD = 12;

export function hashPassword(password: string): string {
  if (password.length < MIN_PASSWORD) throw new Error(`a password needs at least ${MIN_PASSWORD} characters`);
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, KEY_LEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, salt, key] = parts as [string, string, string, string, string, string];
  try {
    const want = Buffer.from(key, "base64");
    const got = scryptSync(password, Buffer.from(salt, "base64"), want.length, { N: Number(n), r: Number(r), p: Number(p) });
    return got.length === want.length && timingSafeEqual(got, want);
  } catch {
    return false;
  }
}

/** A temporary password for an invited person, said once to the inviter and changed at first sign-in. */
export function temporaryPassword(): string {
  const words = ["harbor", "cedar", "maple", "river", "summit", "meadow", "quarry", "orchard", "lantern", "compass"];
  const pick = () => words[randomBytes(1)[0]! % words.length];
  return `${pick()}-${pick()}-${randomBytes(2).readUInt16BE(0)}`;
}
