# Supervisory Rulebook: Artificial Intelligence, Models, and Consumer Compliance

For examiners assigned to state member banks of about $10B to $50B in total assets. This is the examiner's working standard: what to look for, what "good" looks like, and how to grade what you find. It is written in plain language and does not replace the underlying statutes, regulations, and interagency issuances. Where the law has changed recently, the Appendix records what was checked and what could not be confirmed.

How to use this rulebook:

- Each expectation has an ID (for example RB-MRM-03). Cite the ID in every finding, next to the legal or guidance source.
- An expectation is met when the bank can show it with documents, data, or testing. Management statements alone do not meet an expectation.
- Scale expectations to the use. A spreadsheet that ranks branch marketing lists is not held to the standard of a credit underwriting model. Anything that decides credit, prices credit, talks to customers without a human in the loop, or touches customer data at scale is high-materiality.
- Grade severity using Section 10. Findings go to the board in a formal letter with required actions and deadlines.

Contents:

1. Model risk management (RB-MRM)
2. Fair lending: ECOA and Regulation B (RB-FL)
3. Fair Credit Reporting Act (RB-FCRA)
4. GLBA privacy and information safeguards (RB-GLBA)
5. Unfair, deceptive, or abusive acts or practices (RB-UDAAP)
6. Third-party risk management (RB-TPRM)
7. Generative AI and customer communications (RB-GAI)
8. Data governance (RB-DATA)
9. Governance and board oversight (RB-GOV)
10. Severity levels and remediation deadlines
11. Examination triggers and scope

Appendix: Verification status (as of September 2026)

---

## 1. Model risk management (RB-MRM)

**Sources the examiner draws on:** interagency model risk management guidance (Federal Reserve SR 26-2 / OCC Bulletin 2026-13, April 2026, which replaced SR 11-7 and OCC 2011-12), safety and soundness standards, and general risk management guidance for AI tools that the model guidance does not cover.

**What counts as a model:** a quantitative method that turns input data into estimates, scores, classifications, or recommendations that people or systems act on. Machine learning, vendor scoring tools, and statistical models all count. Generative AI and autonomous "agent" tools are not covered by the model guidance itself, but the examiner still expects them to be governed under RB-GAI and RB-GOV, and applies the same principles of testing, monitoring, and accountability in proportion to their use.

**RB-MRM-01 — Inventory.** The bank keeps a complete, current inventory of models and AI tools in use or in development, including vendor tools and tools that business units bought or turned on themselves. Each entry names the owner, purpose, business line, data used, whether it affects customers or credit, its materiality tier, validation status, and last review date. Missing tools found during the exam (for example, a vendor feature switched on without review) are evidence the inventory process does not work.

**RB-MRM-02 — Materiality tiering.** The bank assigns each model a risk tier based on the size of the decisions it drives, customer impact, legal exposure, complexity, and how much people rely on it without checking. Tiering criteria are written down and applied consistently. Credit decisioning, pricing, fraud decisions that block customer funds, and anything that makes automated statements to customers are high tier unless the bank documents why not.

**RB-MRM-03 — Sound development and documented purpose.** Before use, the bank documents what the model is for, what it is not for, the data used and why that data is fit for purpose, key assumptions, known limits, and the testing performed. Documentation must be good enough that a qualified person who did not build the model could understand and challenge it.

**RB-MRM-04 — Independent validation before use.** High-tier models are reviewed before production by people who did not build or buy them and who have the skill and authority to challenge the model. Validation covers conceptual soundness, data quality, performance testing on data the model did not train on, stability, sensitivity, and limits. Lower tiers get lighter review scaled to risk. A validation that only restates the vendor's marketing materials is not a validation.

**RB-MRM-05 — Vendor models.** Buying a model does not transfer model risk. For vendor and third-party models, the bank obtains enough information on design, data, and performance to judge whether the model is suitable for the bank's customers and markets; tests the model on the bank's own data where possible; documents any customizations and settings the bank controls; and has contract rights to the information needed for validation, monitoring, and fair lending testing. Where the vendor withholds information, the bank documents compensating controls (outcomes testing, tighter monitoring, limits on use).

**RB-MRM-06 — Ongoing monitoring.** Each production model has defined performance metrics, thresholds, and a monitoring frequency matched to its tier. The bank tracks drift in inputs and outputs, overrides, exceptions, complaints, and outcomes. Breaches of thresholds trigger documented review. Monitoring reports go to someone with authority to pause the model.

**RB-MRM-07 — Outcomes analysis and back-testing.** For decisioning models, the bank compares predictions to actual outcomes (for example, predicted versus actual default, fraud flags versus confirmed fraud) at least annually for high-tier models, and after material changes in the portfolio, economy, or product.

**RB-MRM-08 — Change control.** Material changes (retraining, new data sources, new variables, threshold changes, vendor version upgrades) go through documented review and, for high-tier models, revalidation before release. The bank can say which version made any given decision.

**RB-MRM-09 — Human oversight and override.** Where a model supports a decision affecting a customer, the bank defines when humans must review, how overrides are recorded, and how override patterns are analyzed. Human review that is never exercised or always rubber-stamps the model is not effective oversight.

**RB-MRM-10 — Limits and fallback.** The bank sets use limits for each high-tier model (populations, products, dollar amounts) and has a documented fallback process if the model is pulled from service.

**RB-MRM-11 — Pilots are production if customers are affected.** A "pilot" or "test" that makes or influences real decisions about real customers must meet the expectations for production use for that tier. Pilots on internal staff or synthetic data may use lighter controls if the boundary is documented and enforced.

---

## 2. Fair lending: ECOA and Regulation B (RB-FL)

**Sources:** Equal Credit Opportunity Act and Regulation B (12 CFR 1002, as amended effective July 21, 2026); Fair Housing Act for residential real estate lending; applicable state anti-discrimination law.

**Examiner's stance:** The examiner tests for disparate treatment in all credit products: using a prohibited basis (race, color, religion, national origin, sex, marital status, age, receipt of public assistance, good-faith exercise of consumer credit rights) or a close proxy for one, directly or through a model. The examiner does not cite a violation of federal ECOA or Regulation B on a disparate-impact theory alone. Disparate-impact exposure remains a legal risk under the Fair Housing Act (mortgage and home equity lending), state law, and private litigation, and the examiner treats unmanaged exposure as a compliance risk management weakness.

**RB-FL-01 — No prohibited bases or proxies.** Credit models, rules, and pricing do not use prohibited-basis characteristics. The bank reviews each input variable for its relationship to prohibited bases and documents why any variable that could act as a proxy (for example, ZIP code, first name, language preference, certain spending categories, device or browser attributes) has a legitimate business justification, or removes it. Age may be used only as Regulation B permits.

**RB-FL-02 — Disparate treatment testing.** Before launch and at least annually, the bank tests high-tier credit models and pricing (including discretionary pricing and overrides) for differences in outcomes among similarly situated applicants on prohibited bases, using accepted proxy methods where demographic data is not collected. Unexplained differences are investigated and resolved.

