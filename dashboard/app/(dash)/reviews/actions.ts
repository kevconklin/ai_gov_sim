"use server";

import { revalidatePath } from "next/cache";
import { currentOperator, hasValidSession } from "@/lib/auth/session";
import { bindActor } from "@/lib/control/bind";
import { submitCommand, submitWorkspace, type ControlResult } from "@/lib/control/submit";
import { detailsFromFields } from "@/lib/reviews/model";

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
  if (result.success) revalidatePath("/reviews");
  return result;
}

/** Ask the worker to re-rank the candidate list. The formula lives there, not here. */
export async function refreshCandidatesAction(_prev: ControlResult | null, formData: FormData): Promise<ControlResult> {
  const operator = await currentOperator();
  if (!operator) return UNAUTHORIZED;
  const f = fieldsOf(formData);
  return done(await submitCommand({
    kind: "candidates",
    run_id: f.run_id ?? "",
    reason: `${operator}: ${f.reason?.trim() || "refreshing the agenda candidate list before setting an agenda"}`,
    payload: {},
  }));
}

/** Call a meeting on an agenda a person chose. */
export async function conveneAction(_prev: ControlResult | null, formData: FormData): Promise<ControlResult> {
  const operator = await currentOperator();
  if (!operator) return UNAUTHORIZED;
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
  const n = agenda.length + advisory.length;
  return done(await submitCommand({
    kind: "convene",
    run_id: f.run_id ?? "",
    reason: `${operator}: convening a review of ${n} ${n === 1 ? "matter" : "matters"}`,
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
  const operator = await currentOperator();
  if (!operator) return UNAUTHORIZED;
  const f = fieldsOf(formData);
  const respondedTo = formData
    .getAll("responded_to")
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  return done(await submitCommand({
    kind: "attest",
    run_id: f.run_id ?? "",
    reason: `${operator}: attesting to ${f.decision_id ?? "a decision"}`,
    payload: {
      decision_id: f.decision_id ?? "",
      // Overwritten by bindActor below as well; set here so the shape is complete.
      actor: operator,
      source: "dashboard_session",
      outcome: f.outcome ?? "",
      rationale: f.rationale ?? "",
      ...(respondedTo.length ? { responded_to: respondedTo } : {}),
      // A review takes effect when its last matter is signed; the worker reports "waiting" until then.
      apply: true,
    },
  }));
}

/** Put a matter in front of the committee. It becomes a ranked candidate; a person decides when it is heard. */
export async function submitItemAction(_prev: ControlResult | null, formData: FormData): Promise<ControlResult> {
  const operator = await currentOperator();
  if (!operator) return UNAUTHORIZED;
  const f = fieldsOf(formData);
  const details = detailsFromFields(formData.entries());
  return done(await submitCommand({
    kind: "submit",
    run_id: f.run_id ?? "",
    reason: `${operator}: submitting "${(f.title ?? "").slice(0, 80)}" for review`,
    payload: {
      kind: f.kind ?? "",
      title: f.title ?? "",
      description: f.description ?? "",
      submitted_by: operator,
      ...(f.risk_tier ? { risk_tier: f.risk_tier } : {}),
      ...(Object.keys(details).length ? { details } : {}),
    },
  }));
}

/** Rewrite one member's brief. The worker logs it as an intervention, because it changes how the member argues. */
export async function setBriefAction(_prev: ControlResult | null, formData: FormData): Promise<ControlResult> {
  const operator = await currentOperator();
  if (!operator) return UNAUTHORIZED;
  const f = fieldsOf(formData);
  return done(await submitCommand({
    kind: "set_brief",
    run_id: f.run_id ?? "",
    reason: `${operator}: ${f.reason ?? ""}`,
    payload: { seat: f.seat ?? "", brief: f.brief ?? "", why: f.reason ?? "", actor: operator, source: "dashboard_session" },
  }));
}

/** Every configuration change goes through here, so every one carries the session's name and a reason. */
async function configure(operator: string, runId: string, kind: string, why: string, payload: Record<string, unknown>): Promise<ControlResult> {
  return done(await submitCommand(bindActor({ kind, run_id: runId, reason: `${operator}: ${why}`, payload: { ...payload, why } }, operator)));
}

/** Add a customer. The worker creates its committee; it shows in the picker once that is done. */
export async function createCustomerAction(_prev: ControlResult | null, formData: FormData): Promise<ControlResult> {
  const operator = await currentOperator();
  if (!operator) return UNAUTHORIZED;
  const f = fieldsOf(formData);
  const optional = Object.fromEntries(
    (["facts", "framework", "business_goals", "ai_landscape", "ai_tools"] as const).filter((k) => f[k]?.trim()).map((k) => [k, f[k]]),
  );
  return done(await submitWorkspace({
    reason: `${operator}: adding ${(f.name ?? "a customer").slice(0, 80)} as a customer`,
    payload: { name: f.name ?? "", risk_appetite: f.risk_appetite ?? "", ...optional, actor: operator, source: "dashboard_session" },
  }));
}

export async function updateProfileAction(_prev: ControlResult | null, formData: FormData): Promise<ControlResult> {
  const operator = await currentOperator();
  if (!operator) return UNAUTHORIZED;
  const f = fieldsOf(formData);
  return configure(operator, f.run_id ?? "", "update_profile", f.why ?? "", { changes: { [f.field ?? ""]: f.value ?? "" } });
}

export async function addDocumentAction(_prev: ControlResult | null, formData: FormData): Promise<ControlResult> {
  const operator = await currentOperator();
  if (!operator) return UNAUTHORIZED;
  const body = formData.get("body");
  const f = fieldsOf(formData);
  return configure(operator, f.run_id ?? "", "add_document", f.why ?? "",
    { kind: f.kind ?? "", title: f.title ?? "", body: typeof body === "string" ? body : "" });
}

export async function retireDocumentAction(_prev: ControlResult | null, formData: FormData): Promise<ControlResult> {
  const operator = await currentOperator();
  if (!operator) return UNAUTHORIZED;
  const f = fieldsOf(formData);
  return configure(operator, f.run_id ?? "", "retire_document", f.why ?? "", { document_id: f.document_id ?? "" });
}

export async function setPanelAction(_prev: ControlResult | null, formData: FormData): Promise<ControlResult> {
  const operator = await currentOperator();
  if (!operator) return UNAUTHORIZED;
  const f = fieldsOf(formData);
  const seats = formData.getAll("seat").filter((v): v is string => typeof v === "string");
  return configure(operator, f.run_id ?? "", "set_panel", f.why ?? "", { kind: f.kind ?? "", seats });
}

export async function setBudgetAction(_prev: ControlResult | null, formData: FormData): Promise<ControlResult> {
  const operator = await currentOperator();
  if (!operator) return UNAUTHORIZED;
  const f = fieldsOf(formData);
  return done(await submitCommand(bindActor({
    kind: "set_spend_cap", run_id: f.run_id ?? "", reason: `${operator}: ${f.why ?? ""}`,
    payload: { usd_per_sim_month: Number(f.usd) },
  }, operator)));
}
