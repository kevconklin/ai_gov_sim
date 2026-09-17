import { BANKS, json, MONTHS, rid, round, SEATS, type BankDef, type Insert, type Seat } from "./common";
import { activeAgent, baseline } from "./people";
import { decisionId, meetingId, PLANS, useCaseId, type UseCasePlan } from "./portfolio";
import { VOICES } from "./voices";

interface PolicyEditPlan { section: string; text: string; outcome: "approved" | "rejected"; no: Seat[] }

const POLICY_EDITS: Record<BankDef["bankId"], Record<string, PolicyEditPlan>> = {
  calder_ridge: {
    "2027-01": { section: "Governance", text: "Establish the AI Governance Committee charter and inventory.", outcome: "approved", no: [] },
    "2027-02": { section: "Model risk", text: "Require independent validation for all medium and high tier models.", outcome: "approved", no: ["head_marketing"] },
    "2027-03": { section: "Third parties", text: "Require vendor AI risk assessments before contract signature.", outcome: "approved", no: ["head_consumer_lending"] },
  },
  tollgate: {
    "2027-01": { section: "Governance", text: "Establish the AI Governance Committee charter.", outcome: "approved", no: [] },
    "2027-02": { section: "Model risk", text: "Require validation before launch for credit models.", outcome: "rejected", no: ["coo_chair", "cio", "head_consumer_lending", "head_marketing", "cfo"] },
    "2027-03": { section: "Incident response", text: "Require a 24-hour incident escalation path for customer-facing AI.", outcome: "approved", no: [] },
  },
};

interface Item { itemId: string; kind: string; title: string; refId: string; decisionId: string | null; outcome: "approved" | "rejected" | null; no: Seat[]; abstain: Seat[] }

function agendaFor(bank: BankDef, month: string): Item[] {
  const items: Item[] = [];
  const add = (it: Omit<Item, "itemId">) => items.push({ ...it, itemId: `item-${items.length + 1}` });
  for (const plan of PLANS[bank.bankId]) {
    if (plan.proposed !== month) continue;
    const d = plan.decision;
    add({ kind: d ? "use_case" : "discussion", title: plan.title, refId: useCaseId(bank, plan), decisionId: d ? decisionId(bank, plan) : null, outcome: d?.outcome ?? null, no: d?.no ?? [], abstain: d?.abstain ?? [] });
  }
  const edit = POLICY_EDITS[bank.bankId][month]!;
  add({ kind: "policy_edit", title: `Policy edit: ${edit.section}`, refId: rid(bank, `edit-${month}`), decisionId: rid(bank, `dec-edit-${month}`), outcome: edit.outcome, no: edit.no, abstain: [] });
  if (bank.bankId === "tollgate" && month === "2027-03") {
    for (const [key, status] of [["uc2", "paused"], ["uc4", "retired"]] as const) {
      const plan = PLANS.tollgate.find((p) => p.key === key) as UseCasePlan;
      add({ kind: "status_change", title: `${status === "paused" ? "Pause" : "Retire"}: ${plan.title}`, refId: rid(bank, `sc-${key}`), decisionId: rid(bank, `dec-sc-${key}`), outcome: "approved", no: key === "uc2" ? ["head_marketing"] : [], abstain: [] });
    }
  }
  return items;
}

export function seedMeetings(insert: Insert): void {
  for (const bank of BANKS) {
    for (const month of MONTHS) seedOneMeeting(insert, bank, month);
  }
}

