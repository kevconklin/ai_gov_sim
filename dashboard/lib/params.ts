export type SearchParams = Record<string, string | string[] | undefined>;

export function first(sp: SearchParams, key: string): string | undefined {
  const v = sp[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s === undefined || s === "" ? undefined : s;
}

export function all(sp: SearchParams, key: string): string[] {
  const v = sp[key];
  if (v === undefined) return [];
  return (Array.isArray(v) ? v : [v]).filter((s) => s !== "");
}

export function intParam(sp: SearchParams, key: string, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const raw = first(sp, key);
  const n = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Build `path?query` from current params with overrides (null/undefined removes a key). */
export function href(path: string, sp: SearchParams, overrides: Record<string, string | number | null | undefined> = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k in overrides) continue;
    for (const item of Array.isArray(v) ? v : v === undefined ? [] : [v]) q.append(k, item);
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== null && v !== undefined && v !== "") q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}
