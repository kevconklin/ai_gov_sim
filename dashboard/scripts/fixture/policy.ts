import { BANKS, json, MONTHS, round, type BankDef, type Insert } from "./common";

interface Control { id: string; section: string; text: string }

const CONTROL_TEXT: [string, string][] = [
  ["Governance", "The AI Governance Committee maintains an inventory of every AI system in use, including vendor tools."],
  ["Governance", "Each AI system has a named business owner accountable for its outcomes."],
  ["Governance", "The Committee reports AI activity and exceptions to the Board Risk Committee each quarter."],
  ["Use", "Staff may not enter customer information into AI tools that are not on the approved inventory."],
  ["Model risk", "All medium and high tier models must be independently validated before production use."],
  ["Model risk", "Model owners must define performance thresholds and monitor them at least monthly."],
  ["Fair lending", "Any model used in a credit decision must be tested for disparate impact before launch and annually."],
  ["Fair lending", "Adverse action notices must state the principal reasons for a decision in terms a customer can understand."],
  ["Third parties", "Vendors providing AI capabilities must complete the AI risk assessment before contract signature."],
  ["Third parties", "Contracts must prohibit vendors from training models on Bank customer data without written approval."],
  ["Customer-facing AI", "Customer-facing generative AI must disclose that the customer is interacting with an automated assistant."],
  ["Customer-facing AI", "Customer-facing outputs must be sampled and reviewed by staff weekly."],
  ["Incident response", "AI incidents affecting customers must be escalated to the CISO and CRO within 24 hours."],
  ["Data", "Training and prompt data must be classified under the Bank's data classification standard."],
];

/** How many controls exist at the end of each month. */
const COUNTS: Record<BankDef["bankId"], number[]> = {
  calder_ridge: [4, 9, 12],
  tollgate: [2, 3, 5],
};

/** Tollgate picks a sparser subset, so control ids differ between banks. */
const ORDER: Record<BankDef["bankId"], number[]> = {
  calder_ridge: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 13, 12],
  tollgate: [0, 3, 10, 12, 1],
};

function buildControls(bank: BankDef, count: number): Control[] {
  const idxs = ORDER[bank.bankId].slice(0, count);
  // Calder removes AI-GOV-004 in month 3 and replaces it with a stricter version.
  return idxs.map((i, n) => {
    const [section, text] = CONTROL_TEXT[i]!;
    return { id: `AI-GOV-${String(n + 1).padStart(3, "0")}`, section, text };
  });
}

export function renderPolicy(bank: BankDef, month: string, controls: Control[]): string {
  const sections = [...new Set(controls.map((c) => c.section))];
  const lines = [
    `# ${bank.name} Artificial Intelligence Policy`,
    "",
    `Effective ${month}-28. Owner: AI Governance Committee.`,
    "",
    "## Purpose",
    "",
    "This policy sets the minimum requirements for using artificial intelligence at the Bank, consistent with the Board's risk appetite.",
  ];
  for (const s of sections) {
    lines.push("", `## ${s}`, "");
    for (const c of controls.filter((x) => x.section === s)) lines.push(`${c.id}: ${c.text}`);
  }
  return `${lines.join("\n")}\n`;
}

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function seedPolicy(insert: Insert): void {
  for (const bank of BANKS) {
    MONTHS.forEach((month, i) => {
      let controls = buildControls(bank, COUNTS[bank.bankId][i]!);
      if (bank.bankId === "calder_ridge" && month === "2027-03") {
        controls = controls
          .filter((c) => c.id !== "AI-GOV-004")
          .concat({ id: "AI-GOV-013", section: "Use", text: "Staff may use only AI tools on the approved inventory, and never with customer or confidential information unless the tool is approved for that data class." });
      }
      const text = renderPolicy(bank, month, controls);
      insert("policy_versions", {
        run_id: bank.runId, bank_id: bank.bankId, sim_month: month,
        git_sha: `${bank.bankId === "tollgate" ? "7d1" : "c2a"}${month.replace("-", "")}f00dbeef`.padEnd(40, "0"),
        policy_text: text, word_count: words(text), control_count: controls.length,
        controls: json(controls.map((c) => c.id)), readability: round(13.1 + i * 0.4 + (bank.bankId === "tollgate" ? -1.2 : 0), 1),
      });
    });
  }
}
