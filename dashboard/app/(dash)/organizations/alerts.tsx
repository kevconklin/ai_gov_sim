"use client";

import { useActionState } from "react";
import { acknowledgeAlertAction } from "../reviews/actions";

export function Acknowledge({ alertId }: { alertId: string }) {
  const [, action, pending] = useActionState(acknowledgeAlertAction, null);
  return (
    <form action={action}><input type="hidden" name="alert_id" value={alertId} /><button className="rv-btn rv-btn-sm" type="submit" disabled={pending}>{pending ? "…" : "Acknowledge"}</button></form>
  );
}
