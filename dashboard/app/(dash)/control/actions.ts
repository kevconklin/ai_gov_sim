"use server";

import { revalidatePath } from "next/cache";
import { hasValidSession } from "@/lib/auth/session";
import { commandFromForm } from "@/lib/control/schema";
import { submitCommand, submitIntervention, type ControlResult } from "@/lib/control/submit";

const MAX_FIELD = 4000;

function fieldsOf(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    if (typeof v === "string" && !k.startsWith("$")) out[k] = v.slice(0, MAX_FIELD);
  }
  return out;
}

const UNAUTHORIZED: ControlResult = { success: false, data: null, error: "Your session has expired. Sign in again." };

export async function commandAction(_prev: ControlResult | null, formData: FormData): Promise<ControlResult> {
  if (!(await hasValidSession())) return UNAUTHORIZED;
  const result = await submitCommand(commandFromForm(fieldsOf(formData)));
  if (result.success) revalidatePath("/control");
  return result;
}

export async function interventionAction(_prev: ControlResult | null, formData: FormData): Promise<ControlResult> {
  if (!(await hasValidSession())) return UNAUTHORIZED;
  const f = fieldsOf(formData);
  const result = await submitIntervention({ run_id: f.run_id ? f.run_id : null, kind: f.kind ?? "", reason: f.reason ?? "" });
  if (result.success) revalidatePath("/control");
  return result;
}
