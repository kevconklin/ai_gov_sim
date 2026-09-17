import type BetterSqlite3 from "better-sqlite3";
import type { Db, SqlValue, Statement } from "./types";

export async function openSqlite(filePath: string, readonly: boolean): Promise<Db> {
  const mod = await import("better-sqlite3");
  const Database = mod.default;
  const conn: BetterSqlite3.Database = new Database(filePath, { readonly, fileMustExist: true });
  conn.pragma("foreign_keys = ON");
  if (!readonly) conn.pragma("busy_timeout = 5000");

  return {
    kind: "sqlite",
    async all<T>(sql: string, params: readonly SqlValue[] = []) {
      return conn.prepare(sql).all(...params) as T[];
    },
    async get<T>(sql: string, params: readonly SqlValue[] = []) {
      return conn.prepare(sql).get(...params) as T | undefined;
    },
    async transaction(statements: readonly Statement[]) {
      const run = conn.transaction((stmts: readonly Statement[]) => {
        for (const s of stmts) conn.prepare(s.sql).run(...s.params);
      });
      run(statements);
    },
  };
}
