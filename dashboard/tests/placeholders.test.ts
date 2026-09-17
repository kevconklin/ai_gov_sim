import { describe, expect, it } from "vitest";
import { countPlaceholders, toPgPlaceholders } from "@/lib/db/placeholders";
import { parseDbUrl } from "@/lib/db/url";

describe("toPgPlaceholders", () => {
  it("numbers placeholders in order", () => {
    expect(toPgPlaceholders("SELECT * FROM runs WHERE run_id = ? AND replicate = ?")).toBe(
      "SELECT * FROM runs WHERE run_id = $1 AND replicate = $2",
    );
  });

  it("leaves SQL without placeholders unchanged", () => {
    expect(toPgPlaceholders("SELECT 1")).toBe("SELECT 1");
  });

  it("ignores ? inside single-quoted strings, including escaped quotes", () => {
    expect(toPgPlaceholders("SELECT '?', 'it''s ?' FROM t WHERE a = ?")).toBe(
      "SELECT '?', 'it''s ?' FROM t WHERE a = $1",
    );
  });

  it("ignores ? inside double-quoted identifiers and comments", () => {
    const sql = 'SELECT "col?" FROM t -- why?\nWHERE a = ? /* b = ? */ AND c IN (?, ?)';
    expect(toPgPlaceholders(sql)).toBe('SELECT "col?" FROM t -- why?\nWHERE a = $1 /* b = ? */ AND c IN ($2, $3)');
    expect(countPlaceholders(sql)).toBe(3);
  });

  it("handles more than nine placeholders", () => {
    const sql = Array.from({ length: 11 }, () => "?").join(",");
    expect(toPgPlaceholders(sql)).toBe("$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11");
  });
});

describe("parseDbUrl", () => {
  it("detects postgres URLs", () => {
    expect(parseDbUrl("postgres://u:p@h/db")).toEqual({ kind: "postgres", url: "postgres://u:p@h/db" });
    expect(parseDbUrl("postgresql://h/db").kind).toBe("postgres");
  });

  it("resolves file: and bare paths against cwd", () => {
    expect(parseDbUrl("file:./.dev/sim.sqlite", "/app")).toEqual({ kind: "sqlite", path: "/app/.dev/sim.sqlite" });
    expect(parseDbUrl("/abs/sim.sqlite", "/app")).toEqual({ kind: "sqlite", path: "/abs/sim.sqlite" });
  });

  it("rejects empty and unsupported URLs", () => {
    expect(() => parseDbUrl("")).toThrow(/not set/);
    expect(() => parseDbUrl("mysql://h/db")).toThrow(/Unsupported/);
  });
});
