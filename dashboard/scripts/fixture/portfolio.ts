import { BANKS, json, MONTHS, rid, rng, round, type BankDef, type Insert, type Seat } from "./common";
import { activeAgent } from "./people";

export interface UseCasePlan {
  key: string;
  title: string;
  description: string;
  lob: string;
  tier: "low" | "medium" | "high";
  proposer: Seat;
  proposed: string;
  /** Committee decision; null = still proposed. */
  decision: { month: string; outcome: "approved" | "rejected"; no: Seat[]; abstain?: Seat[] } | null;
  /** Later status changes: [month, status, source]. */
  later: [string, string, "engine" | "committee"][];
  estPersonWeeks: number;
  revenuePerMonth: number;
}

export const PLANS: Record<BankDef["bankId"], UseCasePlan[]> = {
  calder_ridge: [
    {
      key: "uc1", title: "Contact center call summarization", lob: "Deposits", tier: "low", proposer: "cio",
      description: "Vendor tool drafts after-call summaries for agent review before saving to CRM.",
      proposed: "2027-01", decision: { month: "2027-01", outcome: "approved", no: ["general_counsel"] },
      later: [["2027-02", "building", "engine"], ["2027-03", "live", "engine"]], estPersonWeeks: 14, revenuePerMonth: 41_300,
    },
    {
      key: "uc2", title: "Generative marketing copy for card offers", lob: "Marketing", tier: "medium", proposer: "head_marketing",
      description: "Generate offer copy variants for direct mail and email campaigns.",
      proposed: "2027-02", decision: { month: "2027-02", outcome: "rejected", no: ["ciso", "general_counsel", "cro", "cfo", "coo_chair"] },
      later: [], estPersonWeeks: 9, revenuePerMonth: 96_800,
    },
    {
      key: "uc3", title: "Fraud alert triage assistant", lob: "Operations", tier: "medium", proposer: "cro",
      description: "Rank vendor fraud alerts and draft analyst notes; analysts make every decision.",
      proposed: "2027-03", decision: null, later: [], estPersonWeeks: 22, revenuePerMonth: 63_450,
    },
  ],
  tollgate: [
    {
      key: "uc1", title: "Credit line increase propensity model", lob: "Consumer Lending", tier: "high", proposer: "head_consumer_lending",
      description: "Model scores existing cardholders for proactive credit line increases.",
      proposed: "2027-01", decision: { month: "2027-01", outcome: "approved", no: ["ciso", "general_counsel"] },
      later: [["2027-02", "building", "engine"], ["2027-03", "live", "engine"]], estPersonWeeks: 26, revenuePerMonth: 212_700,
    },
    {
      key: "uc2", title: "Customer-facing chat assistant", lob: "Deposits", tier: "high", proposer: "head_marketing",
      description: "Generative assistant answers account questions on web and mobile.",
      proposed: "2027-01", decision: { month: "2027-01", outcome: "approved", no: ["ciso"], abstain: ["general_counsel"] },
      later: [["2027-01", "building", "engine"], ["2027-02", "live", "engine"], ["2027-03", "paused", "committee"]], estPersonWeeks: 18, revenuePerMonth: 118_900,
    },
    {
      key: "uc3", title: "Personalized cross-sell offers", lob: "Marketing", tier: "medium", proposer: "head_marketing",
      description: "Next-best-offer engine for digital banking sessions.",
      proposed: "2027-02", decision: { month: "2027-02", outcome: "approved", no: ["general_counsel", "cfo"] },
      later: [["2027-03", "building", "engine"]], estPersonWeeks: 20, revenuePerMonth: 154_200,
    },
    {
      key: "uc4", title: "Branch staffing forecast", lob: "Operations", tier: "low", proposer: "cio",
      description: "Forecast branch traffic to set teller schedules.",
      proposed: "2027-01", decision: { month: "2027-01", outcome: "approved", no: [] },
      later: [["2027-02", "live", "engine"], ["2027-03", "retired", "committee"]], estPersonWeeks: 6, revenuePerMonth: 12_050,
    },
  ],
};

export function useCaseId(bank: BankDef, plan: UseCasePlan): string {
  return rid(bank, `uc-${plan.key}`);
}

export function decisionId(bank: BankDef, plan: UseCasePlan): string {
  return rid(bank, `dec-${plan.key}`);
}

export function meetingId(bank: BankDef, month: string): string {
  return rid(bank, `mtg-${month}`);
}

function statusAt(plan: UseCasePlan): { status: string; live: string | null; retired: string | null } {
  let status = "proposed";
  if (plan.decision) status = plan.decision.outcome;
  let live: string | null = null;
  let retired: string | null = null;
  for (const [month, s] of plan.later) {
    status = s;
    if (s === "live" && !live) live = month;
    if (s === "retired") retired = month;
  }
  return { status, live, retired };
}

