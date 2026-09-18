"use server";

import { revalidatePath } from "next/cache";
import { hasValidSession } from "@/lib/auth/session";
import { submitCommand, type ControlResult } from "@/lib/control/submit";

const MAX_FIELD = 4000;
const UNAUTHORIZED: ControlResult = { success: false, data: null, error: "Your session has expired. Sign in again." };

function fieldsOf(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    if (typeof v === "string" && !k.startsWith("$")) out[k] = v.slice(0, MAX_FIELD);
  }
  return out;
}

function done(result: ControlResult): ControlResult {
  if (result.success) revalidatePath("/governance");
  return result;
}

/** Ask the worker to re-rank the candidate list. The formula lives there, not here. */
export async function refreshCandidatesAction(_prev: ControlResult | null, formData: FormData): Promise<ControlResult> {
  if (!(await hasValidSession())) return UNAUTHORIZED;
  const f = fieldsOf(formData);
  return done(await submitCommand({
    kind: "candidates",
    run_id: f.run_id ?? "",
    reason: f.reason?.trim() ? f.reason : "Refreshing the agenda candidate list before setting an agenda.",
    payload: {},
  }));
}

/** Call a meeting on an agenda a person chose. */
export async function conveneAction(_prev: ControlResult | null, formData: FormData): Promise<ControlResult> {
  if (!(await hasValidSession())) return UNAUTHORIZED;
  const f = fieldsOf(formData);
  const advisory = (f.advisory ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
  // Checkbox values are JSON the page wrote, but they arrive from the client and a logged-in
  // caller can send anything. A parse failure is a bad request, not a crashed action; the
  // shape itself is checked by commandSchema below.
  const agenda: unknown[] = [];
  for (const v of formData.getAll("item")) {
    if (typeof v !== "string") continue;
    try {
      agenda.push(JSON.parse(v));
    } catch {
      return { success: false, data: null, error: "An agenda item was not readable. Reload and try again." };
    }
  }
  return done(await submitCommand({
    kind: "convene",
    run_id: f.run_id ?? "",
    reason: f.reason ?? "",
    payload: { ...(agenda.length ? { agenda } : {}), ...(advisory.length ? { advisory } : {}) },
  }));
}

/**
 * Put a person on record for one decision.
 *
 * The rationale is typed here and sent as typed. Nothing drafts it: a machine-authored
 * attestation is discoverable evidence that the oversight was a formality.
 */
export async function attestAction(_prev: ControlResult | null, formData: FormData): Promise<ControlResult> {
  if (!(await hasValidSession())) return UNAUTHORIZED;
  const f = fieldsOf(formData);
  const respondedTo = formData
    .getAll("responded_to")
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  return done(await submitCommand({
    kind: "attest",
    run_id: f.run_id ?? "",
    reason: f.reason?.trim() ? f.reason : `Attesting to ${f.decision_id ?? "a decision"}.`,
    payload: {
      decision_id: f.decision_id ?? "",
      actor: f.actor ?? "",
      outcome: f.outcome ?? "",
      rationale: f.rationale ?? "",
      ...(respondedTo.length ? { responded_to: respondedTo } : {}),
      ...(f.apply === "on" ? { apply: true } : {}),
    },
  }));
}
