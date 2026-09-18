/**
 * npm run seed:dev
 * Creates dashboard/.dev/sim.sqlite from ../db/migrations/0001_init.sql and loads DEV FIXTURE data.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { Insert, Row } from "./fixture/common";
import { seedMeetings } from "./fixture/meetings";
import { ALL_METRIC_NAMES, seedMetrics } from "./fixture/metrics";
import { seedOps } from "./fixture/ops";
import { seedPeople } from "./fixture/people";
import { seedPolicy } from "./fixture/policy";
import { seedGovernance } from "./fixture/governance";
import { seedEngine, seedPortfolio } from "./fixture/portfolio";
import { seedWorld } from "./fixture/world";

const root = path.resolve(import.meta.dirname, "..");
const dbPath = path.join(root, ".dev", "sim.sqlite");
const migrations = path.resolve(root, "..", "db", "migrations");

function main(): void {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(dbPath + suffix)) rmSync(dbPath + suffix);
  }
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  // Every migration in name order, not just the first: a new table that only exists in a later
  // one is invisible here otherwise, and the page that reads it fails at runtime, not at build.
  const files = readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort();
  if (files.length === 0) throw new Error(`no migrations found in ${migrations}`);
  for (const file of files) db.exec(readFileSync(path.join(migrations, file), "utf8"));
  console.log(`applied ${files.length} migration(s): ${files.join(", ")}`);

  const counts = new Map<string, number>();
  const statements = new Map<string, Database.Statement>();
  const insert: Insert = (table: string, row: Row) => {
    const cols = Object.keys(row);
    const key = `${table}:${cols.join(",")}`;
    let stmt = statements.get(key);
    if (!stmt) {
      stmt = db.prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`);
      statements.set(key, stmt);
    }
    stmt.run(...cols.map((c) => row[c] ?? null));
    counts.set(table, (counts.get(table) ?? 0) + 1);
  };

  db.transaction(() => {
    db.pragma("defer_foreign_keys = ON");
    seedPeople(insert);
    seedPortfolio(insert);
    seedMeetings(insert);
    seedEngine(insert);
    seedPolicy(insert);
    seedWorld(insert);
    seedMetrics(insert);
    seedOps(insert);
    seedGovernance(insert);
  })();

  const distinct = db.prepare("SELECT COUNT(DISTINCT metric) AS n FROM metrics").get() as { n: number };
  db.close();
  console.log(`DEV FIXTURE database written to ${dbPath}`);
  for (const [table, n] of [...counts.entries()].sort()) console.log(`  ${table.padEnd(18)} ${n}`);
  console.log(`  distinct metrics   ${distinct.n} (expected ${ALL_METRIC_NAMES.length})`);
}

main();
