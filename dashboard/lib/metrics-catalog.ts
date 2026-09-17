/** Metric names from SPEC 9.2 and how to collapse dimensions when none is chosen. */
export type DimAgg = "none" | "sum" | "mean" | "total_row";

export interface MetricDef {
  name: string;
  label: string;
  group: "decisions" | "policy" | "outcomes" | "behavior" | "operations";
  dims: readonly string[];
  agg: DimAgg;
}

const SEAT_DIMS = [
  "coo_chair",
  "cio",
  "ciso",
  "general_counsel",
  "cro",
  "cfo",
  "head_consumer_lending",
  "head_marketing",
] as const;
const SEV = ["low", "medium", "high"] as const;

function m(name: string, label: string, group: MetricDef["group"], dims: readonly string[] = [], agg: DimAgg = "none"): MetricDef {
  return { name, label, group, dims, agg };
}

export const METRICS: readonly MetricDef[] = [
  m("proposals_submitted", "Proposals submitted", "decisions"),
  m("approval_rate", "Approval rate", "decisions"),
  m("time_to_decision_days", "Time to decision (days)", "decisions"),
  m("time_to_production_months", "Time to production (months)", "decisions"),
  m("use_cases_live", "Use cases live", "decisions", [...SEV, "total"], "total_row"),
  m("high_risk_share", "High-risk share", "decisions"),
  m("unanimity_rate", "Unanimity rate", "decisions"),
  m("dissent_by_seat", "Dissent by seat", "decisions", SEAT_DIMS, "mean"),
  m("reversal_count", "Reversals", "decisions"),
  m("policy_word_count", "Policy word count", "policy"),
  m("control_count", "Control count", "policy"),
  m("controls_added", "Controls added", "policy"),
  m("controls_removed", "Controls removed", "policy"),
  m("readability_grade", "Readability grade", "policy"),
  m("framework_mentions", "Framework mentions", "policy", ["sr_11_7", "nist_ai_rmf", "iso_42001", "eu_ai_act"], "sum"),
  m("policy_similarity_cross_bank", "Policy similarity (cross-bank)", "policy"),
  m("ai_revenue_monthly", "AI revenue (monthly, USD)", "outcomes"),
  m("ai_spend_cumulative", "AI spend (cumulative, USD)", "outcomes"),
  m("roi_cumulative", "ROI (cumulative)", "outcomes"),
  m("effort_overrun_pct", "Effort overrun (%)", "outcomes"),
  m("incidents", "Incidents", "outcomes", SEV, "sum"),
  m("findings", "Findings", "outcomes", ["observation", "mra", "mria", "enforcement_referral"], "sum"),
  m("enforcement_flag", "Enforcement flag", "outcomes"),
  m("complaint_rate", "Complaints per 10k customers", "outcomes"),
  m("shadow_ai_rate", "Shadow AI rate", "outcomes"),
  m("speaking_share", "Speaking share", "behavior", SEAT_DIMS, "mean"),
  m("stance_score", "Stance score", "behavior", SEAT_DIMS, "mean"),
  m("stance_drift", "Stance drift", "behavior", SEAT_DIMS, "mean"),
  m("influence", "Influence", "behavior", SEAT_DIMS, "mean"),
  m("position_shift_rate", "Position shift rate", "behavior", SEAT_DIMS, "mean"),
  m("type_token_ratio", "Type-token ratio", "behavior", SEAT_DIMS, "mean"),
  m("ngram_repeat_rate", "5-gram repeat rate", "behavior", SEAT_DIMS, "mean"),
  m("catchphrase_alerts", "Catchphrase alerts", "behavior", SEAT_DIMS, "sum"),
  m("objection_count", "Objections", "behavior", SEAT_DIMS, "sum"),
  m("suspicion_rate", "Suspicion rate", "behavior"),
  m("false_outcome_claims", "False outcome claims", "behavior", SEAT_DIMS, "sum"),
  m("cost_usd", "Cost (USD)", "operations"),
  m("tokens_input", "Input tokens", "operations"),
  m("tokens_cached", "Cached tokens", "operations"),
  m("tokens_output", "Output tokens", "operations"),
  m("wall_clock_minutes_per_sim_month", "Wall clock min / sim month", "operations"),
];

export const METRIC_NAMES: readonly string[] = METRICS.map((d) => d.name);

export function metricDef(name: string): MetricDef | undefined {
  return METRICS.find((d) => d.name === name);
}

/** Collapse rows for one month into a single value using the metric's rule. */
export function collapseDims(def: MetricDef, rows: readonly { dimension: string; value: number | null }[], dim?: string): number | null {
  if (dim !== undefined && dim !== "") {
    return rows.find((r) => r.dimension === dim)?.value ?? null;
  }
  const values = rows.filter((r) => r.value !== null);
  if (values.length === 0) return null;
  switch (def.agg) {
    case "none":
      return values.find((r) => r.dimension === "")?.value ?? null;
    case "total_row":
      return values.find((r) => r.dimension === "total")?.value ?? null;
    case "sum":
      return values.reduce((acc, r) => acc + (r.value ?? 0), 0);
    case "mean":
      return values.reduce((acc, r) => acc + (r.value ?? 0), 0) / values.length;
  }
}