**RB-FL-03 — Specific, accurate adverse action reasons.** When the bank denies credit, changes terms unfavorably, or offers less than requested, the notice states the specific principal reasons for the action. This applies fully to complex and machine-learning models. The reasons must reflect the factors that actually drove the decision for that applicant, not a generic list. Picking the closest checkbox from the sample form is not enough if it does not accurately describe the real reason. If the bank cannot explain why its model denied an applicant, the model cannot be used to deny applicants.

**RB-FL-04 — Timing and content of notices.** Notices go out within Regulation B timeframes (generally 30 days after a completed application) and include the required ECOA notice and, where a consumer report was used, the FCRA disclosures in RB-FCRA-02.

**RB-FL-05 — Fair Housing Act and state law exposure.** For mortgage, home equity, and any product covered by state anti-discrimination law, the bank assesses whether models or policies produce significant disparities on protected bases, whether a legitimate business need justifies them, and whether a less discriminatory alternative would serve the same need. The bank documents that analysis. The examiner reports a failure to perform it as an observation or MRA depending on materiality and evidence of harm.

**RB-FL-06 — Marketing and prescreen targeting.** AI-driven marketing, look-alike audiences, and prescreened offers are reviewed for exclusion of neighborhoods or groups on a prohibited basis (redlining risk) and for statements that express intent to discourage applicants on a prohibited basis.

**RB-FL-07 — Special purpose credit programs.** Any special purpose credit program meets the written-plan and eligibility requirements of Regulation B as amended; a for-profit creditor may not use race, color, national origin, or sex as an eligibility criterion.

**RB-FL-08 — Fair lending review before launch.** Compliance staff with fair lending expertise sign off on any new or materially changed credit model, pricing engine, or automated marketing program before customers are affected.

**RB-FL-09 — Recordkeeping.** The bank keeps application records, model inputs and outputs, reason codes, and notices for at least 25 months (longer if litigation or an exam is pending), in a form that allows reconstruction of individual decisions.

---

## 3. Fair Credit Reporting Act (RB-FCRA)

**Sources:** Fair Credit Reporting Act and Regulation V (12 CFR 1022).

**RB-FCRA-01 — Permissible purpose.** The bank pulls or uses consumer reports only with a permissible purpose. AI tools that retrieve, summarize, or reuse credit report data for marketing or cross-selling are reviewed against permissible purpose and prescreen rules.

**RB-FCRA-02 — Adverse action based on consumer reports.** When a consumer report or credit score contributed to an adverse action, the notice includes the name and contact information of the consumer reporting agency, the consumer's right to a free report and to dispute, and the credit score disclosures where a score was used. This applies when a model uses bureau attributes, even if no traditional score is shown.

**RB-FCRA-03 — Alternative and third-party data.** Before using third-party data about consumers in credit, employment, or insurance-like decisions (for example, cash-flow data aggregators, rental history, device or behavioral data), the bank determines whether the provider is acting as a consumer reporting agency and whether the data is a consumer report, and applies FCRA obligations accordingly. The bank documents this determination.

**RB-FCRA-04 — Furnishing accuracy.** Where the bank furnishes information to consumer reporting agencies, automated processes that generate or correct that data meet accuracy and integrity requirements, and disputes are investigated by people with authority to correct records, not closed automatically.

**RB-FCRA-05 — Affiliate sharing and prescreen opt-outs.** Models that use affiliate data for marketing honor affiliate marketing opt-outs; prescreened offer programs honor opt-outs and include the required prescreen notice.

---

## 4. GLBA privacy and information safeguards (RB-GLBA)

**Sources:** Gramm-Leach-Bliley Act privacy provisions and Regulation P; Interagency Guidelines Establishing Information Security Standards; the interagency computer-security incident notification rule; applicable state breach notification and privacy law.

**RB-GLBA-01 — Information security program covers AI.** The board-approved information security program explicitly covers AI tools: risk assessment of data flows into and out of AI systems, access controls, encryption, logging, and testing. The program is updated when material AI tools are added.

**RB-GLBA-02 — Customer data sent to outside AI services.** Before customer nonpublic personal information is sent to any outside AI service (including hosted AI systems, transcription services, and productivity assistants), the bank confirms by contract and testing that the provider will protect it, will not use it to train models for others, will not retain it beyond need, and will notify the bank of incidents. Absent those protections, customer information must not be sent.

**RB-GLBA-03 — Unapproved AI use by staff.** The bank has a written rule on staff use of AI tools, technical controls to detect and block uploads of customer or confidential data to unapproved tools, training, and a process to act on violations. Evidence that staff routinely paste customer data into public AI tools is a safeguards deficiency.

**RB-GLBA-04 — Privacy notice accuracy.** The bank's privacy notice accurately describes the categories of information collected and shared. New sharing with third parties for AI purposes that falls outside existing exceptions requires updated notices and, where applicable, opt-out rights before sharing begins.

**RB-GLBA-05 — Incident response and notification.** The incident response plan covers AI-specific incidents (data leakage through an AI tool, model manipulation, prompt injection leading to disclosure, vendor AI breach). The bank notifies its primary federal regulator as soon as possible and no later than 36 hours after determining that a notification incident has occurred, and notifies customers as required by guidance and state law. Service providers must notify the bank of qualifying incidents promptly.

**RB-GLBA-06 — Security testing of AI applications.** Customer-facing AI applications and any AI tool with access to customer data are tested before launch and periodically for misuse, including attempts to extract other customers' data, bypass authentication, or cause the tool to take unauthorized actions.

**RB-GLBA-07 — Data minimization and retention.** AI tools receive only the customer data needed for their purpose. Transcripts, prompts, and outputs containing customer data are retained and destroyed under the bank's records schedule.

---

## 5. Unfair, deceptive, or abusive acts or practices (RB-UDAAP)

**Sources:** Dodd-Frank Act sections 1031 and 1036; Section 5 of the Federal Trade Commission Act; state UDAP statutes.

**Examiner's stance:** Focus on concrete consumer harm: misleading statements, hidden costs, practices customers cannot reasonably avoid, and taking advantage of customers' lack of understanding. The examiner prioritizes cases with identifiable harmed customers and measurable harm.

**RB-UDAAP-01 — Accurate representations.** Marketing, chatbot answers, and AI-generated communications about rates, fees, eligibility, approval odds, and terms are accurate and not misleading in overall impression. The bank is responsible for what its AI tools tell customers as if an employee said it.

**RB-UDAAP-02 — No false or unsupported claims about AI.** Claims such as "instant approval," "unbiased decisions," "personalized for you," or "your data is never shared" must be true and substantiated.

**RB-UDAAP-03 — Customers can reach a human.** Automated service channels do not trap customers. Customers can reach a person for disputes, hardship, fraud claims, complaints, and account closure without unreasonable effort. Voice and chat automation that repeatedly fails to resolve issues or blocks escalation is a potential unfair practice.

