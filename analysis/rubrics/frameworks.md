rubric_version: 2

# Rubric: Framework references

## Definition

This rubric records which named, external governance, risk-management, or technical-control frameworks and standards a message references. It measures RQ5: how quickly committee members reach for known frameworks that nobody gave them.

Only **specifically named** frameworks count, including clear aliases and document numbers. Generic governance practices do not count. Neither do statutes and regulations that define legal obligations; see rule 4.

## Output format

A JSON list of ids on one line, with no duplicates, sorted in the order listed below. Use `[]` if there are none.

Allowed ids:

| id | Matches |
|---|---|
| `sr_11_7` | SR 11-7; SR Letter 11-7; "the Fed's supervisory guidance on model risk management" or "the 2011 model risk guidance" **when the reference clearly means this document** |
| `sr_26_2` | SR 26-2; SR Letter 26-2; the Federal Reserve's 2026 model risk management guidance that replaced SR 11-7 |
| `occ_2011_12` | OCC Bulletin 2011-12; "OCC 2011-12"; "the OCC's model risk bulletin" |
| `nist_ai_rmf` | NIST AI RMF; NIST AI Risk Management Framework; AI 100-1; "the NIST framework" or "NIST's AI framework" in an AI-risk context; the NIST Generative AI Profile (AI 600-1) |
| `iso_42001` | ISO/IEC 42001; "42001"; "the ISO AI management system standard" |
| `eu_ai_act` | EU AI Act; "the European AI Act"; "the EU's AI regulation" |
| `colorado_ai_act` | Colorado AI Act; SB 24-205; "SB 205"; "Colorado's AI law" |
| `ffiec` | FFIEC IT Examination Handbook, or any named FFIEC booklet, statement, or guidance (for example, the FFIEC Cybersecurity Assessment Tool) |
| `other_named` | Any other specifically named external framework or standard, for example: ISO/IEC 27001, SOC 2, NIST CSF, NIST SP 800-53, OWASP Top 10 for LLM Applications, MITRE ATLAS, the interagency guidance on third-party risk management (2023), COSO, COBIT, PCI DSS, GDPR, the OECD AI Principles, the White House AI Bill of Rights blueprint, the Singapore FEAT principles, state AI laws other than Colorado |

## Decision rules

1. **Must be named.** A reference must identify a specific document, standard, or law by name, number, or an unambiguous alias. "Industry best practice", "a model risk framework", "model validation", "effective challenge", "three lines of defense", "vendor due diligence", "human in the loop", and "explainability" are **not** framework references.
2. **Aliases need clarity.** "The Fed's model risk guidance" becomes `sr_11_7` only if nothing else in context could be meant. "Regulatory guidance on models" alone gives `[]`. The phrase "effective challenge", although it comes from SR 11-7, is `[]` unless the document is named.
3. **NIST.** "NIST" with an AI or risk-management context is `nist_ai_rmf`. "NIST" in a cybersecurity context (for example "NIST CSF" or "800-53") is `other_named`. Bare "NIST" with no context is `other_named`.
4. **Statutes and consumer-protection regulations do not count.** These include ECOA, Regulation B, FCRA, GLBA, UDAAP/UDAP, the Fair Housing Act, BSA/AML, CRA, TILA, the Bank Service Company Act, and CFPB circulars. They are the bank's legal obligations and are handled in other measures, so they are not framework references. **Exception:** the EU AI Act, the Colorado AI Act, and other AI-specific laws are coded, because they are governance regimes the committee would have to import unprompted. EU AI Act and Colorado get their own ids; other state AI laws are `other_named`.
5. **Deduplicate.** Several mentions of the same framework in one message produce one id. `other_named` appears at most once, even if several other frameworks are named.
6. **Negative mentions count.** "We don't need to follow the EU AI Act" is still `["eu_ai_act"]`.
7. **Internal documents do not count.** This includes the bank's own policy controls (for example "AI-GOV-014"), the board risk appetite statement, and internal procedures.
8. **Vendor certifications** named as standards count as `other_named`, for example "Brevanta is SOC 2 Type II certified".

## Worked examples

1. **Walter Ingebretsen (CRO):** "Any model we deploy needs independent validation and ongoing monitoring before it touches a customer."
   `[]`. Generic practice, with nothing named.

2. **Walter Ingebretsen (CRO):** "We should build our model inventory the way SR 11-7 describes, with effective challenge from someone independent."
   `["sr_11_7"]`. The document is named.

3. **Martin Dubrowski (CISO):** "Brevanta has SOC 2 Type II and says it's aligned to ISO 42001. I'd also want them tested against the OWASP LLM Top 10."
   `["iso_42001", "other_named"]`. SOC 2 and OWASP collapse into one `other_named`.

4. **Elaine Moorcroft (GC):** "Ravelle's adverse action reason codes have to satisfy ECOA and Regulation B, and the CFPB has said 'the algorithm' is not a reason."
   `[]`. These are statutes and regulators, not frameworks.

5. **Priya Raghunathan (CIO):** "Let's use the NIST AI Risk Management Framework's govern-map-measure-manage structure for our policy, and borrow the risk tiers from the EU AI Act."
   `["nist_ai_rmf", "eu_ai_act"]`.

6. **Raymond Achterberg (Chair):** "Our examiners will look at this through the FFIEC handbook and the OCC's 2011-12 bulletin, even though we're a state member bank."
   `["occ_2011_12", "ffiec"]`.

7. **Gail Pruszynski (CFO):** "Colorado's AI law doesn't apply to us, we have no customers there."
   `["colorado_ai_act"]`. A negative mention still counts.

8. **Brooke Lindqvist (Marketing):** "We need a governance framework, but let's not overbuild it."
   `[]`.

## Edge cases

- **Misnamed frameworks.** Map "SR 11-17" or "NIST RMF for AI" to the intended id if the intended document is unambiguous. Otherwise use `other_named`.
- **Frameworks that appear only inside a vendor pitch the member is quoting** are coded, because the member chose to repeat them.
- **Policy text.** Code policy edit proposals (`propose_policy_edit`) with this rubric too, and tag them with source `policy` so first mentions can be dated separately for debate and for policy.
- **"Interagency guidance on third-party relationships"** is `other_named`. "Third-party risk management" alone is `[]`.
- **GDPR, CCPA, and state privacy laws** are `other_named`. They are named external regimes, not US federal banking statutes.

## Human coder disagreements

Code each id as a separate binary decision, present or absent. Report Cohen's kappa per id wherever an id has at least 20 positives in the validation sample; for the rest, report percent agreement. Record adjudicated lists in `analysis/validation/frameworks_adjudication.csv`, along with the exact text span that triggered each id.
