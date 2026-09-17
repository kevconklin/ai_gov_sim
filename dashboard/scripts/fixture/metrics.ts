import { BANKS, MONTHS, rng, round, SEATS, type BankDef, type Insert } from "./common";
import { baseline } from "./people";

type Triple = [number, number, number];
type PerBank = Record<BankDef["bankId"], Triple>;

/** Scalar metrics (dimension ''), per bank per month. DEV FIXTURE values. */
const SCALAR: Record<string, PerBank> = {
  proposals_submitted: { calder_ridge: [1, 1, 1], tollgate: [3, 1, 0] },
  approval_rate: { calder_ridge: [1, 0, 1], tollgate: [1, 0.5, 1] },
  time_to_decision_days: { calder_ridge: [21, 18, 26], tollgate: [9, 11, 8] },
  time_to_production_months: { calder_ridge: [0, 0, 2], tollgate: [0, 1, 2] },
  high_risk_share: { calder_ridge: [0, 0, 0], tollgate: [0, 0.5, 0.5] },
  unanimity_rate: { calder_ridge: [0.5, 0, 0.5], tollgate: [0.25, 0, 0.67] },
  reversal_count: { calder_ridge: [0, 0, 0], tollgate: [0, 0, 2] },
  policy_word_count: { calder_ridge: [132, 238, 302], tollgate: [96, 118, 171] },
  control_count: { calder_ridge: [4, 9, 12], tollgate: [2, 3, 5] },
  controls_added: { calder_ridge: [4, 5, 4], tollgate: [2, 1, 2] },
  controls_removed: { calder_ridge: [0, 0, 1], tollgate: [0, 0, 0] },
  readability_grade: { calder_ridge: [13.1, 13.5, 13.9], tollgate: [11.9, 12.3, 12.7] },
  policy_similarity_cross_bank: { calder_ridge: [0.61, 0.52, 0.49], tollgate: [0.61, 0.52, 0.49] },
  ai_revenue_monthly: { calder_ridge: [0, 0, 27_840], tollgate: [0, 58_310, 143_920] },
  ai_spend_cumulative: { calder_ridge: [220_000, 470_000, 690_000], tollgate: [410_000, 980_000, 1_370_000] },
  roi_cumulative: { calder_ridge: [-1, -1, -0.96], tollgate: [-1, -0.94, -0.85] },
  effort_overrun_pct: { calder_ridge: [0, 12.5, 18.2], tollgate: [0, 31.4, 47.9] },
  enforcement_flag: { calder_ridge: [0, 0, 0], tollgate: [0, 0, 0] },
  complaint_rate: { calder_ridge: [3.9, 3.8, 3.7], tollgate: [4.1, 5.4, 9.8] },
  shadow_ai_rate: { calder_ridge: [0.07, 0.065, 0.06], tollgate: [0.11, 0.14, 0.17] },
  suspicion_rate: { calder_ridge: [0, 0, 0.021], tollgate: [0, 0, 0] },
  cost_usd: { calder_ridge: [8.41, 9.87, 11.02], tollgate: [9.12, 11.64, 13.35] },
  tokens_input: { calder_ridge: [1_412_300, 1_588_900, 1_702_450], tollgate: [1_503_870, 1_690_120, 1_866_040] },
  tokens_cached: { calder_ridge: [902_110, 1_121_400, 1_240_700], tollgate: [955_300, 1_180_220, 1_321_990] },
  tokens_output: { calder_ridge: [88_240, 97_310, 104_560], tollgate: [93_780, 109_400, 121_030] },
  wall_clock_minutes_per_sim_month: { calder_ridge: [45.2, 50.9, 58.2], tollgate: [51.8, 57.6, 64.8] },
};

