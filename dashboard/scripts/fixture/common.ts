/**
 * DEV FIXTURE DATA. Hand-written, deterministic sample rows for local dashboard work.
 * Nothing here comes from a real simulation run.
 */
export type Cell = string | number | null;
export type Row = Record<string, Cell>;
export type Insert = (table: string, row: Row) => void;

export const EXPERIMENT_ID = "devfx-exp-001";
export const MONTHS = ["2027-01", "2027-02", "2027-03"] as const;
export type Month = (typeof MONTHS)[number];

export const SEATS = [
  "coo_chair",
  "cio",
  "ciso",
  "general_counsel",
  "cro",
  "cfo",
  "head_consumer_lending",
  "head_marketing",
] as const;
export type Seat = (typeof SEATS)[number];

export interface BankDef {
  bankId: "calder_ridge" | "tollgate";
  name: string;
  condition: "conservative" | "aggressive";
  runId: string;
  stanceShift: number;
  status: string;
  meetingDay: string;
}

export const BANKS: readonly BankDef[] = [
  {
    bankId: "calder_ridge",
    name: "Calder Ridge Bank",
    condition: "conservative",
    runId: "devfx-r1-calder_ridge",
    stanceShift: -0.4,
    status: "running",
    meetingDay: "14",
  },
  {
    bankId: "tollgate",
    name: "Tollgate Bank",
    condition: "aggressive",
    runId: "devfx-r1-tollgate",
    stanceShift: 0.5,
    status: "paused",
    meetingDay: "12",
  },
];

export const SEAT_BASE: Record<Seat, number> = {
  coo_chair: 3,
  cio: 3.5,
  ciso: 2,
  general_counsel: 2,
  cro: 2.5,
  cfo: 2.6,
  head_consumer_lending: 4,
  head_marketing: 4.2,
};

export function rid(bank: BankDef, local: string): string {
  return `${bank.runId}/${local}`;
}

export function agentId(bank: BankDef, seat: Seat, generation = 1): string {
  return rid(bank, `agent-${seat}-${generation}`);
}

/** Deterministic PRNG so the fixture is identical on every seed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function round(n: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function json(value: unknown): string {
  return JSON.stringify(value);
}

/** Real (wall clock) timestamps for log tables only. */
export function realTs(dayOffset: number, minutes = 0): string {
  const base = Date.UTC(2026, 8, 1, 14, 0, 0);
  return new Date(base + dayOffset * 86_400_000 + minutes * 60_000).toISOString();
}

export function monthIdx(month: string): number {
  return MONTHS.indexOf(month as Month);
}
