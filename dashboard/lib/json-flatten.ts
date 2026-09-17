export interface RangeRow {
  path: string;
  low: number | null;
  mode: number | null;
  high: number | null;
  extra: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const RANGE_KEYS = ["low", "mode", "high"];

/** Collect {low, mode, high} objects as rows; other leaves are returned as scalars. */
export function rangeRows(value: unknown, prefix = ""): { ranges: RangeRow[]; scalars: [string, string][] } {
  const ranges: RangeRow[] = [];
  const scalars: [string, string][] = [];
  const walk = (v: unknown, path: string) => {
    if (isRecord(v)) {
      if (RANGE_KEYS.some((k) => typeof v[k] === "number")) {
        const extra = Object.entries(v).filter(([k]) => !RANGE_KEYS.includes(k)).map(([k, x]) => `${k}=${typeof x === "object" ? JSON.stringify(x) : String(x)}`).join(", ");
        ranges.push({ path, low: num(v.low), mode: num(v.mode), high: num(v.high), extra });
        return;
      }
      for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
      return;
    }
    scalars.push([path, Array.isArray(v) ? JSON.stringify(v) : String(v)]);
  };
  walk(value, prefix);
  return { ranges, scalars };
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Flatten to dotted-path leaves (arrays kept as JSON strings). */
export function flatten(value: unknown, prefix = ""): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  const walk = (v: unknown, path: string) => {
    if (isRecord(v)) {
      for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
    } else if (Array.isArray(v)) {
      out[path] = JSON.stringify(v);
    } else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null) {
      out[path] = v;
    }
  };
  walk(value, prefix);
  return out;
}

export function stateDelta(before: unknown, after: unknown): { path: string; before: unknown; after: unknown }[] {
  const a = flatten(before);
  const b = flatten(after);
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  return keys.filter((k) => a[k] !== b[k]).map((k) => ({ path: k, before: a[k] ?? null, after: b[k] ?? null }));
}
