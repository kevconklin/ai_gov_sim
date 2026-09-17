import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";
import { openSqlite } from "@/lib/db/sqlite";

const dir = mkdtempSync(path.join(tmpdir(), "gsim-db-"));
const file = path.join(dir, "t.sqlite");
const setup = new Database(file);
setup.exec("CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER NOT NULL)");
setup.close();

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("sqlite adapter", () => {
  it("writes atomically and rolls back on error", async () => {
    const db = await openSqlite(file, false);
    await db.transaction([
      { sql: "INSERT INTO t (id, n) VALUES (?, ?)", params: ["a", 1] },
      { sql: "INSERT INTO t (id, n) VALUES (?, ?)", params: ["b", 2] },
    ]);
    await expect(
      db.transaction([
        { sql: "INSERT INTO t (id, n) VALUES (?, ?)", params: ["c", 3] },
        { sql: "INSERT INTO t (id, n) VALUES (?, ?)", params: ["a", 9] },
      ]),
    ).rejects.toThrow();
    const rows = await db.all<{ id: string }>("SELECT id FROM t ORDER BY id");
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("refuses writes on a read-only connection", async () => {
    const db = await openSqlite(file, true);
    expect((await db.get<{ n: number }>("SELECT n FROM t WHERE id = ?", ["b"]))?.n).toBe(2);
    await expect(db.transaction([{ sql: "DELETE FROM t", params: [] }])).rejects.toThrow(/readonly/i);
  });
});
