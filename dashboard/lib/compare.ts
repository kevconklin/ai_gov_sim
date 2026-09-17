import { collapseDims, type MetricDef } from "./metrics-catalog";
import { bootstrapBand, minMaxBand, type Band } from "./stats/bands";
import { kaplanMeier, monthsElapsed, type KmStep } from "./stats/km";

export interface CompareRun {
  run_id: string;
  bank_id: string;
  condition: string;
  replicate: number;
  start_month: string;
  current_month: string | null;
}

export interface LongMetricRow {
  run_id: string;
  sim_month: string;
  metric: string;
  dimension: string;
  value: number | null;
}

export type BandKind = "minmax" | "boot";

const KNOWN_CONDITION_COLORS: Record<string, string> = {
  conservative: "var(--c-bank-a)",
  aggressive: "var(--c-bank-b)",
  moderate: "var(--c-series-3)",
};
const FALLBACK = ["var(--c-series-4)", "var(--c-series-5)", "var(--c-series-6)", "var(--c-series-7)"];

export function conditionColor(condition: string, index: number): string {
  return KNOWN_CONDITION_COLORS[condition] ?? FALLBACK[index % FALLBACK.length]!;
}

/** One value per run per month for a metric, collapsing dimensions by the catalog rule. */
export function perRunValues(def: MetricDef, rows: LongMetricRow[], dim: string): { run_id: string; sim_month: string; value: number }[] {
  const groups = new Map<string, Map<string, LongMetricRow[]>>();
  for (const r of rows) {
    if (r.metric !== def.name) continue;
    const byMonth = groups.get(r.run_id) ?? new Map<string, LongMetricRow[]>();
    byMonth.set(r.sim_month, [...(byMonth.get(r.sim_month) ?? []), r]);
    groups.set(r.run_id, byMonth);
  }
  const chosen = dim && def.dims.includes(dim) ? dim : undefined;
  const out: { run_id: string; sim_month: string; value: number }[] = [];
  for (const [run_id, byMonth] of groups) {
    for (const [sim_month, group] of byMonth) {
      const value = collapseDims(def, group, chosen);
      if (value !== null) out.push({ run_id, sim_month, value });
    }
  }
  return out;
}

export type BandRow = Record<string, string | number | [number, number] | null> & { sim_month: string };

/** Chart rows: `${condition}_mean`, `${condition}_band` = [low, high], `${condition}_n`. */
export function conditionBands(values: { run_id: string; sim_month: string; value: number }[], runs: CompareRun[], kind: BandKind): BandRow[] {
  const condOf = new Map(runs.map((r) => [r.run_id, r.condition]));
  const byMonth = new Map<string, Map<string, number[]>>();
  for (const v of values) {
    const cond = condOf.get(v.run_id);
    if (!cond) continue;
    const m = byMonth.get(v.sim_month) ?? new Map<string, number[]>();
    m.set(cond, [...(m.get(cond) ?? []), v.value]);
    byMonth.set(v.sim_month, m);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([sim_month, conds]) => {
      const row: BandRow = { sim_month };
      for (const [cond, vals] of conds) {
        const band: Band | null = kind === "boot" ? bootstrapBand(vals) : minMaxBand(vals);
        if (!band) continue;
        row[`${cond}_mean`] = band.mean;
        row[`${cond}_band`] = [band.low, band.high];
        row[`${cond}_n`] = band.n;
      }
      return row;
    });
}

export function bandRowsToCsv(rows: BandRow[]): Record<string, string | number | null>[] {
  return rows.map((row) => {
    const out: Record<string, string | number | null> = {};
    for (const [k, v] of Object.entries(row)) {
      if (Array.isArray(v)) {
        const base = k.replace(/_band$/, "");
        out[`${base}_low`] = v[0];
        out[`${base}_high`] = v[1];
      } else {
        out[k] = v;
      }
    }
    return out;
  });
}

export interface TimeToEvent {
  run_id: string;
  condition: string;
  replicate: number;
  bank_id: string;
  time: number;
  event: boolean;
  event_month: string | null;
}

/** Time from run start to first event month, or censored at the last completed month. */
export function timeToEvent(runs: CompareRun[], firstEventMonth: Map<string, string>): TimeToEvent[] {
  return runs.map((r) => {
    const base = { run_id: r.run_id, condition: r.condition, replicate: r.replicate, bank_id: r.bank_id };
    const month = firstEventMonth.get(r.run_id) ?? null;
    if (month) return { ...base, time: monthsElapsed(r.start_month, month), event: true, event_month: month };
    const time = r.current_month ? monthsElapsed(r.start_month, r.current_month) : 0;
    return { ...base, time, event: false, event_month: null };
  });
}

/** Per-condition KM curves merged on a shared time axis (survival carried forward). */
export function kmByCondition(subjects: TimeToEvent[]): { rows: Record<string, number>[]; curves: Map<string, KmStep[]> } {
  const conditions = [...new Set(subjects.map((s) => s.condition))].sort();
  const curves = new Map(conditions.map((c) => [c, kaplanMeier(subjects.filter((s) => s.condition === c))]));
  const times = [...new Set([...curves.values()].flatMap((steps) => steps.map((s) => s.time)))].sort((a, b) => a - b);
  const rows = times.map((t) => {
    const row: Record<string, number> = { month: t };
    for (const [c, steps] of curves) {
      const at = [...steps].reverse().find((s) => s.time <= t);
      if (at) row[c] = at.survival;
    }
    return row;
  });
  return { rows, curves };
}
