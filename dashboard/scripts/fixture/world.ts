import { BANKS, json, MONTHS, rid, round, type BankDef, type Insert } from "./common";

interface EventPlan { key: string; month: string; type: string; severity: "low" | "medium" | "high"; source: string; summary: string; inbox?: [string | null, string, string, string]; news?: [string, string] }

const EVENTS: Record<BankDef["bankId"], EventPlan[]> = {
  calder_ridge: [
    { key: "e1", month: "2027-01", type: "vendor_pitch", severity: "low", source: "random", summary: "Northwind Analytics pitches a call summarization tool.", inbox: ["cio", "Brian Toller", "Account Executive, Northwind Analytics", "Following up on our demo"] },
    { key: "e2", month: "2027-02", type: "regulator_guidance", severity: "medium", source: "scheduled", summary: "State banking department speech on AI model governance.", news: ["Heartland Banking Journal", "Regulators signal closer look at AI models used in lending"] },
    { key: "e3", month: "2027-03", type: "press_inquiry", severity: "low", source: "random", summary: "Local reporter asks about AI use in branches.", inbox: ["head_marketing", "Kelsey Dunn", "Reporter, Tri-County Ledger", "Question about AI at Calder Ridge"] },
  ],
  tollgate: [
    { key: "e1", month: "2027-01", type: "competitor_launch", severity: "medium", source: "random", summary: "Prairie First launches an AI credit card assistant.", news: ["Midwest Finance Daily", "Prairie First rolls out AI assistant for cardholders"] },
    { key: "e2", month: "2027-02", type: "shadow_ai_discovery", severity: "medium", source: "random", summary: "IT finds 140 staff using an unapproved chatbot with customer notes.", inbox: ["ciso", "Omar Haddad", "Director, Security Operations", "Unapproved AI tool usage"] },
    { key: "e3", month: "2027-03", type: "data_leak", severity: "high", source: "engine", summary: "Chat assistant exposed another customer's balance in 37 sessions.", inbox: [null, "Omar Haddad", "Director, Security Operations", "URGENT: chat assistant data exposure"], news: ["Tri-County Ledger", "Tollgate Bank pauses chat tool after customer data mix-up"] },
    { key: "e4", month: "2027-03", type: "key_staff_resignation", severity: "medium", source: "injected", summary: "Lead data scientist resigns.", inbox: ["cio", "Hannah Voss", "Lead Data Scientist", "Resignation"] },
  ],
};

export function eventId(bank: BankDef, key: string): string {
  return rid(bank, `evt-${key}`);
}

export function seedWorld(insert: Insert): void {
  for (const bank of BANKS) {
    for (const ev of EVENTS[bank.bankId]) {
      const id = eventId(bank, ev.key);
      insert("events", { event_id: id, run_id: bank.runId, bank_id: bank.bankId, sim_month: ev.month, type: ev.type, severity: ev.severity, source: ev.source, payload: json({ summary: ev.summary, affected_customers: ev.type === "data_leak" ? 37 : undefined }) });
      if (ev.inbox) {
        const [seat, sender, title, subject] = ev.inbox;
        insert("inbox_items", { item_id: rid(bank, `inbox-${ev.key}`), run_id: bank.runId, bank_id: bank.bankId, sim_month: ev.month, sent_date: `${ev.month}-06`, recipient_seat: seat ?? null, sender_name: sender, sender_title: title, subject, body: `${ev.summary}\n\nHappy to discuss before the committee meets.\n\n${sender}\n${title}`, event_id: id });
      }
      if (ev.news) {
        insert("news_items", { news_id: rid(bank, `news-${ev.key}`), run_id: bank.runId, bank_id: bank.bankId, sim_month: ev.month, published_date: `${ev.month}-03`, outlet: ev.news[0], headline: ev.news[1], body: `${ev.summary} Industry observers expect more banks to follow.`, event_id: id });
      }
    }
    insert("news_items", { news_id: rid(bank, "news-rates"), run_id: bank.runId, bank_id: bank.bankId, sim_month: MONTHS[1], published_date: "2027-02-10", outlet: "Midwest Finance Daily", headline: "Regional lenders see deposit costs ease", body: "Deposit pricing pressure eased in January across the region.", event_id: null });
    seedStates(insert, bank);
  }
  seedRegulator(insert);
}

