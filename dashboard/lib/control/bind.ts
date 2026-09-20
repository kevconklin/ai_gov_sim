/**
 * Stamp what a person does with the identity of the session doing it.
 *
 * An attestation is the record that a named person is accountable for a decision, and a
 * configuration change is the record of who shaped the committee that advised them. Neither
 * name can come from the request body: anyone holding a session could otherwise put any name
 * on it. Whatever `actor` a caller sends is discarded. `source` records how the name was
 * established, so a reader is not left assuming it was verified.
 *
 * Other command kinds pass through untouched. Pure, so it can be unit tested.
 */
export const ATTRIBUTED_KINDS = ["attest", "set_brief", "update_profile", "add_document", "retire_document", "set_panel", "set_spend_cap", "add_seat", "remove_seat", "update_seat"] as const;

export function bindActor(input: Record<string, unknown>, operator: string | null): Record<string, unknown> {
  if (!operator || !(ATTRIBUTED_KINDS as readonly unknown[]).includes(input.kind)) return input;
  const payload = typeof input.payload === "object" && input.payload !== null ? input.payload : {};
  return { ...input, payload: { ...payload, actor: operator, source: "dashboard_session" } };
}
