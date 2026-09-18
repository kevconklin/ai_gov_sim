import { z } from "zod";
import { EVENT_TYPES } from "@/lib/constants";

export const COMMAND_KINDS = [
  "start",
  "pause",
  "resume",
  "stop",
  "advance",
  "inject_event",
  "fork",
  "set_spend_cap",
  "candidates",
  "convene",
  "attest",
] as const;
export type CommandKind = (typeof COMMAND_KINDS)[number];

export const INTERVENTION_KINDS = ["note", "model_change", "param_change", "prompt_edit", "other"] as const;

const reason = z
  .string()
  .trim()
  .min(10, "Reason must be at least 10 characters.")
  .max(2000, "Reason must be at most 2000 characters.");

const runId = z.string().trim().min(1, "Choose a run.").max(200);

export const injectEventSchema = z
  .object({
    event_type: z.enum(EVENT_TYPES),
    severity: z.enum(["low", "medium", "high"]),
    notes: z.string().trim().min(1, "Notes are required.").max(2000),
  })
  .strict();

const empty = z.object({}).strict();

export const agendaItemSchema = z
  .object({
    item_id: z.string().trim().min(1).max(60),
    kind: z.enum(["use_case", "policy_edit", "status_change", "advisory"]),
    title: z.string().trim().min(1).max(400),
    ref_id: z.string().trim().min(1).max(400).optional(),
  })
  .strict();

export const commandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("start"), run_id: runId, reason, payload: empty }).strict(),
  z.object({ kind: z.literal("pause"), run_id: runId, reason, payload: empty }).strict(),
  z.object({ kind: z.literal("resume"), run_id: runId, reason, payload: empty }).strict(),
  z.object({ kind: z.literal("stop"), run_id: runId, reason, payload: empty }).strict(),
  z
    .object({
      kind: z.literal("advance"),
      run_id: runId,
      reason,
      payload: z.object({ months: z.number().int().min(1).max(12) }).strict(),
    })
    .strict(),
  z.object({ kind: z.literal("inject_event"), run_id: runId, reason, payload: injectEventSchema }).strict(),
  z
    .object({
      kind: z.literal("fork"),
      run_id: runId,
      reason,
      payload: z
        .object({
          from_month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM."),
          inject_event: injectEventSchema.optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("set_spend_cap"),
      run_id: runId,
      reason,
      payload: z.object({ usd_per_sim_month: z.number().positive().finite().max(1_000_000) }).strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("candidates"),
      run_id: runId,
      reason,
      payload: z
        .object({ today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.").optional() })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("convene"),
      run_id: runId,
      reason,
      payload: z
        .object({
          agenda: z.array(agendaItemSchema).max(40).optional(),
          advisory: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
          month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM.").optional(),
        })
        .strict()
        .refine((p) => (p.agenda?.length ?? 0) + (p.advisory?.length ?? 0) > 0, {
          message: "A meeting needs at least one agenda item or advisory question.",
        }),
    })
    .strict(),
  z
    .object({
      kind: z.literal("attest"),
      run_id: runId,
      reason,
      // The rationale minimum lives in config/attestation.yaml and is enforced by the worker,
      // so it is not repeated here. This only checks the shape.
      payload: z
        .object({
          decision_id: z.string().trim().min(1).max(400),
          actor: z.string().trim().min(1).max(200),
          outcome: z.enum(["approved", "rejected", "deferred"]),
          rationale: z.string().trim().min(1, "Write your own reasoning.").max(4000),
          responded_to: z.array(z.string().trim().min(1).max(400)).max(20).optional(),
          apply: z.boolean().optional(),
        })
        .strict(),
    })
    .strict(),
]);
export type CommandInput = z.infer<typeof commandSchema>;

export const interventionSchema = z
  .object({
    run_id: runId.nullable(),
    kind: z.enum(INTERVENTION_KINDS),
    reason,
  })
  .strict();
export type InterventionInput = z.infer<typeof interventionSchema>;

/** Flatten zod issues into user-facing messages keyed by path. */
export function issuesToMessages(error: z.ZodError): string[] {
  return error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message));
}

/**
 * Convert flat form fields into the command shape. Unknown kinds fall through
 * to zod, which rejects them.
 */
export function commandFromForm(fields: Record<string, string>): unknown {
  const kind = fields.kind ?? "";
  const base = { kind, run_id: fields.run_id ?? "", reason: fields.reason ?? "" };
  const toNum = (v: string | undefined) => (v === undefined || v.trim() === "" ? Number.NaN : Number(v));
  const event = (prefix: string) => ({
    event_type: fields[`${prefix}event_type`] ?? "",
    severity: fields[`${prefix}severity`] ?? "",
    notes: fields[`${prefix}notes`] ?? "",
  });
  switch (kind) {
    case "advance":
      return { ...base, payload: { months: toNum(fields.months) } };
    case "inject_event":
      return { ...base, payload: event("") };
    case "fork": {
      const withEvent = fields.fork_inject === "on" || fields.fork_inject === "true";
      return {
        ...base,
        payload: { from_month: fields.from_month ?? "", ...(withEvent ? { inject_event: event("fork_") } : {}) },
      };
    }
    case "set_spend_cap":
      return { ...base, payload: { usd_per_sim_month: toNum(fields.usd_per_sim_month) } };
    default:
      return { ...base, payload: {} };
  }
}