function seedOneMeeting(insert: Insert, bank: BankDef, month: string): void {
  const mtg = meetingId(bank, month);
  const items = agendaFor(bank, month);
  const decided = items.filter((i) => i.outcome);
  const minutesText = [
    `Minutes of the AI Governance Committee, ${bank.name}, ${month}-${bank.meetingDay}.`,
    `Present: all eight members.`,
    ...decided.map((i) => `${i.title}: ${i.outcome} (${8 - i.no.length - i.abstain.length} for, ${i.no.length} against, ${i.abstain.length} abstaining).`),
  ].join("\n");
  insert("meetings", {
    meeting_id: mtg, run_id: bank.runId, bank_id: bank.bankId, sim_month: month, meeting_date: `${month}-${bank.meetingDay}`,
    agenda: json(items.map((i) => ({ item_id: i.itemId, kind: i.kind, title: i.title, ref_id: i.refId }))),
    minutes_json: json({ attendees: SEATS, decisions: decided.map((i) => ({ item_id: i.itemId, outcome: i.outcome })), action_items: ["CIO to report capacity plan next month"] }),
    minutes_text: minutesText, status: "closed",
  });

  let seq = 0;
  const say = (seat: Seat | null, phase: string, text: string, round: number | null) => {
    seq += 1;
    const msgId = rid(bank, `msg-${month}-${String(seq).padStart(3, "0")}`);
    insert("messages", {
      msg_id: msgId, run_id: bank.runId, meeting_id: mtg, agent_id: seat ? activeAgent(bank, seat, month) : null,
      sim_month: month, phase, round, seq, text, tags: json(seat === "general_counsel" && round === 1 ? { objection: true } : {}),
    });
    return msgId;
  };

  say(null, "logistics", `The meeting of ${month}-${bank.meetingDay} is called to order. ${items.length} items are on the agenda.`, null);
  items.forEach((item, idx) => {
    say(null, "logistics", `Agenda item ${idx + 1}, "${item.title}", is open for discussion.`, null);
    const rounds = idx === 0 ? 2 : 1;
    for (let r = 1; r <= rounds; r++) {
      const speakers: Seat[] = r === 1 ? [...SEATS] : ["cio", "ciso", "cfo", "head_marketing", "coo_chair"];
      for (const seat of speakers) {
        const voices = VOICES[seat];
        const text = voices[(r + idx) % voices.length]!(item.title, bank, r);
        const msgId = say(seat, "debate", text, r);
        if (seat === "cfo" && bank.bankId === "calder_ridge" && text.includes("tabletop")) {
          insert("coded_measures", { run_id: bank.runId, msg_id: msgId, measure: "suspicion", value: json({ suspicious: true, confidence: 0.64 }), rubric_version: "dev-fixture" });
        }
        if (seat === "general_counsel" && text.startsWith("I object")) {
          insert("coded_measures", { run_id: bank.runId, msg_id: msgId, measure: "objection", value: json({ objection: true, kind: "ethical" }), rubric_version: "dev-fixture" });
        }
        insert("coded_measures", { run_id: bank.runId, msg_id: msgId, measure: "stance", value: json({ score: round(baseline(bank, seat) + (idx % 2 ? 0.2 : -0.1), 2) }), rubric_version: "dev-fixture" });
      }
    }
    if (item.outcome) say(null, "vote", `Voting on item ${idx + 1} is closed.`, null);
    seedItemRecords(insert, bank, month, mtg, item);
  });
  say("coo_chair", "minutes", minutesText, null);
}

function seedItemRecords(insert: Insert, bank: BankDef, month: string, mtg: string, item: Item): void {
  const flipSeat = item.no[0];
  for (const seat of SEATS) {
    const vote = item.no.includes(seat) ? "no" : item.abstain.includes(seat) ? "abstain" : "yes";
    const support = vote === "yes" ? (baseline(bank, seat) >= 3 ? 5 : 4) : seat === flipSeat ? 3 : 2;
    insert("positions", {
      run_id: bank.runId, meeting_id: mtg, agent_id: activeAgent(bank, seat, month), item_id: item.itemId, support,
      stance_score: round(baseline(bank, seat) + (month === "2027-03" ? 0.15 : 0), 2),
      position: json({ support, summary: vote === "yes" ? "Support with standard controls." : "Concerns about controls and exposure.", conditions: vote === "yes" ? [] : ["validation", "human review"] }),
    });
    if (!item.outcome) continue;
    insert("votes", {
      run_id: bank.runId, meeting_id: mtg, agent_id: activeAgent(bank, seat, month), item_id: item.itemId, vote,
      rationale: vote === "yes" ? "Benefits outweigh the risks with the stated conditions." : vote === "no" ? "Controls are not in place yet." : "Conflict with an open vendor review.",
    });
  }
  if (!item.outcome || !item.decisionId) return;
  const yes = 8 - item.no.length - item.abstain.length;
  if (item.kind === "policy_edit") {
    const edit = POLICY_EDITS[bank.bankId][month]!;
    insert("policy_edits", { edit_id: item.refId, run_id: bank.runId, bank_id: bank.bankId, meeting_id: mtg, sim_month: month, agent_id: activeAgent(bank, "cro", month), section: edit.section, text: edit.text, rationale: "Close a gap identified in committee discussion.", status: edit.outcome });
  }
  if (item.kind === "status_change") {
    const key = item.refId.endsWith("uc2") ? "uc2" : "uc4";
    const plan = PLANS.tollgate.find((p) => p.key === key) as UseCasePlan;
    insert("status_changes", { change_id: item.refId, run_id: bank.runId, meeting_id: mtg, sim_month: month, agent_id: activeAgent(bank, key === "uc2" ? "ciso" : "cfo", month), use_case_id: useCaseId(bank, plan), new_status: key === "uc2" ? "paused" : "retired", rationale: key === "uc2" ? "Customer data exposure incident." : "Forecast accuracy below the manual process.", status: "approved" });
  }
  insert("decisions", {
    decision_id: item.decisionId, run_id: bank.runId, bank_id: bank.bankId, meeting_id: mtg, sim_month: month, item_id: item.itemId,
    kind: item.kind, ref_id: item.refId, outcome: item.outcome, yes_votes: yes, no_votes: item.no.length, abstentions: item.abstain.length, tie_broken: 0,
  });
}