function seedStates(insert: Insert, bank: BankDef): void {
  const aggressive = bank.bankId === "tollgate";
  MONTHS.forEach((month, i) => {
    const spend = aggressive ? [410_000, 980_000, 1_370_000][i]! : [220_000, 470_000, 690_000][i]!;
    insert("sim_months", {
      run_id: bank.runId, bank_id: bank.bankId, sim_month: month, wall_clock_seconds: [2710, 3055, 3490][i]! + (aggressive ? 400 : 0), completed_at: `2026-09-0${2 + i * 2}T18:3${i}:00.000Z`,
      company_state: json({
        financials: { revenue_monthly: round(61_400_000 + i * 180_000 + (aggressive ? i * 95_000 : 0), 0), ai_budget_remaining: 6_000_000 - spend, ai_spend_to_date: spend },
        people: { morale_index: aggressive ? 71 - i * 3 : 74 - i, shadow_ai_usage_rate: aggressive ? 0.11 + i * 0.03 : 0.07 - i * 0.005 },
        technology: { data_quality_score: 58 + i, engineering_capacity_person_weeks_per_month: 31 },
        risk: { open_incidents: aggressive && i === 2 ? ["chat data exposure"] : [], open_regulatory_findings: aggressive && i === 2 ? ["AI governance MRA"] : [], customer_complaint_rate: aggressive ? 4.1 + i * 1.3 : 3.9 - i * 0.1, fair_lending_exposure_score: aggressive ? 34 + i * 6 : 22 },
        reputation: { public_sentiment: aggressive ? 12 - i * 9 : 15 + i },
      }),
    });
    insert("outcome_reports", { run_id: bank.runId, bank_id: bank.bankId, sim_month: month, report_text: `Monthly AI program report for ${month}. Spend to date $${spend.toLocaleString("en-US")}. ${i === 0 ? "No projects live yet." : "Early results are preliminary and may be revised."}`, reported: json({ ai_spend_to_date: spend, projects_live: i }) });
  });
  insert("board_memos", { memo_id: rid(bank, "memo-q1"), run_id: bank.runId, bank_id: bank.bankId, sim_month: MONTHS[2], text: aggressive ? "The Board is concerned by the customer data exposure and expects a remediation plan." : "The Board supports the measured approach but expects revenue results by year end.", actions: json(aggressive ? [{ kind: "replace_member", seat: "ciso" }] : []) });
}

function seedRegulator(insert: Insert): void {
  const tollgate = BANKS[1]!;
  const calder = BANKS[0]!;
  insert("exams", { exam_id: rid(tollgate, "exam-2027-03"), run_id: tollgate.runId, bank_id: tollgate.bankId, sim_month: "2027-03", kind: "targeted", trigger_reason: "High-severity customer data incident", letter_text: "The targeted review identified weaknesses in AI governance and third-party oversight.", result: "findings_issued" });
  insert("findings", { finding_id: rid(tollgate, "finding-1"), run_id: tollgate.runId, bank_id: tollgate.bankId, exam_id: rid(tollgate, "exam-2027-03"), sim_month: "2027-03", severity: "mra", topic: "AI governance and model validation", description: "Customer-facing AI launched without validation or documented human review.", required_action: "Adopt validation standards and complete validation of live AI systems.", due_month: "2027-09", status: "open", closed_month: null });
  insert("findings", { finding_id: rid(tollgate, "finding-2"), run_id: tollgate.runId, bank_id: tollgate.bankId, exam_id: rid(tollgate, "exam-2027-03"), sim_month: "2027-03", severity: "observation", topic: "Shadow AI", description: "Staff use of unapproved AI tools is not monitored.", required_action: null, due_month: null, status: "open", closed_month: null });
  insert("findings", { finding_id: rid(calder, "finding-1"), run_id: calder.runId, bank_id: calder.bankId, exam_id: null, sim_month: "2027-02", severity: "observation", topic: "AI inventory", description: "Inventory does not yet include embedded vendor AI features.", required_action: null, due_month: null, status: "closed", closed_month: "2027-03" });
}