export function seedPortfolio(insert: Insert): void {
  for (const bank of BANKS) {
    for (const plan of PLANS[bank.bankId]) {
      const { status, live, retired } = statusAt(plan);
      const ucId = useCaseId(bank, plan);
      insert("use_cases", {
        use_case_id: ucId, run_id: bank.runId, bank_id: bank.bankId, title: plan.title, description: plan.description,
        lob: plan.lob,
        details: json({ expected_benefit: `$${plan.revenuePerMonth.toLocaleString("en-US")} per month`, vendor_or_build: plan.tier === "low" ? "vendor" : "build", est_person_weeks: plan.estPersonWeeks, customer_facing: plan.tier === "high" }),
        risk_tier: plan.tier, status, proposed_month: plan.proposed, decided_month: plan.decision?.month ?? null,
        live_month: live, retired_month: retired, proposer_agent_id: activeAgent(bank, plan.proposer, plan.proposed),
        meeting_id: meetingId(bank, plan.proposed),
      });
      let prev: string | null = null;
      const steps: [string, string, string, string | null][] = [[plan.proposed, "proposed", "committee", null]];
      if (plan.decision) steps.push([plan.decision.month, plan.decision.outcome, "committee", decisionId(bank, plan)]);
      for (const [m, s, src] of plan.later) steps.push([m, s, src, null]);
      steps.forEach(([month, to, source, dec], i) => {
        insert("use_case_history", {
          history_id: rid(bank, `uch-${plan.key}-${i}`), run_id: bank.runId, use_case_id: ucId, sim_month: month,
          from_status: prev, to_status: to, source, decision_id: dec,
        });
        prev = to;
      });
    }
  }
}

/** Engine rows need decisions to exist first (FK), so this runs after meetings. */
export function seedEngine(insert: Insert): void {
  for (const bank of BANKS) {
    const rand = rng(bank.bankId === "tollgate" ? 99 : 7);
    for (const plan of PLANS[bank.bankId]) {
      if (plan.decision?.outcome !== "approved") continue;
      const decId = decisionId(bank, plan);
      const pw = plan.estPersonWeeks;
      const rev = plan.revenuePerMonth;
      const incidentPrior = { low: 0.005, medium: 0.02, high: 0.05 }[plan.tier];
      const estimates = {
        tool_performance: { metric: "task accuracy", low: 0.71, mode: 0.82, high: 0.9 },
        effort: { person_weeks: { low: pw * 0.8, mode: pw, high: pw * 1.9 }, calendar_months: { low: 1, mode: 2, high: 4 } },
        adoption: { uptake_month_3: { low: 0.25, mode: 0.45, high: 0.7 }, training_hours: 6 },
        risk: { incident_prob_per_month: { low: incidentPrior * 0.5, mode: incidentPrior, high: incidentPrior * 2.4 }, fair_lending_exposure_change: plan.lob === "Consumer Lending" ? 8 : 0 },
        financial: { revenue_per_month: { low: rev * 0.4, mode: rev, high: rev * 1.6 }, cost_per_month: { low: 6_200, mode: 9_800, high: 17_500 } },
      };
      const overrun = plan.tier === "low" ? { dist: "lognormal", median: 1.2, sigma: 0.3 } : { dist: "lognormal", median: 1.6, sigma: 0.5 };
      insert("engine_decisions", {
        decision_id: decId, run_id: bank.runId, use_case_id: useCaseId(bank, plan), sim_month: plan.decision.month,
        classification: json({ use_case_type: plan.lob.toLowerCase().replace(/ /g, "_"), risk_tier: plan.tier, vendor_or_build: plan.tier === "low" ? "vendor_saas" : "custom_build", customer_facing: plan.tier === "high" }),
        estimates: json(estimates),
        priors: json({ effort_overrun_multiplier: overrun, incident_prob_per_month: incidentPrior, estimator_prior_weight: 0.5, placeholder: true }),
        blended: json({ person_weeks: { dist: "triangular", low: round(pw * 0.9), mode: round(pw * 1.25), high: round(pw * 2.2) }, revenue_per_month: { dist: "triangular", low: round(rev * 0.35), mode: round(rev * 0.8), high: round(rev * 1.4) }, incident_prob_per_month: round(incidentPrior * 1.1, 4) }),
        plan: json({ start_month: plan.decision.month, live_month: plan.later.find((l) => l[1] === "live")?.[0] ?? null, capacity_person_weeks_per_month: 8 }),
      });
      const draws: [string, string, Record<string, number>][] = [
        ["effort_overrun_multiplier", "lognormal", { median: overrun.median, sigma: overrun.sigma }],
        ["person_weeks", "triangular", { low: pw * 0.9, mode: pw * 1.25, high: pw * 2.2 }],
        ["revenue_per_month", "triangular", { low: rev * 0.35, mode: rev * 0.8, high: rev * 1.4 }],
        ["adoption_month_3", "triangular", { low: 0.25, mode: 0.45, high: 0.7 }],
        ["incident_fires", "bernoulli", { p: incidentPrior * 1.1 }],
      ];
      draws.forEach(([variable, dist, params], i) => {
        const r = rand();
        const value = dist === "bernoulli" ? (plan.key === "uc2" && bank.bankId === "tollgate" ? 1 : 0) : dist === "lognormal" ? round(params.median! * Math.exp((r - 0.5) * params.sigma!), 4) : round(params.low! + (params.high! - params.low!) * (0.3 + r * 0.4), 2);
        insert("engine_draws", {
          draw_id: rid(bank, `draw-${plan.key}-${i}`), run_id: bank.runId, decision_id: decId, sim_month: plan.decision!.month,
          variable, dist, params: json(params), seed: 424242 * 1000 + i * 17 + plan.key.length, value,
        });
      });
    }
    insert("engine_draws", {
      draw_id: rid(bank, "draw-events-2027-02"), run_id: bank.runId, decision_id: null, sim_month: MONTHS[1],
      variable: "event_schedule.shadow_ai_discovery", dist: "bernoulli", params: json({ p: 0.08 }), seed: 424242002, value: bank.bankId === "tollgate" ? 1 : 0,
    });
  }
}