const DIMENSIONED: Record<string, Record<string, PerBank>> = {
  use_cases_live: {
    low: { calder_ridge: [0, 0, 1], tollgate: [0, 1, 0] },
    medium: { calder_ridge: [0, 0, 0], tollgate: [0, 0, 0] },
    high: { calder_ridge: [0, 0, 0], tollgate: [0, 1, 1] },
    total: { calder_ridge: [0, 0, 1], tollgate: [0, 2, 1] },
  },
  incidents: {
    low: { calder_ridge: [0, 1, 0], tollgate: [1, 2, 1] },
    medium: { calder_ridge: [0, 0, 0], tollgate: [0, 1, 1] },
    high: { calder_ridge: [0, 0, 0], tollgate: [0, 0, 1] },
  },
  findings: {
    observation: { calder_ridge: [0, 1, 0], tollgate: [0, 0, 1] },
    mra: { calder_ridge: [0, 0, 0], tollgate: [0, 0, 1] },
    mria: { calder_ridge: [0, 0, 0], tollgate: [0, 0, 0] },
    enforcement_referral: { calder_ridge: [0, 0, 0], tollgate: [0, 0, 0] },
  },
  framework_mentions: {
    sr_11_7: { calder_ridge: [1, 3, 4], tollgate: [0, 0, 2] },
    nist_ai_rmf: { calder_ridge: [0, 2, 2], tollgate: [0, 1, 1] },
    iso_42001: { calder_ridge: [0, 0, 1], tollgate: [0, 0, 0] },
    eu_ai_act: { calder_ridge: [0, 0, 0], tollgate: [1, 0, 0] },
  },
};

const SEAT_METRICS = [
  "dissent_by_seat", "speaking_share", "stance_score", "stance_drift", "influence", "position_shift_rate",
  "type_token_ratio", "ngram_repeat_rate", "catchphrase_alerts", "objection_count", "false_outcome_claims",
] as const;

function seatValue(metric: (typeof SEAT_METRICS)[number], bank: BankDef, seat: string, i: number, r: () => number): number {
  const base = baseline(bank, seat as (typeof SEATS)[number]);
  const drift = (3 - base) * 0.06 * i;
  switch (metric) {
    case "dissent_by_seat": return round(base < 2.5 ? 0.3 + r() * 0.3 : r() * 0.2, 3);
    case "speaking_share": return round((seat === "coo_chair" ? 0.17 : 0.1) + r() * 0.04, 3);
    case "stance_score": return round(base + drift + (r() - 0.5) * 0.2, 2);
    case "stance_drift": return round(drift + (r() - 0.5) * 0.2, 2);
    case "influence": return round(0.4 + r() * 0.4, 3);
    case "position_shift_rate": return round(r() * 0.25, 3);
    case "type_token_ratio": return round(0.58 - i * 0.03 - (seat === "head_marketing" && bank.bankId === "tollgate" ? 0.08 : 0) + r() * 0.03, 3);
    case "ngram_repeat_rate": return i === 0 ? 0 : round(0.04 + i * 0.03 + (seat === "head_marketing" && bank.bankId === "tollgate" ? 0.12 : 0), 3);
    case "catchphrase_alerts": return seat === "head_marketing" && bank.bankId === "tollgate" && i >= 1 ? 1 : 0;
    case "objection_count": return seat === "general_counsel" ? 1 + i : seat === "ciso" && bank.bankId === "tollgate" ? 1 : 0;
    case "false_outcome_claims": return seat === "head_consumer_lending" && bank.bankId === "tollgate" && i === 2 ? 2 : seat === "head_marketing" && i === 2 ? 1 : 0;
  }
}

export const ALL_METRIC_NAMES = [...Object.keys(SCALAR), ...Object.keys(DIMENSIONED), ...SEAT_METRICS];

export function seedMetrics(insert: Insert): void {
  for (const bank of BANKS) {
    const r = rng(bank.bankId === "tollgate" ? 31 : 13);
    MONTHS.forEach((month, i) => {
      const put = (metric: string, dimension: string, value: number) =>
        insert("metrics", { run_id: bank.runId, bank_id: bank.bankId, sim_month: month, metric, dimension, value });
      for (const [metric, v] of Object.entries(SCALAR)) put(metric, "", v[bank.bankId][i]!);
      for (const [metric, dims] of Object.entries(DIMENSIONED)) {
        for (const [dim, v] of Object.entries(dims)) put(metric, dim, v[bank.bankId][i]!);
      }
      for (const metric of SEAT_METRICS) {
        for (const seat of SEATS) put(metric, seat, seatValue(metric, bank, seat, i, r));
      }
    });
  }
}
