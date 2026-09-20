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
  "submit",
  "set_brief",
  "update_profile",
  "add_document",
  "retire_document",
  "set_panel",
  "add_seat",
  "remove_seat",
  "update_seat",
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

export const FRAMEWORKS = ["nist_ai_rmf", "iso_42001", "eu_ai_act", "sr_11_7", "none"] as const;
export const DOCUMENT_KINDS = ["acceptable_use", "charter", "policy", "standard", "regulation", "other"] as const;

/** Extra facts about a matter. Free-form on purpose: what is worth knowing differs by kind. */
export const detailsSchema = z
  .record(z.string().min(1).max(60), z.union([z.string().max(2000), z.boolean(), z.array(z.string().max(100)).max(12)]))
  .refine((d) => Object.keys(d).length <= 24, { message: "Too many details." });

/** Who did it and why, stamped by the server from the session. Never trusted from the request. */
const attribution = {
  actor: z.string().trim().min(1).max(200).optional(),
  source: z.enum(["dashboard_session", "cli_asserted", "unknown"]).optional(),
  why: z.string().trim().min(10, "Say why, in at least 10 characters.").max(1000),
};

const seatId = z.string().trim().regex(/^[a-z][a-z0-9_]{1,39}$/, "Lowercase letters, digits and underscores, such as data_protection.");
/** "<provider>:<model>", or a bare id for anthropic. Whether it is on offer is the worker's call. */
const modelRef = z.string().trim().min(1).max(200);

const profileChanges = z
  .object({
    name: z.string().trim().min(2).max(200).optional(),
    risk_appetite: z.string().trim().min(20, "At least a sentence: the committee argues from it.").max(4000).optional(),
    facts: z.string().trim().max(4000).optional(),
    framework: z.enum(FRAMEWORKS).optional(),
    business_goals: z.string().trim().max(4000).optional(),
    ai_landscape: z.string().trim().max(4000).optional(),
    ai_tools: z.string().trim().max(4000).optional(),
  })
  .strict()
  .refine((c) => Object.keys(c).length > 0, { message: "Nothing to change." });

/** A new customer. The one command with no run behind it yet. */
export const workspaceSchema = z
  .object({
    reason,
    payload: z
      .object({
        name: z.string().trim().min(2, "Name the organisation.").max(200),
        risk_appetite: z.string().trim().min(20, "At least a sentence: the committee argues from it.").max(4000),
        facts: z.string().trim().max(4000).optional(),
        framework: z.enum(FRAMEWORKS).optional(),
        business_goals: z.string().trim().max(4000).optional(),
        ai_landscape: z.string().trim().max(4000).optional(),
        ai_tools: z.string().trim().max(4000).optional(),
        actor: z.string().trim().min(1).max(200),
        source: z.literal("dashboard_session"),
      })
      .strict(),
  })
  .strict();
export type WorkspaceInput = z.infer<typeof workspaceSchema>;

export const ITEM_KINDS = ["use_case", "tool", "vendor", "policy_change", "exception", "incident", "question"] as const;

export const agendaItemSchema = z
  .object({
    item_id: z.string().trim().min(1).max(60),
    kind: z.enum(["use_case", "policy_edit", "status_change", "advisory", "item"]),
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
      payload: z.object({ usd_per_sim_month: z.number().positive().finite().max(1_000_000), actor: z.string().max(200).optional(), source: z.string().max(40).optional() }).strict(),
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
          // How the actor's identity was established, for the ledger. The dashboard sets this
          // from the signed session; the CLI records that it was merely asserted.
          source: z.enum(["dashboard_session", "cli_asserted", "unknown"]).optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("submit"),
      run_id: runId,
      reason,
      payload: z
        .object({
          kind: z.enum(ITEM_KINDS),
          title: z.string().trim().min(3).max(200),
          description: z.string().trim().min(10, "Say enough for a committee to act on.").max(4000),
          submitted_by: z.string().trim().min(1).max(200),
          risk_tier: z.enum(["low", "medium", "high"]).optional(),
          details: detailsSchema.optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("set_brief"),
      run_id: runId,
      reason,
      payload: z
        .object({
          seat: z.string().trim().min(1).max(60),
          brief: z.string().trim().min(40, "A brief needs enough to argue from.").max(4000),
          ...attribution,
        })
        .strict(),
    })
    .strict(),
  z
    .object({ kind: z.literal("update_profile"), run_id: runId, reason, payload: z.object({ changes: profileChanges, ...attribution }).strict() })
    .strict(),
  z
    .object({
      kind: z.literal("add_document"),
      run_id: runId,
      reason,
      payload: z
        .object({
          kind: z.enum(DOCUMENT_KINDS),
          title: z.string().trim().min(3).max(200),
          body: z.string().trim().min(20, "Paste enough for the committee to cite.").max(60_000),
          ...attribution,
        })
        .strict(),
    })
    .strict(),
  z
    .object({ kind: z.literal("retire_document"), run_id: runId, reason, payload: z.object({ document_id: z.string().trim().min(1).max(400), ...attribution }).strict() })
    .strict(),
  z
    .object({
      kind: z.literal("set_panel"),
      run_id: runId,
      reason,
      payload: z
        .object({
          kind: z.enum(ITEM_KINDS),
          seats: z.array(z.string().trim().min(1).max(60)).min(1, "Seat at least one adviser.").max(20),
          risk_tier: z.enum(["low", "medium", "high", "*"]).optional(),
          ...attribution,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("add_seat"),
      run_id: runId,
      reason,
      payload: z
        .object({
          seat: seatId,
          title: z.string().trim().min(2).max(120),
          name: z.string().trim().max(60).optional(),
          brief: z.string().trim().min(40, "A brief needs enough to argue from.").max(4000),
          stance_baseline: z.number().min(1).max(5).optional(),
          model: modelRef.optional(),
          ...attribution,
        })
        .strict(),
    })
    .strict(),
  z
    .object({ kind: z.literal("remove_seat"), run_id: runId, reason, payload: z.object({ seat: seatId, ...attribution }).strict() })
    .strict(),
  z
    .object({
      kind: z.literal("update_seat"),
      run_id: runId,
      reason,
      payload: z
        .object({
          seat: seatId,
          changes: z
            .object({
              title: z.string().trim().min(2).max(120).optional(),
              name: z.string().trim().min(1).max(60).optional(),
              stance_baseline: z.number().min(1).max(5).optional(),
              model: z.union([modelRef, z.literal("")]).optional(), // "" returns the seat to the default model
            })
            .strict()
            .refine((c) => Object.keys(c).length > 0, { message: "Nothing to change." }),
          ...attribution,
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
