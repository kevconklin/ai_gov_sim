"use server";

import { revalidatePath } from "next/cache";
import { atLeast, isOperator, orgRole } from "@/lib/auth/access";
import { currentOperator, hasValidSession } from "@/lib/auth/session";
import type { OrgRole } from "@/lib/auth/users";
import { bindActor } from "@/lib/control/bind";
import { submitCommand, submitWorkspace, type ControlResult } from "@/lib/control/submit";
import { detailsFromFields } from "@/lib/reviews/model";

const MAX_FIELD = 4000;
const UNAUTHORIZED: ControlResult = { success: false, data: null, error: "Your session has expired. Sign in again." };
const FORBIDDEN: Record<OrgRole, string> = {
  asks: "You are not a member of this organization.",
  decides: "Only someone who decides for this organization can do this.",
  runs: "Only someone who runs this organization can do this.",
};

/** The fence every write goes through: a signed-in account with at least `need` in this organization. */
async function allowed(runId: string, need: OrgRole): Promise<ControlResult | null> {
  if (!(await currentOperator())) return UNAUTHORIZED;
  if (!runId) return { success: false, data: null, error: "No organization was named." };
  return atLeast(await orgRole(runId), need) ? null : { success: false, data: null, error: FORBIDDEN[need] };
}

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
  const denied = await allowed(f.run_id ?? "", "decides");
  if (denied) return denied;
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
  const denied = await allowed(f.run_id ?? "", "decides");
  if (denied) return denied;
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
  const denied = await allowed(f.run_id ?? "", "decides");
  if (denied) return denied;
  const respondedTo = formData
    .getAll("responded_to")
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  const attested = await submitCommand({
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
  });
  // sent back with "convene now": the worker runs commands in order, so the matter is waiting again before this runs
  if (attested.success && f.outcome === "deferred" && f.convene_now === "1" && f.agenda_item) {
    let item: { item_id: string; kind: string; title: string; ref_id: string } | null = null;
    try { item = JSON.parse(f.agenda_item); } catch { item = null; }
    if (item?.ref_id) {
      await submitCommand({
        kind: "convene", run_id: f.run_id ?? "", reason: `${operator}: another look at ${item.item_id}, with their note`,
        payload: { agenda: [{ item_id: item.item_id, kind: "item", title: item.title, ref_id: item.ref_id }] },
      });
    }
  }
  return done(attested);
}

/** Put a matter in front of the committee. It becomes a ranked candidate; a person decides when it is heard. */
export async function submitItemAction(_prev: ControlResult | null, formData: FormData): Promise<ControlResult> {
  const operator = await currentOperator();
  if (!operator) return UNAUTHORIZED;
  const f = fieldsOf(formData);
  const denied = await allowed(f.run_id ?? "", "asks");
  if (denied) return denied;
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
  const denied = await allowed(f.run_id ?? "", "runs");
  if (denied) return denied;
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
  if (!(await isOperator())) return { success: false, data: null, error: "Only an operator can set up a new organization." };
  const f = fieldsOf(formData);
  const optional = Object.fromEntries(
    (["facts", "framework", "business_goals", "ai_landscape", "ai_tools", "starter"] as const).filter((k) => f[k]?.trim()).map((k) => [k, f[k]]),
  );
  const json = (name: string): unknown => {
    try { return f[name] ? JSON.parse(f[name]!) : undefined; } catch { return undefined; }
  };
  const firstMatters = json("first_matters");
  const answers = json("answers");
  return done(await submitWorkspace({
    reason: `${operator}: adding ${(f.name ?? "a customer").slice(0, 80)} as a customer`,
    payload: {
      name: f.name ?? "", risk_appetite: f.risk_appetite ?? "", ...optional,
      ...(Array.isArray(firstMatters) && firstMatters.length ? { first_matters: firstMatters } : {}),
      ...(answers && typeof answers === "object" ? { answers } : {}),
      actor: operator, source: "dashboard_session",
    },
  }));
}

export async function updateProfileAction(_prev: ControlResult | null, formData: FormData): Promise<ControlResult> {
  const operator = await currentOperator();
  if (!operator) return UNAUTHORIZED;
  const f = fieldsOf(formData);
  const denied = await allowed(f.run_id ?? "", "runs");
  if (denied) return denied;
  return configure(operator, f.run_id ?? "", "update_profile", f.why ?? "", { changes: { [f.field ?? ""]: f.value ?? "" } });
}

export async function addDocumentAction(_prev: ControlResult | null, formData: FormData): Promise<ControlResult> {
  const operator = await currentOperator();
  if (!operator) return UNAUTHORIZED;
  const body = formData.get("body");
  const f = fieldsOf(formData);
  const denied = await allowed(f.run_id ?? "", "runs");
  if (denied) return denied;
  return configure(operator, f.run_id ?? "", "add_document", f.why ?? "",
    { kind: f.kind ?? "", title: f.title ?? "", body: typeof body === "string" ? body : "" });
}

export async function retireDocumentAction(_prev: ControlResult | null, formData: FormData): Promise<ControlResult> {
  const operator = await currentOperator();
  if (!operator) return UNAUTHORIZED;
  const f = fieldsOf(formData);
  const denied = await allowed(f.run_id ?? "", "runs");
  if (denied) return denied;
  return configure(operator, f.run_id ?? "", "retire_document", f.why ?? "", { document_id: f.document_id ?? "" });
}

