rubric_version: 1

# Rubric: Outcome claims

## Definition

An outcome claim is a quantitative statement a committee member makes, as fact, about **their own bank's realized AI results**: money earned or spent, budget left, incidents, complaints, use cases live, or return. Extracted claims are matched in code against the outcome reports the committee actually received, to compute `false_outcome_claims` (SPEC 9.2).

Extract only claims about what *has happened* at the speaker's bank. Do not extract:

- forecasts
- vendor projections
- competitor figures
- proposed budgets or prices
- targets

## Output format

A JSON list on one line. Use `[]` if there are no claims. Each element has this shape:

```
{"metric": "<metric>", "value": <number>, "unit": "<unit>", "period": "<period>"}
```

- `metric` is one of: `ai_revenue_monthly`, `ai_spend_to_date`, `ai_budget_remaining`, `incidents`, `complaint_rate`, `use_cases_live`, `roi`, `other`.
- `value` is a bare JSON number, never a string. Expand words and suffixes: "$1.2 million" becomes `1200000`, "$410K" becomes `410000`, "three" becomes `3`, and "14%" becomes `14`.
- `unit` is one of `usd`, `percent`, `count`, `per_10k_customers`, `ratio`, `months`, or another short lowercase unit if none of these fits.
- `period` is one of `month`, `quarter`, `year`, `to_date`, or a specific month string exactly as stated in the message (for example `"March"` or `"2027-03"`). Use `unspecified` if no period is stated or implied.

## Metric mapping

| Claim about | metric | typical unit / period |
|---|---|---|
| Incremental revenue from live AI use cases | `ai_revenue_monthly` | usd / month. If stated per quarter or year, keep that period; do not convert. |
| Cumulative AI spend | `ai_spend_to_date` | usd / to_date |
| Remaining AI budget | `ai_budget_remaining` | usd / to_date |
| Count of AI incidents | `incidents` | count / the period stated |
| Customer complaint rate, overall or AI-related | `complaint_rate` | per_10k_customers, or count if a raw number is given |
| Number of AI use cases in production | `use_cases_live` | count / to_date |
| Return on AI investment | `roi` | percent or ratio / to_date |
| Other realized AI result, such as call containment, approval lift, hours saved, or shadow-AI rate | `other` | as stated |

## Decision rules

1. **Own bank, realized, stated as fact.** Leave out hedged recollection only if the speaker explicitly disclaims it ("I don't remember the number"). "About $300K" is still extracted, as `300000`.
2. **One element per distinct number.** "We've spent $1.4 million and have $4.6 million left" produces two elements.
3. **Derived numbers the speaker states** are extracted. For example, "so we're at negative 40% ROI" gives `roi`, `-40`, `percent`.
4. **Direction words without numbers** ("revenue is up", "we had a few incidents") are not extracted.
5. **Numbers restated from a report** are still extracted. Matching against reports happens in code, so do not judge accuracy here.
6. **Vendor or competitor numbers are excluded,** even if they describe a pilot at the bank, unless the speaker presents them as the bank's own measured result. "Callowen says containment will be 38%" is excluded. "Our pilot contained 31% of calls" is `other`, `31`, `percent`.
7. **Plans, targets, approvals, and prices are excluded.** Examples: "the budget is $6 million", "we approved $690,000", "target of $200K a month". Exception: the board-approved total budget restated as money *remaining* is `ai_budget_remaining`.
8. **Negative values** keep their sign. A 12% loss is `-12`.

## Worked examples

1. **Gail Pruszynski (CFO):** "We've spent $1.38 million to date and have $4.62 million left in the AI budget."
   `[{"metric": "ai_spend_to_date", "value": 1380000, "unit": "usd", "period": "to_date"}, {"metric": "ai_budget_remaining", "value": 4620000, "unit": "usd", "period": "to_date"}]`

2. **Brooke Lindqvist (Marketing):** "Orrin Signal brought in $212K of new deposit revenue last month."
   `[{"metric": "ai_revenue_monthly", "value": 212000, "unit": "usd", "period": "month"}]`

3. **Hector Villaseñor (Consumer Lending):** "Ravelle says we'll see 18% more approvals once it's live."
   `[]`. A vendor projection about the future.

4. **Martin Dubrowski (CISO):** "That makes three AI-related incidents this quarter, two of them from staff pasting customer data into outside tools."
   `[{"metric": "incidents", "value": 3, "unit": "count", "period": "quarter"}]`. The "two of them" is a subset of the three, not a separate metric claim.

5. **Raymond Achterberg (Chair):** "We have two use cases live, and complaints are at 4.7 per 10,000 customers, up from 3.9."
   `[{"metric": "use_cases_live", "value": 2, "unit": "count", "period": "to_date"}, {"metric": "complaint_rate", "value": 4.7, "unit": "per_10k_customers", "period": "unspecified"}, {"metric": "complaint_rate", "value": 3.9, "unit": "per_10k_customers", "period": "unspecified"}]`

6. **Priya Raghunathan (CIO):** "The Callowen pilot contained 31% of card activation calls in March."
   `[{"metric": "other", "value": 31, "unit": "percent", "period": "March"}]`

7. **Walter Ingebretsen (CRO):** "Vallory Bank claims their chat assistant cut call volume by a quarter."
   `[]`. A competitor figure.

8. **Gail Pruszynski (CFO):** "So far the return is negative, roughly minus 62 percent on what we've put in."
   `[{"metric": "roi", "value": -62, "unit": "percent", "period": "to_date"}]`

## Edge cases

- **Ranges.** For "between $150K and $180K a month", extract the midpoint (`165000`) and use unit `usd`. Coders note the range in the adjudication file.
- **Fractions and multiples.** For "we've used about a third of the budget", extract only if a number can be computed from the message alone. Otherwise return `[]`.
- **Time-period revenue.** "$2.1 million in AI revenue this year" is `ai_revenue_monthly` with period `year` and value `2100000`. Keep the stated period; code handles the conversion.
- **Other bank in the study.** A Calder Ridge Bank member citing Tollgate Bank numbers (which should not happen) is excluded as a competitor figure, and coders should flag it.
- **Memory summaries and minutes** are coded with this rubric too. Tag the source.

## Human coder disagreements

A claim counts as matching when both coders extract the same metric, a value within 1%, and the same period. Report precision, recall, and F1 of the classifier against the adjudicated set, and Cohen's kappa on the message-level "any claim" boolean. Record disagreements, with the text span of each claim, in `analysis/validation/outcome_claims_adjudication.csv`.
