import "server-only";
import { randomUUID } from "node:crypto";
import { controlDb, readDb } from "@/lib/db";
import { hashPassword } from "./password";

import { ORG_ROLES, ROLE_HELP, ROLE_WORDS, type GlobalRole, type OrgRole } from "./roles";

export type { GlobalRole };
export { ORG_ROLES, ROLE_HELP, ROLE_WORDS };
export type { OrgRole };

export interface UserRow {
  user_id: string;
  email: string;
  name: string;
  password_hash: string;
  role: GlobalRole;
  must_change: boolean | number;
  disabled_at: string | null;
  created_at: string;
  session_version: number;
}

export async function countUsers(): Promise<number> {
  const db = await readDb();
  const row = await db.get<{ n: unknown }>("SELECT COUNT(*) AS n FROM users");
  return Number(row?.n ?? 0);
}

export async function userByEmail(email: string): Promise<UserRow | undefined> {
  const db = await readDb();
  return db.get<UserRow>("SELECT * FROM users WHERE email = ?", [email.trim().toLowerCase()]);
}

export async function userById(userId: string): Promise<UserRow | undefined> {
  const db = await readDb();
  return db.get<UserRow>("SELECT * FROM users WHERE user_id = ?", [userId]);
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Make an account. Returns the id, or the reason it could not be made. */
export async function createUser(input: { email: string; name: string; password: string; role: GlobalRole; createdBy: string | null; mustChange: boolean }):
  Promise<{ ok: true; user_id: string } | { ok: false; error: string }> {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL.test(email)) return { ok: false, error: "Enter a real email address." };
  if (input.name.trim().length < 2) return { ok: false, error: "Enter the person's name." };
  if (await userByEmail(email)) return { ok: false, error: `${email} already has an account.` };
  let hash: string;
  try {
    hash = hashPassword(input.password);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Bad password." };
  }
  const user_id = randomUUID();
  const db = await controlDb();
  await db.transaction([{
    // (? = 1) is a boolean on both SQLite and Postgres; the Db layer carries no boolean type
    sql: `INSERT INTO users (user_id, email, name, password_hash, role, must_change, disabled_at, created_at, created_by)
          VALUES (?, ?, ?, ?, ?, (? = 1), NULL, ?, ?)`,
    params: [user_id, email, input.name.trim(), hash, input.role, input.mustChange ? 1 : 0, new Date().toISOString(), input.createdBy],
  }]);
  return { ok: true, user_id };
}

export async function setPassword(userId: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  let hash: string;
  try {
    hash = hashPassword(password);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Bad password." };
  }
  const db = await controlDb();
  // a new password ends every other session of this account; the caller re-issues its own cookie
  await db.transaction([{ sql: "UPDATE users SET password_hash = ?, must_change = (0 = 1), session_version = session_version + 1 WHERE user_id = ?", params: [hash, userId] }]);
  return { ok: true };
}

/** An operator gives someone a temporary password. Every session they had ends; they must change it at sign-in. */
export async function resetPassword(userId: string, temporary: string): Promise<{ ok: true } | { ok: false; error: string }> {
  let hash: string;
  try {
    hash = hashPassword(temporary);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Bad password." };
  }
  const db = await controlDb();
  await db.transaction([{ sql: "UPDATE users SET password_hash = ?, must_change = (1 = 1), session_version = session_version + 1 WHERE user_id = ?", params: [hash, userId] }]);
  return { ok: true };
}

export async function setDisabled(userId: string, disabled: boolean): Promise<void> {
  const db = await controlDb();
  await db.transaction([{ sql: "UPDATE users SET disabled_at = ?, session_version = session_version + 1 WHERE user_id = ?", params: [disabled ? new Date().toISOString() : null, userId] }]);
}

/** The account rows an operator manages. */
export async function allUsers(): Promise<Pick<UserRow, "user_id" | "email" | "name" | "role" | "created_at" | "disabled_at" | "must_change">[]> {
  const db = await readDb();
  return db.all("SELECT user_id, email, name, role, created_at, disabled_at, must_change FROM users ORDER BY role, name");
}

// ---- sign-in failures: a wall for credential stuffing ------------------------------------------

export const LOCK_AFTER = 5;              // failures for one email in the window
export const LOCK_ADDRESS_AFTER = 20;     // failures from one address in the window
export const LOCK_WINDOW_MIN = 15;

export async function recentFailures(email: string, address: string): Promise<{ email: number; address: number }> {
  const db = await readDb();
  const since = new Date(Date.now() - LOCK_WINDOW_MIN * 60_000).toISOString();
  const [e, a] = await Promise.all([
    db.get<{ n: unknown }>("SELECT COUNT(*) AS n FROM login_failures WHERE email = ? AND failed_at > ?", [email.trim().toLowerCase(), since]),
    db.get<{ n: unknown }>("SELECT COUNT(*) AS n FROM login_failures WHERE address = ? AND failed_at > ?", [address, since]),
  ]);
  return { email: Number(e?.n ?? 0), address: Number(a?.n ?? 0) };
}

export async function recordFailure(email: string, address: string): Promise<void> {
  const db = await controlDb();
  await db.transaction([
    { sql: "INSERT INTO login_failures (failure_id, email, address, failed_at) VALUES (?, ?, ?, ?)", params: [randomUUID(), email.trim().toLowerCase(), address, new Date().toISOString()] },
    // failures older than a day are noise
    { sql: "DELETE FROM login_failures WHERE failed_at < ?", params: [new Date(Date.now() - 24 * 3_600_000).toISOString()] },
  ]);
}

export async function clearFailures(email: string): Promise<void> {
  const db = await controlDb();
  await db.transaction([{ sql: "DELETE FROM login_failures WHERE email = ?", params: [email.trim().toLowerCase()] }]);
}

export async function setName(userId: string, name: string): Promise<void> {
  const db = await controlDb();
  await db.transaction([{ sql: "UPDATE users SET name = ? WHERE user_id = ?", params: [name.trim(), userId] }]);
}

export interface MemberRow { membership_id: string; user_id: string; email: string; name: string; role: OrgRole; added_by: string; added_at: string }

export async function membersOf(runId: string): Promise<MemberRow[]> {
  const db = await readDb();
  return db.all<MemberRow>(
    `SELECT m.membership_id, m.user_id, u.email, u.name, m.role, m.added_by, m.added_at
     FROM memberships m JOIN users u ON u.user_id = m.user_id WHERE m.run_id = ? AND m.removed_at IS NULL ORDER BY u.name`, [runId]);
}

/** Which organizations a member may open, with their role in each. */
export async function membershipsFor(userId: string): Promise<{ run_id: string; role: OrgRole }[]> {
  const db = await readDb();
  return db.all<{ run_id: string; role: OrgRole }>("SELECT run_id, role FROM memberships WHERE user_id = ? AND removed_at IS NULL", [userId]);
}

export async function operators(): Promise<Pick<UserRow, "user_id" | "email" | "name" | "created_at">[]> {
  const db = await readDb();
  return db.all("SELECT user_id, email, name, created_at FROM users WHERE role = 'operator' AND disabled_at IS NULL ORDER BY name");
}
