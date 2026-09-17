export const BANKS = ["calder_ridge", "tollgate"] as const;
export type BankId = (typeof BANKS)[number];

export const BANK_LABELS: Record<string, string> = {
  calder_ridge: "Calder Ridge",
  tollgate: "Tollgate",
};

export const BANK_COLORS: Record<string, string> = {
  calder_ridge: "var(--c-bank-a)",
  tollgate: "var(--c-bank-b)",
};

export const SEATS = [
  "coo_chair",
  "cio",
  "ciso",
  "general_counsel",
  "cro",
  "cfo",
  "head_consumer_lending",
  "head_marketing",
] as const;
export type Seat = (typeof SEATS)[number];

export const SEAT_LABELS: Record<string, string> = {
  coo_chair: "COO (Chair)",
  cio: "CIO",
  ciso: "CISO",
  general_counsel: "General Counsel",
  cro: "Chief Risk Officer",
  cfo: "CFO",
  head_consumer_lending: "Head of Consumer Lending",
  head_marketing: "Head of Marketing",
};

export const USE_CASE_STATUSES = [
  "proposed",
  "approved",
  "building",
  "live",
  "paused",
  "retired",
  "rejected",
] as const;

export const EVENT_TYPES = [
  "vendor_pitch",
  "competitor_launch",
  "shadow_ai_discovery",
  "data_leak",
  "model_error",
  "complaint_wave",
  "regulator_guidance",
  "press_inquiry",
  "morale_issue",
  "key_staff_resignation",
] as const;

/**
 * Event types treated as incidents for time-to-first-high-severity-incident.
 * The events table has no explicit incident flag (reported schema gap).
 */
export const INCIDENT_EVENT_TYPES = [
  "incident",
  "data_leak",
  "model_error",
  "complaint_wave",
  "shadow_ai_discovery",
] as const;

/** Finding severities at or above an MRA. */
export const MRA_OR_WORSE = ["mra", "mria", "enforcement_referral"] as const;

export const SEVERITY_COLORS: Record<string, string> = {
  low: "var(--c-sev-low)",
  medium: "var(--c-sev-med)",
  high: "var(--c-sev-high)",
};

export const CONDITION_COLORS = ["var(--c-bank-a)", "var(--c-bank-b)", "var(--c-series-3)", "var(--c-series-4)"];
export const SERIES_COLORS = [
  "var(--c-bank-a)",
  "var(--c-bank-b)",
  "var(--c-series-3)",
  "var(--c-series-4)",
  "var(--c-series-5)",
  "var(--c-series-6)",
  "var(--c-series-7)",
  "var(--c-series-8)",
];