export async function setPanelAction(_prev: ControlResult | null, formData: FormData): Promise<ControlResult> {
  const operator = await currentOperator();
  if (!operator) return UNAUTHORIZED;
  const f = fieldsOf(formData);
  const denied = await allowed(f.run_id ?? "", "runs");
  if (denied) return denied;
  const seats = formData.getAll("seat").filter((v): v is string => typeof v === "string");
  return configure(operator, f.run_id ?? "", "set_panel", f.why ?? "", { kind: f.kind ?? "", seats });
}

export async function setBudgetAction(_prev: ControlResult | null, formData: FormData): Promise<ControlResult> {
  const operator = await currentOperator();
  if (!operator) return UNAUTHORIZED;
  const f = fieldsOf(formData);
  const denied = await allowed(f.run_id ?? "", "runs");
  if (denied) return denied;
  return done(await submitCommand(bindActor({
    kind: "set_spend_cap", run_id: f.run_id ?? "", reason: `${operator}: ${f.why ?? ""}`,
    payload: { usd_per_sim_month: Number(f.usd) },
  }, operator)));
}

/** A seat's text fields plus its model and leaning, as the forms send them. */
function seatChanges(f: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (f.title !== undefined) out.title = f.title;
  if (f.name !== undefined && f.name.trim()) out.name = f.name;
  if (f.stance !== undefined && f.stance !== "") out.stance_baseline = Number(f.stance);
  if (f.model !== undefined) out.model = f.model;
  return out;
}

export async function addSeatAction(_prev: ControlResult | null, formData: FormData): Promise<ControlResult> {
  const operator = await currentOperator();
  if (!operator) return UNAUTHORIZED;
  const f = fieldsOf(formData);
  const denied = await allowed(f.run_id ?? "", "runs");
  if (denied) return denied;
  return configure(operator, f.run_id ?? "", "add_seat", f.why ?? "", {
    seat: (f.title ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40),
    title: f.title ?? "", brief: f.brief ?? "",
    ...(f.name?.trim() ? { name: f.name } : {}),
    ...(f.stance ? { stance_baseline: Number(f.stance) } : {}),
    ...(f.model ? { model: f.model } : {}),
  });
}

export async function updateSeatAction(_prev: ControlResult | null, formData: FormData): Promise<ControlResult> {
  const operator = await currentOperator();
  if (!operator) return UNAUTHORIZED;
  const f = fieldsOf(formData);
  const denied = await allowed(f.run_id ?? "", "runs");
  if (denied) return denied;
  return configure(operator, f.run_id ?? "", "update_seat", f.why ?? "", { seat: f.seat ?? "", changes: seatChanges(f) });
}

export async function removeSeatAction(_prev: ControlResult | null, formData: FormData): Promise<ControlResult> {
  const operator = await currentOperator();
  if (!operator) return UNAUTHORIZED;
  const f = fieldsOf(formData);
  const denied = await allowed(f.run_id ?? "", "runs");
  if (denied) return denied;
  return configure(operator, f.run_id ?? "", "remove_seat", f.why ?? "", { seat: f.seat ?? "" });
}

/** Ask the policy. One model call on the worker; the answer lands on /ask when it is done. */
export async function askPolicyAction(_prev: ControlResult | null, formData: FormData): Promise<ControlResult> {
  const operator = await currentOperator();
  if (!operator) return UNAUTHORIZED;
  const f = fieldsOf(formData);
  const denied = await allowed(f.run_id ?? "", "asks");
  if (denied) return denied;
  const result = await submitCommand(bindActor({
    kind: "ask", run_id: f.run_id ?? "", reason: `${operator}: asked the policy a question`, payload: { question: f.question ?? "" },
  }, operator));
  if (result.success) revalidatePath("/ask");
  return result;
}

/** Send a question the policy could not answer to the committee. It joins Waiting; the person still convenes. */
export async function escalateAskAction(_prev: ControlResult | null, formData: FormData): Promise<ControlResult> {
  const operator = await currentOperator();
  if (!operator) return UNAUTHORIZED;
  const f = fieldsOf(formData);
  const denied = await allowed(f.run_id ?? "", "asks");
  if (denied) return denied;
  const result = await submitCommand(bindActor({
    kind: "escalate_ask", run_id: f.run_id ?? "", reason: `${operator}: sent a question to the committee`, payload: { ask_id: f.ask_id ?? "" },
  }, operator));
  if (result.success) { revalidatePath("/ask"); revalidatePath("/reviews"); }
  return result;
}

export async function archiveWorkspaceAction(_prev: ControlResult | null, formData: FormData): Promise<ControlResult> {
  const operator = await currentOperator();
  if (!operator) return UNAUTHORIZED;
  const f = fieldsOf(formData);
  const denied = await allowed(f.run_id ?? "", "runs");
  if (denied) return denied;
  return configure(operator, f.run_id ?? "", "archive_workspace", f.why ?? "", {});
}

export async function restoreWorkspaceAction(_prev: ControlResult | null, formData: FormData): Promise<ControlResult> {
  const operator = await currentOperator();
  if (!operator) return UNAUTHORIZED;
  const f = fieldsOf(formData);
  const denied = await allowed(f.run_id ?? "", "runs");
  if (denied) return denied;
  return configure(operator, f.run_id ?? "", "restore_workspace", f.why ?? "", {});
}
