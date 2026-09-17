import type { Pool } from "pg";
import { toPgPlaceholders } from "./placeholders";
import type { Db, SqlValue, Statement } from "./types";

export async function openPostgres(url: string): Promise<Db> {
  const mod = await import("pg");
  const pool: Pool = new mod.default.Pool({ connectionString: url, max: 5 });

  return {
    kind: "postgres",
    async all<T>(sql: string, params: readonly SqlValue[] = []) {
      const res = await pool.query(toPgPlaceholders(sql), [...params]);
      return res.rows as T[];
    },
    async get<T>(sql: string, params: readonly SqlValue[] = []) {
      const res = await pool.query(toPgPlaceholders(sql), [...params]);
      return res.rows[0] as T | undefined;
    },
    async transaction(statements: readonly Statement[]) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const s of statements) {
          await client.query(toPgPlaceholders(s.sql), [...s.params]);
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