**RB-UDAAP-04 — Personalized pricing and offers.** Models that personalize fees, rates, or offers do not exploit customer vulnerability (for example, financial distress, age-related decline, or limited English proficiency) and do not steer customers into costlier products than those they qualify for.

**RB-UDAAP-05 — Collections and hardship.** AI-driven collection contact strategies comply with debt collection rules where applicable, do not harass, respect contact preferences, and do not misstate consequences of nonpayment.

**RB-UDAAP-06 — Complaint monitoring.** The bank tracks complaints connected to AI tools (identifiable by channel or tag), analyzes root causes, and fixes problems. A rising complaint rate on an AI channel without a documented response is itself a finding.

**RB-UDAAP-07 — Remediation of harmed customers.** When an AI tool gave customers wrong information or wrong outcomes, the bank identifies all affected customers, makes them whole, and documents the method.

---

## 6. Third-party risk management (RB-TPRM)

**Sources:** Interagency Guidance on Third-Party Relationships: Risk Management (June 2023) as currently in effect; the agencies' September 2026 proposal to replace it with more tailored, principles-based guidance (examiner applies a risk-tailored reading); GLBA safeguards; the incident notification rule.

**RB-TPRM-01 — Risk-based planning.** Before signing, the bank decides whether the relationship supports a critical activity or involves customer data, credit decisions, or customer-facing communication, and scales due diligence and oversight accordingly.

**RB-TPRM-02 — Due diligence.** For AI vendors supporting material activities, due diligence covers financial condition, information security, data handling and model training practices, subcontractors (including which underlying AI systems the vendor relies on), performance claims and how they were measured, legal and regulatory compliance history, business continuity, and the vendor's ability to support the bank's validation and fair lending testing.

**RB-TPRM-03 — Contract terms.** Contracts for material AI services include: performance standards and reporting; rights to audit and to obtain model documentation and test results; data ownership, use limits, no training on bank data without consent, retention and return or destruction; security requirements and incident notification timelines; notice of material model changes; subcontractor controls; regulator access; termination and transition rights. Missing terms for high-risk relationships are findings.

**RB-TPRM-04 — Ongoing monitoring.** The bank monitors each material vendor at a frequency matched to risk: performance against contract, incidents, complaints, SOC reports or equivalent, financial condition, and model changes. Monitoring results are reported to management.

**RB-TPRM-05 — Concentration and exit.** The bank identifies dependence on a single vendor or single underlying AI provider across multiple use cases and has a realistic exit or contingency plan for critical ones.

**RB-TPRM-06 — Responsibility stays with the bank.** Use of a vendor does not relieve the bank of responsibility for compliance with consumer protection, fair lending, privacy, and safety and soundness requirements. "The vendor handles compliance" is not an acceptable answer.

---

## 7. Generative AI and customer communications (RB-GAI)

**Sources:** UDAAP and UDAP law; ECOA and FCRA where communications concern credit; GLBA; Telephone Consumer Protection Act (AI-generated voices on outbound calls are "artificial" voices requiring consent); Electronic Fund Transfer Act and Truth in Lending Act dispute and error-resolution rights; state disclosure laws where the bank serves those states; general risk management principles. Generative and autonomous AI tools are outside the scope of the interagency model guidance, so the examiner applies these expectations directly.

**RB-GAI-01 — Approved uses and prohibited uses.** The bank has a written list of approved generative AI uses, prohibited uses (for example: making or explaining credit decisions without human review, giving individualized legal, tax, or investment advice, handling disputes or fraud claims end to end without a human), and an approval process for new uses.

**RB-GAI-02 — Disclosure that a customer is dealing with AI.** Customers are told clearly when they are interacting with an automated assistant or AI-generated voice, and are not led to believe they are talking to a person. State laws that require disclosure in specified situations are followed for customers in those states.

**RB-GAI-03 — Accuracy controls.** Customer-facing generative tools answer from approved, current bank content; are tested before launch against a documented set of realistic questions including rates, fees, disputes, hardship, and fraud; have measured error rates with an acceptance threshold; and are re-tested after content or model changes. Outputs that state account-specific facts come from system-of-record data, not generated text.

**RB-GAI-04 — Error resolution and complaints are recognized.** Automated channels recognize and route error-resolution notices, billing disputes, fraud claims, and complaints so that legal timelines start and are met. A dispute raised to a chatbot is still a dispute.

**RB-GAI-05 — No commitments the bank will not honor.** Generative tools cannot make offers, waive fees, promise approvals, or change terms unless the bank intends to be bound; if a tool does so in error, the bank evaluates honoring the statement and remediating.

**RB-GAI-06 — Human review of high-impact outputs.** AI-drafted adverse action notices, collection letters, SAR narratives, legal or regulatory filings, and marketing content go through documented human review before use. Reviewers have time and training to catch errors.

**RB-GAI-07 — Logging and retention.** Customer conversations with AI tools, the content the tool relied on, and the version of the tool are logged and retained so that the bank can reconstruct what a customer was told.

