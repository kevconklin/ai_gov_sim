import "server-only";
import { readDb } from "@/lib/db";
import { num, numOrNull, parseJson, placeholders } from "@/lib/db/values";

export interface PolicyVersionMeta {
  run_id: string;
  bank_id: string;
  sim_month: string;
  git_sha: string;
  word_count: number;
  control_count: number;
  controls: string[];
  readability: number | null;
}

interface RawMeta extends Omit<PolicyVersionMeta, "controls"> {
  controls: string;
}

export async function policyVersions(runIds: string[]): Promise<PolicyVersionMeta[]> {
  if (runIds.length === 0) return [];
  const db = await readDb();
  const rows = await db.all<RawMeta>(
    `SELECT run_id, bank_id, sim_month, git_sha, word_count, control_count, controls, readability
     FROM policy_versions WHERE run_id IN (${placeholders(runIds.length)}) ORDER BY sim_month`,
    runIds,
  );
  return rows.map((r) => ({
    ...r,
    word_count: num(r.word_count),
    control_count: num(r.control_count),
    readability: numOrNull(r.readability),
    controls: parseJson<string[]>(r.controls, []),
  }));
}

export async function policyText(runId: string, simMonth: string): Promise<string | null> {
  const db = await readDb();
  const row = await db.get<{ policy_text: string }>("SELECT policy_text FROM policy_versions WHERE run_id = ? AND sim_month = ?", [runId, simMonth]);
  return row?.policy_text ?? null;
}
