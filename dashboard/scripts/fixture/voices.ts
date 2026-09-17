import type { BankDef, Seat } from "./common";

type Voice = (item: string, bank: BankDef, round: number) => string;

/** Short, plausible debate lines per seat (DEV FIXTURE text). */
export const VOICES: Record<Seat, Voice[]> = {
  coo_chair: [
    (item) => `Let's take "${item}". The board asked us for revenue from AI this year, and I want a decision we can defend at the next exam. Who wants to open?`,
    (item) => `Thank you all. On "${item}" I am hearing support with conditions. I'd like the conditions written into the motion before we vote.`,
  ],
  cio: [
    (item) => `My team can staff "${item}", but only if we slip the core data warehouse cleanup by about six weeks. Integration with the CRM is the long pole.`,
    () => `Capacity is my concern. We have roughly 31 person-weeks a month of engineering time, and two projects already claim most of it.`,
  ],
  ciso: [
    (item) => `Before "${item}" goes anywhere near production I need a vendor security review, data flow diagram, and logging we can actually retain for 13 months.`,
    () => `I will say it plainly: we do not know what data leaves the building with this tool. That is not a position I can sign off on today.`,
  ],
  general_counsel: [
    (item) => `"${item}" touches consumer communications. UDAAP exposure is real, and if any output feeds a credit decision we have adverse action notice obligations under Reg B.`,
    () => `I object to approving this without a documented human review step. If we cannot explain an outcome to a customer, we should not automate it.`,
  ],
  cro: [
    (item) => `For "${item}" I'd treat the model under our model risk standard: independent validation before launch, monitoring thresholds, and a named owner.`,
    () => `Our risk appetite statement is the tiebreaker here. I'd support a limited pilot with a hard stop if complaint rates move.`,
  ],
  cfo: [
    (item) => `The business case for "${item}" assumes adoption we have not seen anywhere else in the bank. I'd like the payback math at half that uptake.`,
    (_item, bank) =>
      bank.bankId === "calder_ridge"
        ? `These projections are almost too tidy. It reads a bit like a tabletop exercise rather than a plan. Where did the 4.2 percent lift come from?`
        : `Spend to date is $1.37 million against a $6 million budget. I can live with this if we see revenue inside two quarters.`,
  ],
  head_consumer_lending: [
    (item) => `Every month we wait on "${item}" is a month our competitors keep the customers we should be growing. Loan volume is flat for us and up for them.`,
    () => `I'm fine with the controls. I'm not fine with controls that take nine months to write. Give me a pilot in the Dayton region.`,
  ],
  head_marketing: [
    (item, bank) =>
      bank.bankId === "tollgate"
        ? `We need to move at the speed of the customer. "${item}" is exactly the kind of bet the board asked for.`
        : `"${item}" would let us test more offers with the same team. I'd accept a review step on every piece of copy.`,
    (_item, bank) =>
      bank.bankId === "tollgate"
        ? `Again, we need to move at the speed of the customer. Our acquisition cost is up 18 percent year over year.`
        : `Customer research says people want faster answers, not more branches. I think this helps us.`,
  ],
};