**RB-GAI-08 — Misuse and manipulation testing.** Customer-facing tools are tested for manipulation (instructions hidden in customer inputs or documents, attempts to extract confidential information or other customers' data, attempts to trigger unauthorized transactions) and monitored after launch.

**RB-GAI-09 — Outbound AI voice and text.** Outbound calls or texts using AI-generated voices or content have the consent required by the TCPA, identify the bank, and provide opt-out mechanisms.

**RB-GAI-10 — Accessibility and language.** Automated channels do not provide worse service to customers with disabilities or limited English proficiency than the channels they replace, and alternatives remain available.

---

## 8. Data governance (RB-DATA)

**RB-DATA-01 — Ownership and definitions.** Critical data used by models and AI tools (customer identity, household links, income, collateral, transactions, complaints) has named business owners, documented definitions, and quality standards.

**RB-DATA-02 — Data quality measurement.** The bank measures completeness, accuracy, timeliness, and consistency of critical data, reports results, and fixes defects at the source. A model is not validated if the data feeding it is known to be poor and the known issues are not addressed or bounded.

**RB-DATA-03 — Lineage.** For high-tier models, the bank can trace each input from source system through transformations to the model, and can show what data a decision used.

**RB-DATA-04 — Permitted use.** Data is used only for purposes consistent with how it was collected, customer disclosures, contracts with data providers, and law (GLBA, FCRA, state privacy). The bank tracks restrictions on data sets (for example, data licensed only for fraud prevention may not be used for marketing).

**RB-DATA-05 — Sensitive and demographic data.** The bank controls access to sensitive data and to any demographic data or proxies used for fair lending testing, and keeps that data separate from decisioning.

**RB-DATA-06 — Training data documentation.** For models the bank builds or customizes, the bank documents the training data: source, time period, population, exclusions, known gaps and biases, and whether it reflects the population the model will be used on.

---

## 9. Governance and board oversight (RB-GOV)

**RB-GOV-01 — Board-approved risk appetite and policy.** The board has approved a written statement of appetite for AI-related risk and an AI policy (or AI coverage in existing policies) that sets roles, approval authority, tiering, required controls, and escalation. Policies are reviewed at least annually and when material changes occur.

**RB-GOV-02 — Clear accountability.** A named senior management body or executive is accountable for AI risk across the bank. Each AI use has a named business owner. First-line, second-line (risk and compliance), and third-line (internal audit) roles are defined and staffed with people who understand the technology.

**RB-GOV-03 — Approval proportionate to risk.** High-risk AI uses (credit decisions, customer-facing generative tools, material use of customer data) are approved by the designated committee after risk, compliance, legal, and information security review, with dissent and conditions recorded in minutes. Approval conditions are tracked to completion.

**RB-GOV-04 — Board reporting.** The board or its risk committee receives regular reporting on the AI inventory, high-risk uses, incidents, complaints, validation and testing results, open findings, vendor issues, spending against budget, and results against expected benefits. Reports are accurate and not limited to good news.

**RB-GOV-05 — Credible challenge.** Minutes and records show real challenge by risk, compliance, legal, and security functions, and show that their concerns were resolved, not overridden without documented rationale. Revenue pressure is not a documented basis for skipping controls.

**RB-GOV-06 — Internal audit coverage.** Internal audit includes AI governance and high-risk AI uses in its risk assessment and audit plan, with auditors who have or can obtain the needed expertise.

**RB-GOV-07 — Staffing and training.** Staff who build, approve, use, or oversee AI tools are trained for their role. The bank can show it has enough qualified people (internal or contracted) to validate and monitor the tools it runs.

**RB-GOV-08 — Accurate benefit claims.** Revenue, savings, and performance figures presented to the board for AI initiatives are supported by data and methodology. Overstated benefits used to justify risk acceptance are a governance weakness.

**RB-GOV-09 — Issue management.** Findings from exams, audits, validations, and incidents are logged with owners and due dates, tracked, and independently validated when closed.

**RB-GOV-10 — Legal and regulatory change management.** The bank tracks changes in federal and state law relevant to its AI uses (including laws of states where its customers live) and updates policies and controls when the law changes.

---

## 10. Severity levels and remediation deadlines

Findings are graded by materiality and harm, not by count. The examiner weighs: actual or likely harm to customers; effect on the bank's financial condition or safety and soundness; whether a law was actually violated and whether the violation is substantive or technical; how widespread and how long-running the problem is; whether management found it first and was already fixing it; and repeat findings.

| Level | Use when | Required response | Typical deadline |
|---|---|---|---|
| **Observation** | A weakness that is not yet material; a technical (non-substantive) violation with no customer harm; or a material issue the bank identified itself and is promptly and credibly remediating. Also used for good-practice recommendations. | Management considers and responds; no formal action plan required. Examiner follows up at next exam. | Addressed by next scheduled exam (about 12 months). |
| **MRA (Matter Requiring Attention)** | A deficiency that is material to the bank's financial condition or risk management, or a substantive violation of law or regulation, that the bank has not already addressed. Examples: high-tier credit model in production without validation or fair lending review; adverse action notices that do not state actual reasons; customer data sent to an AI vendor without contractual safeguards; no inventory of AI tools; board reporting materially inaccurate. | Board-acknowledged written action plan with owners and dates; progress reporting to the examiner; independent validation (internal audit or equivalent) before closure. | Action plan within 30 days of the exam letter. Remediation typically 90 to 180 days; up to 12 months for program-level rebuilds (for example, a model risk program or data governance framework), with interim milestones. |
| **MRIA (Matter Requiring Immediate Attention)** | Ongoing or imminent significant harm to customers or to the bank's financial condition; a pattern of substantive legal violations; a repeat MRA not remediated by its deadline; or a deficiency serious enough to consider enforcement if not fixed. Examples: an AI tool actively giving customers false information about fees or dispute rights; a credit model producing unexplained denials at scale; a data leak through an AI tool that continues; failure to report a notification incident. | Immediate containment (pause or restrict the tool if needed); board-approved plan; customer remediation plan; frequent progress reports (at least monthly). | Containment within days (typically 5 to 15 business days). Action plan within 15 days. Remediation typically 30 to 90 days; customer restitution plan within 60 days. |
| **Enforcement referral** | Unsafe or unsound practice that presents an abnormal risk of significant harm; willful or repeated violations; widespread consumer harm; failure to correct an MRIA; false or misleading information given to examiners. | Referral to the Federal Reserve's enforcement function and, where consumer financial law is involved, coordination with the state and the consumer protection agency with jurisdiction. May lead to a board resolution, memorandum of understanding, written agreement, cease-and-desist order, or civil money penalties. | Board resolution or informal agreement typically within 60 to 90 days of referral; formal actions set their own deadlines (commonly 60 days for plans and 12 to 24 months for full compliance). |

Rules for grading:

1. Self-identification counts. A material problem the bank found and was credibly fixing before the exam is presumptively an observation, unless customers are still being harmed.
2. Customer harm raises severity. Identifiable harmed customers move a finding up at least one level from where the process weakness alone would place it.
3. Repeat findings escalate. An unremediated MRA past its deadline becomes an MRIA; an unremediated MRIA is referred for enforcement.
4. Documentation-only gaps with no effect on risk or customers are observations.
5. Every MRA and MRIA letter states: the expectation ID, the facts, the law or guidance involved, the risk or harm, required actions, and deadlines.
6. Findings are closed only after the examiner reviews evidence that remediation works, not on management's statement that it is done.

---

## 11. Examination triggers and scope

**Full-scope exam:** every 12 months. Always covers RB-GOV, the AI inventory (RB-MRM-01), a sample of high-tier models and AI tools across RB-MRM, RB-FL, RB-GAI, and RB-TPRM, open findings, and complaints.

**Targeted review:** opened between exams when any of the following occur:

- A high-severity incident involving an AI tool (customer data exposure, material financial loss, widespread wrong customer outcomes) or a notification incident report.
- A complaint spike: AI-channel complaints or overall complaint rate rising sharply over two consecutive months, or media coverage of customer harm.
- Fair lending indicators: unexplained approval or pricing disparities, a credit model launched without fair lending review, or referral from another agency.
- Launch of a new high-risk use (credit decisioning model, customer-facing generative tool) without evidence of the reviews required in RB-GOV-03.
- Credible information that staff are using unapproved AI tools with customer data at scale.

**Scope of a targeted review:** limited to the triggering area plus the governance controls that should have prevented it. Targeted reviews produce the same severity grades and deadlines as full-scope exams.

**Materials the examiner requests:** AI inventory; AI policy and risk appetite; committee charter, minutes, and vote records; model documentation and validation reports for sampled tools; fair lending testing; adverse action notice samples with the corresponding model reason codes; vendor contracts and due diligence files; incident log; complaint data by channel; board reports; internal audit reports; open issue log.

---

## Appendix: Verification status (as of September 2026)

Date checked for every item below: **2026-09-17**. "Retrieved" means the page was opened and read during verification. "Search result" means the source appeared in search results with a consistent summary but was not opened directly. Items marked **NOT CONFIRMED** could not be confirmed from primary or reliable secondary sources and should be re-checked before the full run.

### A. Model risk management guidance (SR 11-7 / OCC 2011-12)

- **Status:** Rescinded and replaced. On April 17, 2026, the Federal Reserve (SR 26-2), OCC (Bulletin 2026-13), and FDIC issued revised interagency model risk management guidance. It rescinds SR 11-7, SR 21-8 (BSA/AML model statement), OCC Bulletins 2011-12, 1997-24 (credit scoring models), and 2021-19, and the Comptroller's Handbook model risk booklet. The guidance is principles-based, states it sets no enforceable standards, is "expected to be most relevant" to banking organizations over $30 billion in assets (may apply to smaller banks with significant model risk), and explicitly excludes generative AI and agentic AI. The agencies said they would issue a request for information on model risk management and AI use "in the near future." Earlier, OCC Bulletin 2025-26 clarified that community banks are not required to perform annual model validation.
- **Effect on this rulebook:** The simulated banks (~$18B) are below the $30B focus threshold. RB-MRM is written as the examiner's risk-based expectation for a bank with high-materiality AI credit and customer-facing tools, which the new guidance permits. This is a design choice; a real examiner might apply lighter expectations to an $18B bank.
- **Sources:** https://www.federalreserve.gov/supervisionreg/srletters/SR2602.htm (retrieved); https://www.occ.gov/news-issuances/bulletins/2026/bulletin-2026-13.html (retrieved); https://www.orrick.com/en/Insights/2026/04/Agencies-Overhaul-Model-Risk-Management-Guidance-for-Banks-Heres-What-Changed (retrieved); https://www.occ.gov/news-issuances/bulletins/2025/bulletin-2025-26.html (search result); https://www.fdic.gov/news/press-releases/2026/agencies-issue-revised-model-risk-guidance (search result).
- **Not confirmed:** Whether the promised AI/model risk RFI has been issued. One secondary source (mightybot.ai, search result) said no RFI text was on the public record as of late August 2026. **NOT CONFIRMED** as of 2026-09-17. The Fed landing page did not show the $30B language or the generative AI exclusion; those details were confirmed from the OCC bulletin and Orrick.

### B. Interagency third-party risk management guidance (June 2023)

- **Status:** Still the final guidance in effect, but proposed for replacement. On September 11, 2026, the OCC, Federal Reserve, FDIC, and NCUA proposed new principles-based third-party risk management guidance that would rescind and replace the June 2023 guidance once final, citing overly broad interpretation and insufficient tailoring. The agencies also issued a statement on community bank engagement with core service providers. Comments are due 60 days after Federal Register publication (a law firm summary gives November 16, 2026; the Federal Register document is dated September 15, 2026).
- **Sources:** https://www.fdic.gov/news/press-releases/2026/agencies-seek-comment-proposed-third-party-risk-management-guidance-and (retrieved); https://www.federalregister.gov/documents/2026/09/15/2026-18859/proposed-third-party-risk-management-guidance (search result); https://www.skadden.com/insights/publications/2026/09/us-federal-banking-agencies-propose-revised-third-party (search result); https://www.federalregister.gov/documents/2023/06/09/2023-12340/interagency-guidance-on-third-party-relationships-risk-management (search result).
- **Not confirmed:** The exact comment deadline (November 16, 2026) was not confirmed from the Federal Register page itself.

### C. Supervisory findings standards (MRA/MRIA, unsafe or unsound practice)

- **Status:** Changed. OCC and FDIC adopted a final rule (adopted August 27, 2026; published September 1, 2026; effective November 2, 2026) that defines "unsafe or unsound practice" and limits MRAs to practices reasonably expected to materially harm financial condition or to actual violations of law; they intend to issue MRAs for violations only when substantive. The Federal Reserve did not join the rule. It issued a Statement of Supervisory Operating Principles (November 18, 2025; revised April 21, 2026) that limits MRAs/MRIAs to deficiencies creating a significant probability of significant harm to financial condition (or actual harm), presumptively treats self-identified and promptly remediated deficiencies as observations, and ties enforcement to "abnormal probability of abnormal harm."
- **Effect on this rulebook:** Section 10 reflects the higher materiality bar and the self-identification presumption. Consumer compliance findings based on actual substantive violations remain MRA-eligible.
- **Sources:** https://www.sullcrom.com/insights/memo/2026/September/OCC-FDIC-Adopt-Final-Rule-Defining-Unsafe-Unsound-Practice-Limiting-Issuance-Matters-Requiring-Attention (retrieved); https://www.occ.gov/news-issuances/bulletins/2026/bulletin-2026-40.html (search result); https://www.federalregister.gov/documents/2026/09/01/2026-17823/unsafe-or-unsound-practices-matters-requiring-attention (search result); https://www.sullcrom.com/insights/memo/2026/May/Federal-Reserve-Revises-Statement-Supervisory-Operating-Principles (retrieved); https://www.federalreserve.gov/newsevents/pressreleases/bcreg20251118a.htm (search result).
- **Not confirmed:** How the Fed's operating principles apply to consumer compliance findings at state member banks (the S&C summary did not address it). The remediation deadlines in Section 10 are **typical practice ranges written for this rulebook, not published regulatory deadlines**; no agency publishes fixed MRA deadlines.

### D. Reputation risk in supervision

- **Status:** Removed. OCC and FDIC final rule prohibiting use of reputation risk (published April 10, 2026; effective June 9, 2026). The agencies reissued interagency guidance documents with reputation risk references removed. The Federal Reserve removed reputation risk from its exam programs in June 2025 and proposed a codifying rule February 23, 2026; secondary sources said it was not yet final.
- **Effect on this rulebook:** No expectation cites reputation risk as a basis for criticism.
- **Sources:** https://www.federalregister.gov/documents/2026/04/10/2026-06947/prohibition-on-the-use-of-reputation-risk-by-regulators (search result); https://www.occ.gov/news-issuances/bulletins/2026/bulletin-2026-12.html (search result); https://www.fdic.gov/news/financial-institution-letters/2026/agencies-remove-references-reputation-risk-interagency (search result); https://www.globalfinregblog.com/2026/04/us-banking-regulators-finalize-rule-eliminating-use-of-reputation-risk/ (search result).
- **Not confirmed:** Whether the Federal Reserve's reputation-risk rule has been finalized since the secondary sources were written. **NOT CONFIRMED.**

### E. ECOA / Regulation B and disparate impact

- **Status:** Changed. Executive Order 14281, "Restoring Equality of Opportunity and Meritocracy" (April 23, 2025), directed agencies to deprioritize disparate-impact enforcement. The OCC removed disparate impact from its fair lending exam procedures (Bulletin 2025-16, July 2025) and the FDIC removed disparate impact analysis from its consumer compliance exam manual (August 2025). The CFPB issued a final Regulation B rule (issued April 22, 2026; published April 24, 2026 per Husch Blackwell, Federal Register URL dated April 22; effective July 21, 2026) stating ECOA does not provide for disparate-impact ("effects test") liability, narrowing "discouragement" to statements of intent to discriminate, and barring for-profit special purpose credit programs from using race, color, national origin, or sex as eligibility criteria. Adverse action notice requirements (specific principal reasons, 12 CFR 1002.9) were not reported as changed. Law firms note Fair Housing Act disparate impact, state law, and private claims remain possible, and litigation over the rule is expected.
- **Effect on this rulebook:** RB-FL tests disparate treatment and adverse action accuracy as violations; disparate impact is treated as Fair Housing Act/state-law risk management (RB-FL-05).
- **Sources:** https://www.huschblackwell.com/newsandinsights/cfpb-finalizes-major-regulation-b-overhaul-disparate-impact-out-discouragement-narrowed-and-spcps-restricted (retrieved); https://www.federalregister.gov/documents/2026/04/22/2026-07804/equal-credit-opportunity-act-regulation-b (search result; direct fetch was blocked by the Federal Register site); https://www.mayerbrown.com/en/insights/publications/2025/04/trump-executive-order-seeks-to-eliminate-disparate-impact-liability (search result); https://www.bankingdive.com/news/occ-drops-disparate-impact-liability-from-supervision-exam-metrics/753092/ (search result); https://www.consumerfinancialserviceslawmonitor.com/2025/09/fdic-updates-consumer-compliance-examination-manual-to-eliminate-disparate-impact-analysis-in-response-to-president-trumps-executive-order/ (search result).
- **Not confirmed:** (1) Whether the Federal Reserve formally changed its own fair lending exam procedures for state member banks the way OCC and FDIC did. **NOT CONFIRMED.** (2) Whether any lawsuit has stayed or vacated the April 2026 Regulation B rule. **NOT CONFIRMED.** (3) HUD's status on its Fair Housing Act disparate impact rule was mentioned as proposed in one secondary source but not checked.

### F. CFPB adverse action circulars on complex algorithms (2022-03, 2023-03)

- **Status:** Withdrawn. Both circulars were among 67 guidance documents the CFPB withdrew effective May 12, 2025 (Federal Register notice May 12, 2025). The CFPB said the withdrawn documents would not be enforced while under review. The underlying Regulation B requirement to state specific principal reasons remains in the regulation.
- **Effect on this rulebook:** RB-FL-03 relies on the regulation's text, not the circulars.
- **Sources:** https://www.federalregister.gov/documents/2025/05/12/2025-08286/interpretive-rules-policy-statements-and-advisory-opinions-withdrawal (search result); https://www.consumerfinance.gov/compliance/guidance/withdrawn-guidance/ (search result); https://www.venable.com/insights/publications/2025/05/cfpb-withdraws-guidance-documents-a-shift (search result).
- **Not confirmed:** Whether the CFPB's promised "further review" reinstated any of these documents. **NOT CONFIRMED.**

### G. CFPB structure, funding, staffing, and supervision priorities

- **Status:** Reduced and in litigation. The July 4, 2025 budget reconciliation law cut the CFPB's funding cap from 12% to 6.5% of the Federal Reserve's 2009 operating expenses. Courts ruled the administration must keep requesting CFPB funding. A reduction-in-force remains subject to an injunction in NTEU v. Vought; in April 2026 the CFPB asked to cut staff by about two-thirds, with no final ruling found. An April 16, 2025 memo shifted supervision toward depository institutions and actual fraud with identifiable victims and cut exam volume; a November 2025 "humility" pledge promised different supervision in 2026. The large-bank consumer supervision role still applies to banks over $10B.
- **Sources:** https://www.bankingdive.com/news/cfpb-workforce-reduction-plan-vought-cut-53-percent-618-nteu-farman-big-beautiful-fed-funding/816489/ (search result); https://bankingjournal.aba.com/2026/01/court-rules-that-administration-must-request-cfpb-funding/ (search result); https://www.consumerfinancemonitor.com/2026/04/08/cfpb-workforce-restructuring-plan-new-cfpb-motion-details-sweeping-proposed-reductions-in-staff-across-all-divisions-while-injunction-remains-in-place/ (search result); https://www.consumerfinancialserviceslawmonitor.com/2025/04/cfpb-announces-2025-supervision-and-enforcement-priorities/ (search result); https://www.pymnts.com/news/cfpb/2025/cfpb-pledges-fundamentally-different-supervision-in-2026 (search result).
- **Not confirmed:** Current D.C. Circuit outcome in NTEU v. Vought and actual CFPB headcount as of September 2026. **NOT CONFIRMED.** Whether the CFPB is currently examining banks in the $10B-$25B range at any meaningful frequency. **NOT CONFIRMED.**

### H. CFPB larger-participant rules and Section 1033

- **Status:** Digital payment app larger-participant rule repealed by Congressional Review Act resolution signed May 9, 2025. Auto finance larger-participant rule not rescinded; August 8, 2025 advance notices proposed raising thresholds. Section 1033 personal financial data rights rule: under reconsideration (ANPR August 22, 2025) and enjoined by a federal court in Kentucky pending reconsideration; original compliance dates did not take effect as scheduled.
- **Sources:** https://www.hklaw.com/en/insights/publications/2025/05/cfpb-overdraft-and-digital-payment-rules-repealed (search result); https://www.federalregister.gov/documents/2025/08/08/2025-15089/defining-larger-participants-of-the-automobile-financing-market (search result); https://www.federalregister.gov/documents/2025/08/22/2025-16139/personal-financial-data-rights-reconsideration (search result); https://www.cozen.com/news-resources/publications/2026/section-1033-compliance-date-open-banking-rule-enjoined-and-under-reconsideration (search result).
- **Not confirmed:** Whether a 1033 proposed rule has been issued since mid-2026, and whether the auto larger-participant threshold change was finalized. **NOT CONFIRMED.** Not central to this rulebook.

### I. FCRA / Regulation V

- **Status:** Statute and Regulation V unchanged in the respects this rulebook relies on. The CFPB withdrew its proposed data broker rule (withdrawal published May 15, 2025). A federal court in the Eastern District of Texas vacated the CFPB's medical debt credit reporting rule on July 11, 2025. Several FCRA-related guidance documents were in the May 2025 withdrawal.
- **Sources:** https://www.federalregister.gov/documents/2025/05/15/2025-08644/protecting-americans-from-harmful-data-broker-practices-regulation-v-withdrawal-of-proposed-rule (search result); https://www.bhfs.com/insight/federal-court-vacates-cfpbs-medical-debt-rule-finds-fcra-preempts-state-laws/ (search result).
- **Not confirmed:** Any 2026 FCRA rulemaking. None found; **NOT CONFIRMED** that none exists.

### J. GLBA safeguards, privacy, and incident notification

- **Status:** In effect. Interagency Guidelines Establishing Information Security Standards (bank version of GLBA safeguards) remain current in the eCFR. The interagency computer-security incident notification rule (notify primary federal regulator within 36 hours of determining a notification incident) remains in effect per secondary sources. The FTC Safeguards Rule applies to non-bank financial institutions, not to this bank.
- **Sources:** https://www.ecfr.gov/current/title-12/chapter-III/subchapter-B/part-364/appendix-Appendix%20B%20to%20Part%20364 (search result); https://www.federalreserve.gov/supervisionreg/interagencyguidelines.htm (search result); https://www.aba.com/news-research/analysis-guides/data-security-customer-notification (search result).
- **Not confirmed:** Any 2025-2026 amendment to the incident notification rule or Regulation P. None found; **NOT CONFIRMED** from a primary source.

### K. UDAAP

- **Status:** Statute unchanged. The CFPB withdrew its April 2023 policy statement on "abusive" acts or practices in May 2025 as part of the mass guidance withdrawal. Enforcement priorities now emphasize actual fraud, identifiable victims, and measurable harm (see G). State UDAP laws unaffected.
- **Sources:** https://www.bairdholm.com/blog/cfpb-rescinds-policy-defining-abusive-standard-for-udaap/ (search result); https://www.consumerfinancialserviceslawmonitor.com/2025/05/cfpb-rescinds-dozens-of-regulatory-guidance-documents-in-major-regulatory-shift/ (search result).
- **Not confirmed:** Whether the CFPB has issued a replacement UDAAP policy or rule in 2026. **NOT CONFIRMED.**

### L. TCPA and AI-generated voices

- **Status:** In effect. FCC Declaratory Ruling (FCC 24-17, adopted February 8, 2024) holds that AI-generated voices are "artificial" voices under the TCPA, requiring consent for covered calls. A September 2024 FCC proposal on AI call disclosures was noted in secondary sources.
- **Sources:** https://docs.fcc.gov/public/attachments/FCC-24-17A1.pdf (search result); https://www.fcc.gov/document/fcc-confirms-tcpa-applies-ai-technologies-generate-human-voices (search result).
- **Not confirmed:** Whether the 2024 AI disclosure proposal was finalized or withdrawn. **NOT CONFIRMED.**

### M. Banking agency AI guidance or RFIs, 2025-2026

- **Status:** No dedicated interagency AI guidance found. The April 2026 model risk guidance excludes generative and agentic AI and promises an RFI (see A). A May 2026 secondary source described an OCC report signaling AI governance guidance "on the horizon." The prior Treasury RFI on AI in financial services (June 2024) and the 2021 five-agency AI RFI did not produce binding guidance.
- **Sources:** https://www.occ.gov/news-issuances/bulletins/2026/bulletin-2026-13.html (retrieved); https://www.consumerfinanceinsights.com/2026/05/19/4745/ (search result); https://www.federalregister.gov/documents/2024/06/12/2024-12336/request-for-information-on-uses-opportunities-and-risks-of-artificial-intelligence-in-the-financial (search result).
- **Not confirmed:** Whether the RFI issued between late August and September 17, 2026, and the contents of the OCC report referenced by the May 2026 article. **NOT CONFIRMED.** RB-GAI expectations are therefore general risk management and consumer law expectations, not codified AI rules.

### N. State AI laws

**Colorado (SB 24-205, the Colorado AI Act, and SB 26-189).**
- **Status:** Original act delayed from February 1, 2026 to June 30, 2026 by SB 25B-004 (signed August 28, 2025). xAI sued (April 9, 2026); the DOJ joined (April 24, 2026); the U.S. District Court for the District of Colorado paused enforcement (April 27, 2026). The legislature passed SB 26-189 (May 9, 2026; signed May 14, 2026), which repeals and reenacts the law as a narrower disclosure-based regime effective January 1, 2027: developer documentation to deployers, consumer notice of adverse consequential decisions (including financial or lending services), human review/appeal rights, and a 60-day cure period. Secondary sources report the original anti-discrimination duty was dropped.
- **Relevance:** Applies to Colorado consumers. Relevant only if the bank lends to Colorado residents.
- **Sources:** https://www.mcdermottlaw.com/insights/colorado-ai-law-in-flux-comprehensive-replacement-bill-signed-after-federal-court-blocks-predecessors-enforcement/ (retrieved); https://www.akingump.com/en/insights/ai-law-and-regulation-tracker/colorado-postpones-implementation-of-colorado-ai-act-sb-24-205 (search result); https://ourtake.bakerbotts.com/post/102msga/colorado-repeals-and-replaces-ai-act (search result); https://www.axios.com/2026/04/24/justice-department-joins-xai-challenge-colorado-ai-law (search result); https://www.techtimes.com/articles/319420/20260701/colorado-ai-law-reset-discrimination-duty-dropped-disclosure-takes-its-place.htm (search result).
- **Not confirmed:** Whether the xAI/DOJ lawsuit continues against SB 26-189 or was mooted; whether SB 26-189 exempts banks subject to federal prudential supervision. **NOT CONFIRMED.**

**Texas (HB 149, Texas Responsible Artificial Intelligence Governance Act).**
- **Status:** Signed June 22, 2025; effective January 1, 2026. Prohibits certain intentional harmful uses (manipulation, intentional unlawful discrimination, etc.), creates a sandbox and advisory council. Secondary sources report an exemption for federally insured financial institutions that comply with federal and state banking laws.
- **Sources:** https://www.lw.com/en/insights/texas-signs-responsible-ai-governance-act-into-law (search result); https://www.hudsoncook.com/article/new-texas-law-offers-financial-institutions-an-innovation-friendly-ai-framework/ (search result).
- **Not confirmed:** Exact wording and scope of the financial institution exemption. **NOT CONFIRMED** from statute text.

**California.**
- **Status:** (1) CPPA regulations on automated decisionmaking technology, risk assessments, and cybersecurity audits finalized September 2025; ADMT obligations for significant decisions begin January 1, 2027, with pre-use notice and risk assessments by April 1, 2027. The CCPA does not apply to personal information subject to GLBA, so bank lending decisions based on GLBA-covered data are largely outside it; non-GLBA data (marketing, behavioral, geolocation) can be in scope. (2) SB 53, Transparency in Frontier Artificial Intelligence Act, signed September 29, 2025, effective January 1, 2026; applies to large frontier model developers, not to banks deploying AI. (3) SB 7, "No Robo Bosses Act," vetoed October 13, 2025.
- **Sources:** https://cppa.ca.gov/announcements/2025/20250923.html (search result); https://cppa.ca.gov/regulations/ccpa_updates.html (search result); https://www.capco.com/intelligence/capco-intelligence/californias-new-automated-decision-making-technology-rules (search result); https://www.mofo.com/resources/insights/251001-california-enacts-ai-safety-transparency-regulation-tfaia-sb-53 (search result); https://www.fisherphillips.com/en/insights/insights/california-governor-vetoes-no-robo-bosses-act (search result).
- **Not confirmed:** The exact ADMT compliance dates were taken from law firm summaries, not the regulation text. **NOT CONFIRMED** from primary text. Whether the Commerce evaluation or DOJ task force has targeted California laws. **NOT CONFIRMED.**

**Utah (Artificial Intelligence Policy Act, as amended by SB 226 and SB 332 in 2025).**
- **Status:** In effect; repeal date extended to July 1, 2027. Generative AI disclosure required when a consumer clearly asks, and proactively in "high-risk" interactions in regulated occupations involving financial data or financial advice; safe harbor for clear upfront disclosure; $2,500 per violation.
- **Sources:** https://le.utah.gov/~2025/bills/static/SB0226.html (search result); https://www.davispolk.com/insights/client-update/utah-scales-back-reach-generative-ai-consumer-protection-law (search result).
- **Not confirmed:** Whether Utah's 2026 session extended or changed the July 1, 2027 repeal date. **NOT CONFIRMED.**

**Illinois (HB 3773, amending the Illinois Human Rights Act).**
- **Status:** Effective January 1, 2026. Prohibits employer use of AI that has a discriminatory effect in employment decisions, bars ZIP code as a proxy, requires notice to employees and applicants. Implementing rules proposed by the Illinois Department of Human Rights were postponed in 2026; statutory obligations remain in effect.
- **Relevance:** Employment only; relevant if the bank uses AI in hiring or HR for Illinois workers.
- **Sources:** https://natlawreview.com/article/illinois-anti-discrimination-law-address-ai-goes-effect-1-january-2026 (search result); https://www.seyfarth.com/news-insights/illinois-department-of-human-rights-temporarily-withdraws-proposed-rules-on-use-of-artificial-intelligence-in-employment.html (search result).
- **Not confirmed:** Current status of the IDHR rulemaking. **NOT CONFIRMED.**

**New York City (Local Law 144, automated employment decision tools).**
- **Status:** In effect since 2023 (bias audits and notices for AI hiring/promotion tools). A December 2025 New York State Comptroller audit found enforcement by the city's Department of Consumer and Worker Protection ineffective; secondary sources expect stricter enforcement in 2026.
- **Sources:** https://www.osc.ny.gov/state-agencies/audits/2025/12/02/enforcement-local-law-144-automated-employment-decision-tools (search result).
- **Not confirmed:** Any 2026 amendments to LL144 or its rules. **NOT CONFIRMED.**

**Overall state activity:** a July 2026 secondary source reported 109 AI-related state laws enacted in 2026 as of July 1. Not individually reviewed.
- **Source:** https://www.techpolicy.press/where-state-ai-legislation-stands-half-way-into-2026/ (search result).

### O. Federal preemption of state AI laws

- **2025 budget bill moratorium:** Congress did not enact the proposed moratorium on state AI laws in the One Big Beautiful Bill Act (July 2025) and did not include one in the FY2026 National Defense Authorization Act.
  - Sources: https://www.morganlewis.com/pubs/2026/03/white-house-ai-framework-puts-federal-preemption-at-the-center-of-the-debate (search result); https://statescoop.com/state-ai-law-moratorium-omitted-2026-defense-bill-trump-eo/ (search result).
- **Executive Order 14365, "Ensuring a National Policy Framework for Artificial Intelligence" (December 11, 2025):** directs an AI Litigation Task Force at DOJ, a Commerce Department evaluation of "onerous" state AI laws within 90 days, BEAD non-deployment funding restrictions for states with such laws, FCC proceedings on a preemptive federal reporting standard, an FTC policy statement on state laws requiring altered AI outputs, and legislative recommendations with carve-outs (child safety, compute/data center infrastructure, state procurement).
  - Source: https://www.whitehouse.gov/presidential-actions/2025/12/eliminating-state-law-obstruction-of-national-artificial-intelligence-policy/ (retrieved).
- **DOJ AI Litigation Task Force:** established by Attorney General memorandum dated January 9, 2026; joined the xAI suit against Colorado in April 2026.
  - Sources: https://www.justice.gov/ag/media/1422986/dl?inline= (search result); https://www.cbsnews.com/news/doj-creates-task-force-to-challenge-state-ai-regulations/ (search result); https://www.jenner.com/en/news-insights/client-alerts/doj-joins-xai-in-lawsuit-challenging-colorado-ai-act (search result).
- **Commerce evaluation of state laws (due March 11, 2026):** secondary sources as of spring 2026 said it had not been publicly released.
  - Sources: https://www.ropesgray.com/en/insights/alerts/2026/03/examining-the-landscape-and-limitations-of-the-federal-push-to-override-state-ai-regulation (search result); https://statt.com/blog/state-ai-laws/ (search result).
  - **NOT CONFIRMED** whether it has been released since. Also **NOT CONFIRMED:** status of the FCC proceeding and FTC policy statement ordered by the EO.
- **White House legislative framework:** "National Policy Framework for Artificial Intelligence" legislative recommendations released March 20, 2026, calling on Congress to preempt unduly burdensome state AI laws while preserving generally applicable state law.
  - Source: https://www.whitehouse.gov/wp-content/uploads/2026/03/03.20.26-National-Policy-Framework-for-Artificial-Intelligence-Legislative-Recommendations.pdf (search result).
- **2026 legislation:** H.R. 8516, American Leadership in AI Act, introduced April 27, 2026 (committee stage as last reported). A "Great American Artificial Intelligence Act of 2026" discussion draft (Reps. Obernolte and Trahan, June 4, 2026) would preempt state laws specifically regulating AI model development for three years, with savings clauses for state consumer protection, privacy, anti-discrimination, and civil rights laws; not formally introduced as of the source. Other bills exist (e.g., H.R. 5388).
  - Sources: https://www.congress.gov/bill/119th-congress/house-bill/8516 (search result); https://www.techpolicy.press/unpacking-the-great-american-artificial-intelligence-act-of-2026/ (retrieved); https://www.congress.gov/bill/119th-congress/house-bill/5388 (search result).
  - **NOT CONFIRMED:** any floor action or enactment of federal AI preemption legislation as of September 17, 2026. None found.
- **Effect on this rulebook:** No enacted federal law preempts state consumer protection, anti-discrimination, or privacy laws as applied to banks' AI use. RB-GOV-10 requires the bank to track this area.

### P. Items in this rulebook that are design choices, not verified law

- Remediation deadline ranges in Section 10 (no agency publishes fixed deadlines).
- The 12-month full-scope exam cycle and targeted-review triggers in Section 11 (simplified from actual Federal Reserve/state exam scheduling, which varies with bank size, rating, and alternating state exams).
- Applying RB-MRM at full strength to an $18B bank despite the revised guidance's $30B focus.
- Record retention of 25 months in RB-FL-09 reflects Regulation B's general retention period as commonly understood; the specific retention period was not re-verified from 12 CFR 1002.12 during this check. **NOT CONFIRMED** from primary text.
