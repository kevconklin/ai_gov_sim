import { NextResponse } from "next/server";
import { sameOrigin } from "@/lib/auth/origin";
import { currentOperator, hasValidSession } from "@/lib/auth/session";
import { bindActor } from "@/lib/control/bind";
import { commandResult } from "@/lib/control/result";
import { submitCommand, submitIntervention, type ControlResult } from "@/lib/control/submit";

const MAX_BODY_BYTES = 16_000;

function reply(result: ControlResult, okStatus = 201): NextResponse {
  return NextResponse.json(result, { status: result.success ? okStatus : 400 });
}

function error(status: number, message: string): NextResponse {
  return NextResponse.json({ success: false, data: null, error: message }, { status });
}

/**
 * POST /api/control
 * Body: { "type": "command", "kind", "run_id", "reason", "payload" }
 *    or { "type": "intervention", "run_id" | null, "kind", "reason" }
 * Inserts only into commands (status pending) and interventions (source dashboard).
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return error(403, "Cross-origin request refused.");
  if (!(await hasValidSession())) return error(401, "Unauthorized");
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) return error(415, "Use application/json.");

  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return error(413, "Body too large.");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return error(400, "Body is not valid JSON.");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return error(400, "Body must be a JSON object.");

  const { type, ...rest } = body as Record<string, unknown>;
  if (type === "intervention") return reply(await submitIntervention(rest));
  if (type === "command" || type === undefined) return reply(await submitCommand(bindActor(rest, await currentOperator())));
  return error(400, "type must be 'command' or 'intervention'.");
}


/**
 * GET /api/control?command=<id>
 * Reads one queued command and its result. Governance commands (candidates, convene, attest)
 * are answered by the worker, so callers POST the command and poll this for the outcome.
 */
export async function GET(request: Request) {
  if (!(await hasValidSession())) return error(401, "Unauthorized");
  const commandId = new URL(request.url).searchParams.get("command") ?? "";
  const result = await commandResult(commandId);
  return NextResponse.json(result, { status: result.success ? 200 : 404 });
}
