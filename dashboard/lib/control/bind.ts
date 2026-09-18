/**
 * Stamp an attestation with the identity of the session taking it.
 *
 * An attestation is the record that a named person is accountable for a decision, so the name
 * cannot come from the request body: anyone holding a session could otherwise put any name on
 * it. Whatever `actor` a caller sends is discarded. `source` records how the name was
 * established, so a reader is not left assuming it was verified.
 *
 * Other command kinds pass through untouched. Pure, so it can be unit tested.
 */
export function bindActor(input: Record<string, unknown>, operator: string | null): Record<string, unknown> {
  if (input.kind !== "attest" || !operator) return input;
  const payload = typeof input.payload === "object" && input.payload !== null ? input.payload : {};
  return { ...input, payload: { ...payload, actor: operator, source: "dashboard_session" } };
}
