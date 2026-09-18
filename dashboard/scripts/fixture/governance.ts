/**
 * DEV FIXTURE DATA for the governance page. Hand-written, deterministic, not from a real run.
 *
 * Gives each bank one meeting a human called, so the page has all four of its states to show:
 * a decision still waiting on a person (with dissent to answer), one already attested as an
 * override, an advisory item that was heard and synthesised but never voted on, and a ranked
 * candidate list from a completed `candidates` command.
 */
import { BANKS, json, rid, SEATS, type BankDef, type Insert, type Seat } from "./common";
import { activeAgent } from "./people";

const MONTH = "2027-03";
const CALLED = `${MONTH}-2`;

function calledMeetingId(bank: BankDef): string {
  return rid(bank, `meeting/${CALLED}`);
}

/** Two items: one left for a person to decide, one they already decided against the committee. */
const [QUEUED, ATTESTED] = [
  { itemId: "UC-401", title: "Collections outreach assistant", attested: false, tier: "high" },
  { itemId: "UC-402", title: "Branch scheduling assistant", attested: true, tier: "low" },
] as const;
const ITEMS = [QUEUED, ATTESTED];

const ADVISORY_ITEM = "ADV-001";
const ADVISORY_TITLE = "Where should model risk oversight sit?";

const STANCES: Record<Seat, number> = {
  coo_chair: 4, cio: 5, ciso: 1, general_counsel: 2, cro: 1, cfo: 3, head_consumer_lending: 5, head_marketing: 4,
};

const WOULD_CHANGE: Record<Seat, string> = {
  coo_chair: "A written owner for every model in the inventory.",
  cio: "Evidence that a second-line team would not add a release cycle.",
  ciso: "A completed inventory with the customer-facing models named.",
  general_counsel: "A view from outside counsel on the examiner's expectation.",
  cro: "Independent validation coverage above eighty per cent.",
  cfo: "A three-year cost model for a second-line function.",
  head_consumer_lending: "Proof that lending launches would not slow down.",
  head_marketing: "A campaign turnaround time that does not move.",
};

export function seedGovernance(insert: Insert): void {
  for (const bank of BANKS) {
    const meetingId = calledMeetingId(bank);
    const date = `${MONTH}-${Number(bank.meetingDay) + 7}`;

    insert("meetings", {
      meeting_id: meetingId, run_id: bank.runId, bank_id: bank.bankId, sim_month: MONTH, meeting_date: date,
      agenda: json([
        ...ITEMS.map((i) => ({ item_id: i.itemId, kind: "use_case", title: i.title, ref_id: rid(bank, `uc/${i.itemId}`) })),
        { item_id: ADVISORY_ITEM, kind: "advisory", title: ADVISORY_TITLE, ref_id: null },
      ]),
      minutes_json: null,
      minutes_text: "The committee met at the chair's request on a set agenda.",
      status: "closed",
      convened: 1,
    });

    for (const item of ITEMS) {
      const useCaseId = rid(bank, `uc/${item.itemId}`);
      const decisionId = rid(bank, `decision/${item.itemId}`);
      insert("use_cases", {
        use_case_id: useCaseId, run_id: bank.runId, bank_id: bank.bankId, title: item.title,
        description: "Raised by the business and put to the committee at a called meeting.",
        lob: "consumer", details: json({}), risk_tier: item.tier,
        status: item.attested ? "rejected" : "proposed", proposed_month: MONTH,
        decided_month: item.attested ? MONTH : null, proposer_agent_id: activeAgent(bank, "cio", MONTH),
        meeting_id: meetingId,
      });

      // Carried 6-2, with the two cautious seats against: dissent the attester has to answer.
      const against = new Set(["ciso", "cro"]);
      for (const seat of SEATS) {
        insert("votes", {
          run_id: bank.runId, meeting_id: meetingId, agent_id: activeAgent(bank, seat, MONTH), item_id: item.itemId,
          vote: against.has(seat) ? "no" : "yes",
          rationale: against.has(seat)
            ? "The fair lending exposure has not been quantified."
            : "Consistent with the position I recorded.",
        });
      }

      insert("decisions", {
        decision_id: decisionId, run_id: bank.runId, bank_id: bank.bankId, meeting_id: meetingId, sim_month: MONTH,
        item_id: item.itemId, kind: "use_case", ref_id: useCaseId, outcome: "approved",
        yes_votes: 6, no_votes: 2, abstentions: 0, tie_broken: 0,
      });

      // One is left in the queue; the other shows an override already on record.
      if (item.attested) {
        insert("attestations", {
          attestation_id: rid(bank, `attestation/${item.itemId}`), run_id: bank.runId, decision_id: decisionId,
          actor: "chief.risk@example.invalid", outcome: "rejected",
          rationale: "Overriding the committee. The fair lending exposure is not quantified and I am not "
            + "willing to carry that into an exam.",
          responded_to: json([activeAgent(bank, "ciso", MONTH), activeAgent(bank, "cro", MONTH)]),
          created_at: `2027-03-20T10:${bank.meetingDay}:00Z`,
        });
      }
    }

    for (const seat of SEATS) {
      insert("perspectives", {
        run_id: bank.runId, meeting_id: meetingId, agent_id: activeAgent(bank, seat, MONTH), item_id: ADVISORY_ITEM,
        stance: STANCES[seat], position: "Recorded at the chair's request, ahead of any discussion.",
        key_concern: "Ownership is unsettled while the inventory is incomplete.",
        would_change_my_mind: WOULD_CHANGE[seat],
      });
    }

    const forSeats = SEATS.filter((s) => STANCES[s] >= 4);
    const againstSeats = SEATS.filter((s) => STANCES[s] <= 2);
    insert("syntheses", {
      synthesis_id: rid(bank, `synthesis/${ADVISORY_ITEM}`), run_id: bank.runId, meeting_id: meetingId,
      item_id: ADVISORY_ITEM, spread: 4, split: 1,
      for_seats: json([...forSeats].sort()),
      against_seats: json([...againstSeats].sort()),
      undecided_seats: json(SEATS.filter((s) => STANCES[s] === 3)),
      checks: json([...SEATS].sort().map((s) => [s, WOULD_CHANGE[s]])),
      narrative: null,
    });

    insert("agenda_deferrals", {
      deferral_id: rid(bank, `deferral/${QUEUED.itemId}`), run_id: bank.runId,
      ref_id: rid(bank, `uc/${QUEUED.itemId}`), meeting_id: meetingId, sim_month: MONTH, reason: "tabled",
    });

    insert("commands", {
      command_id: `${bank.runId}-candidates-1`, run_id: bank.runId, kind: "candidates", payload: json({}),
      reason: "Refreshing the agenda candidate list before setting an agenda.", status: "done",
      result: json({
        candidates: [{
          kind: "use_case", ref_id: rid(bank, `uc/${QUEUED.itemId}`), title: QUEUED.title,
          priority: 47, reasons: ["open 31 days", "risk tier high", "deferred 1x"], deferrals: 1, escalated: false,
        }],
      }),
      created_at: "2027-03-19T09:00:00Z", processed_at: "2027-03-19T09:00:04Z",
    });
  }
}
