import "server-only";
import { BANKS } from "@/lib/constants";
import { readDb } from "@/lib/db";
import { num, numOrNull } from "@/lib/db/values";
import { first, type SearchParams } from "@/lib/params";

export interface RunRow {
  run_id: string;
  experiment_id: string;
  bank_id: string;
  condition: string;
  replicate: number;
  seed: string;
  parent_run_id: string | null;
  fork_month: string | null;
  model_versions: string;
  start_month: string;
  current_month: string | null;
  status: string;
  spend_cap_usd_per_month: number | null;
  started_at: string;
}

export interface Selection {
  experiments: { experiment_id: string; name: string }[];
  experimentId: string | null;
  replicates: number[];
  replicate: number | null;
  /** Base (non-fork) runs for the chosen experiment + replicate, in bank order. */
  runs: RunRow[];
}

const RUN_COLS = `run_id, experiment_id, bank_id, condition, replicate, seed, parent_run_id, fork_month,
  model_versions, start_month, current_month, status, spend_cap_usd_per_month, started_at`;

export function normalizeRun(r: RunRow): RunRow {
  return { ...r, replicate: num(r.replicate), seed: String(r.seed), spend_cap_usd_per_month: numOrNull(r.spend_cap_usd_per_month) };
}

function bankOrder(bankId: string): number {
  const i = (BANKS as readonly string[]).indexOf(bankId);
  return i === -1 ? BANKS.length : i;
}

export async function resolveSelection(sp: SearchParams): Promise<Selection> {
  const db = await readDb();
  const experiments = await db.all<{ experiment_id: string; name: string }>(
    "SELECT experiment_id, name FROM experiments ORDER BY created_at DESC, experiment_id",
  );
  const wanted = first(sp, "exp");
  const experimentId = experiments.find((e) => e.experiment_id === wanted)?.experiment_id ?? experiments[0]?.experiment_id ?? null;
  if (!experimentId) return { experiments, experimentId: null, replicates: [], replicate: null, runs: [] };

  const repRows = await db.all<{ replicate: unknown }>(
    "SELECT DISTINCT replicate FROM runs WHERE experiment_id = ? ORDER BY replicate",
    [experimentId],
  );
  const replicates = repRows.map((r) => num(r.replicate));
  const wantedRep = Number(first(sp, "rep"));
  const replicate = replicates.includes(wantedRep) ? wantedRep : (replicates[0] ?? null);
  if (replicate === null) return { experiments, experimentId, replicates, replicate: null, runs: [] };

  const runs = await db.all<RunRow>(
    `SELECT ${RUN_COLS} FROM runs WHERE experiment_id = ? AND replicate = ? AND parent_run_id IS NULL`,
    [experimentId, replicate],
  );
  return {
    experiments,
    experimentId,
    replicates,
    replicate,
    runs: runs.map(normalizeRun).sort((a, b) => bankOrder(a.bank_id) - bankOrder(b.bank_id)),
  };
}

export async function listAllRuns(): Promise<RunRow[]> {
  const db = await readDb();
  const rows = await db.all<RunRow>(`SELECT ${RUN_COLS} FROM runs ORDER BY experiment_id, replicate, bank_id, started_at`);
  return rows.map(normalizeRun);
}

/** Pick one run of the selection by `bank` param (defaults to the first bank). */
export function pickRun(sel: Selection, sp: SearchParams): RunRow | undefined {
  const bank = first(sp, "bank");
  return sel.runs.find((r) => r.bank_id === bank) ?? sel.runs[0];
}

export function selectionParams(sel: Selection): Record<string, string> {
  const out: Record<string, string> = {};
  if (sel.experimentId) out.exp = sel.experimentId;
  if (sel.replicate !== null) out.rep = String(sel.replicate);
  return out;
}
