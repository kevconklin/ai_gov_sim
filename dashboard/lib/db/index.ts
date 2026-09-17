import "server-only";
import { openPostgres } from "./postgres";
import { openSqlite } from "./sqlite";
import type { Db } from "./types";
import { parseDbUrl } from "./url";

export type { Db, SqlValue, Statement } from "./types";

type Role = "read" | "control";

const globalCache = globalThis as unknown as { __gsimDb?: Map<Role, Promise<Db>> };

function cache(): Map<Role, Promise<Db>> {
  if (!globalCache.__gsimDb) globalCache.__gsimDb = new Map();
  return globalCache.__gsimDb;
}

async function open(role: Role): Promise<Db> {
  const raw =
    role === "control"
      ? process.env.DATABASE_URL_CONTROL || process.env.DATABASE_URL
      : process.env.DATABASE_URL;
  const target = parseDbUrl(raw);
  if (target.kind === "postgres") return openPostgres(target.url);
  // Read pages open SQLite read-only so nothing outside Control can write.
  return openSqlite(target.path, role === "read");
}

function getDb(role: Role): Promise<Db> {
  const c = cache();
  let db = c.get(role);
  if (!db) {
    db = open(role).catch((err: unknown) => {
      c.delete(role);
      throw err;
    });
    c.set(role, db);
  }
  return db;
}

/** Read-only connection for all dashboard pages. */
export function readDb(): Promise<Db> {
  return getDb("read");
}

/** Connection used only by lib/control/submit.ts (INSERT into commands, interventions). */
export function controlDb(): Promise<Db> {
  return getDb("control");
}
