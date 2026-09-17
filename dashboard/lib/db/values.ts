/** Normalize driver differences (pg returns BIGINT/COUNT as strings, SQLite booleans as 0/1). */
export function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function bool(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "t" || v === "true";
}

export function parseJson<T = unknown>(text: string | null | undefined, fallback: T): T {
  if (text === null || text === undefined || text === "") return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** Build `?, ?, ?` for IN clauses. Callers must pass a non-empty list. */
export function placeholders(count: number): string {
  if (count < 1) throw new Error("placeholders() requires at least one value");
  return Array.from({ length: count }, () => "?").join(", ");
}
