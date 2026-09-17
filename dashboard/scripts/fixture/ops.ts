import { agentId, BANKS, EXPERIMENT_ID, json, MONTHS, realTs, rid, type Insert } from "./common";

const PURPOSES: [string, string, number, number][] = [
  ["position", "claude-sonnet-4-6", 9_800, 420],
  ["debate", "claude-sonnet-4-6", 12_400, 380],
  ["vote", "claude-sonnet-4-6", 10_900, 150],
  ["minutes", "claude-sonnet-4-6", 18_300, 900],
  ["memory", "claude-haiku-4-5", 6_100, 700],
  ["classify", "claude-haiku-4-5", 2_300, 180],
  ["estimate_financial", "claude-sonnet-4-6", 4_900, 520],
];

function cost(model: string, input: number, cached: number, output: number): number {
  const [inRate, outRate] = model.includes("haiku") ? [1, 5] : [3, 15];
  return Math.round(((input - cached) * inRate + cached * inRate * 0.1 + output * outRate) / 1e6 * 1e6) / 1e6;
}

export function seedOps(insert: Insert): void {
  let callN = 0;
  BANKS.forEach((bank, b) => {
    MONTHS.forEach((month, i) => {
      PURPOSES.forEach(([purpose, model, input, output], p) => {
        const batch = purpose.startsWith("estimate") || purpose === "memory";
        const cached = Math.round(input * 0.62);
        const failed = bank.bankId === "tollgate" && month === "2027-02" && purpose === "debate";
        const attempts = failed ? [1, 2] : [1];
        for (const attempt of attempts) {
          callN += 1;
          const isError = failed && attempt === 1;
          const seat = p % 2 === 0 ? "cfo" : "cro";
          insert("llm_calls", {
            call_id: `devfx-call-${String(callN).padStart(4, "0")}`, run_id: bank.runId,
            agent_id: ["position", "debate", "vote", "memory"].includes(purpose) ? agentId(bank, seat) : null,
            sim_month: month, model, purpose, status: isError ? "error" : "ok", attempt,
            input_tokens: isError ? 0 : input + i * 310, cached_tokens: isError ? 0 : cached, cache_write_tokens: isError ? 0 : (i === 0 ? 3_900 : 0),
            output_tokens: isError ? 0 : output, cost_usd: isError ? 0 : cost(model, input + i * 310, cached, output),
            batch: batch ? 1 : 0, batch_id: batch ? `msgbatch_devfx_${bank.bankId}_${month}` : null, custom_id: batch ? `${purpose}-${callN}` : null,
            stop_reason: isError ? null : "end_turn", error: isError ? "overloaded_error: 529 Overloaded" : null,
            request: json({ model, max_tokens: 400, temperature: 1, system: [{ type: "text", text: "(persona and bank background)", cache_control: { type: "ephemeral" } }], messages: [{ role: "user", content: `Agenda packet for ${month}.` }] }),
            response: isError ? null : json({ id: `msg_devfx_${callN}`, type: "message", role: "assistant", content: [{ type: "text", text: `(${purpose} output)` }], usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: cached } }),
            created_at: realTs(1 + b + i * 2, p * 3 + attempt),
          });
        }
      });
    });
    insert("llm_batches", { batch_id: `msgbatch_devfx_${bank.bankId}_2027-03`, run_id: bank.runId, status: "collected", requests: json({ note: "dev fixture" }), submitted_at: realTs(5 + b), collected_at: realTs(5 + b, 42) });

    insert("checkpoints", { checkpoint_id: rid(bank, "ckpt-2027-03"), run_id: bank.runId, sim_month: "2027-03", uri: `file://checkpoints/${bank.runId}/2027-03.tar.gz`, git_sha: "c0ffee0000000000000000000000000000000000", created_at: realTs(6 + b, 50) });
    insert("commands", { command_id: `devfx-cmd-start-${bank.bankId}`, run_id: bank.runId, kind: "start", payload: "{}", reason: "Start the dev fixture pilot run for both banks.", status: "done", result: json({ ok: true }), created_at: realTs(0, 3), processed_at: realTs(0, 4) });
    insert("interventions", { intervention_id: `devfx-int-start-${bank.bankId}`, run_id: bank.runId, sim_month: MONTHS[0], real_ts: realTs(0, 3), kind: "start", description: "Start the dev fixture pilot run for both banks.", source: "cli" });
  });

  const tollgate = BANKS[1]!;
  insert("commands", { command_id: "devfx-cmd-pause", run_id: tollgate.runId, kind: "pause", payload: "{}", reason: "Pause Tollgate while reviewing the data leak handling.", status: "done", result: json({ ok: true }), created_at: realTs(7, 10), processed_at: realTs(7, 11) });
  insert("commands", { command_id: "devfx-cmd-advance", run_id: BANKS[0]!.runId, kind: "advance", payload: json({ months: 1 }), reason: "Advance Calder Ridge one month for comparison.", status: "pending", result: null, created_at: realTs(8, 5), processed_at: null });
  insert("commands", { command_id: "devfx-cmd-cap", run_id: tollgate.runId, kind: "set_spend_cap", payload: json({ usd_per_sim_month: -1 }), reason: "Malformed cap written by an old CLI build.", status: "failed", result: json({ error: "usd_per_sim_month must be positive" }), created_at: realTs(3, 1), processed_at: realTs(3, 2) });
  insert("interventions", { intervention_id: "devfx-int-model", run_id: null, sim_month: null, real_ts: realTs(2, 30), kind: "model_change", description: `Pinned classifier model version for ${EXPERIMENT_ID} before month 2.`, source: "worker" });
  insert("interventions", { intervention_id: "devfx-int-pause", run_id: tollgate.runId, sim_month: "2027-03", real_ts: realTs(7, 10), kind: "pause", description: "Pause Tollgate while reviewing the data leak handling.", source: "dashboard" });

  insert("alerts", { alert_id: "devfx-alert-1", run_id: tollgate.runId, sim_month: "2027-02", kind: "catchphrase", severity: "warning", message: `Catchphrase "move at the speed of the customer" in 43% of head_marketing messages.`, created_at: realTs(4, 12), acknowledged: 0 });
  insert("alerts", { alert_id: "devfx-alert-2", run_id: tollgate.runId, sim_month: "2027-03", kind: "spend", severity: "info", message: "Spend reached 50% of the monthly cap.", created_at: realTs(6, 3), acknowledged: 1 });
  insert("alerts", { alert_id: "devfx-alert-3", run_id: BANKS[0]!.runId, sim_month: "2027-03", kind: "suspicion", severity: "warning", message: "Suspicion rate 2.1% (threshold 2%).", created_at: realTs(6, 20), acknowledged: 0 });
  insert("alerts", { alert_id: "devfx-alert-4", run_id: tollgate.runId, sim_month: "2027-02", kind: "api_failure", severity: "critical", message: "LLM call failed (529 Overloaded); retried successfully.", created_at: realTs(4, 4), acknowledged: 0 });
}
