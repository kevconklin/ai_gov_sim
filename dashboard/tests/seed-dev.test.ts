import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

/**
 * The seed is how anyone gets a database to run the dashboard against, so a new migration that
 * it does not apply produces a page that fails at runtime against a build that is green. That
 * happened once: the script named 0001_init.sql directly and nothing else.
 */
describe("dev seed", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), "seed-")), "sim.sqlite");

  execFileSync("npx", ["tsx", "scripts/seed-dev.ts"], {
    cwd: root,
    env: { ...process.env, SEED_DB_PATH: dbPath },
    stdio: "pipe",
  });
  const db = new Database(dbPath, { readonly: true });
  const applied = new Set(
    db.prepare("SELECT name FROM schema_migrations").all().map((r) => (r as { name: string }).name),
  );

  it("applies every migration on disk, not a named one", () => {
    const onDisk = readdirSync(path.resolve(root, "..", "db", "migrations")).filter((f) => f.endsWith(".sql"));
    expect(onDisk.length).toBeGreaterThan(1);
    expect([...applied].sort()).toEqual(onDisk.sort());
  });

  it("creates the tables the governance page reads", () => {
    const tables = new Set(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => (r as { name: string }).name),
    );
    for (const table of ["attestations", "syntheses", "perspectives", "agenda_deferrals", "run_snapshots", "items", "org_profiles", "panel_rules"]) {
      expect(tables.has(table), `missing ${table}`).toBe(true);
    }
  });

  it("leaves the governance page something to show", () => {
    const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
    expect(count("SELECT COUNT(*) AS n FROM meetings WHERE convened")).toBeGreaterThan(0);
    expect(count("SELECT COUNT(*) AS n FROM attestations")).toBeGreaterThan(0);
    expect(count("SELECT COUNT(*) AS n FROM syntheses")).toBeGreaterThan(0);
  });
});
