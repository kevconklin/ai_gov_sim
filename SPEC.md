# Governance Sim: AI Governance Committee Simulation

Build spec for Claude Code. Version 0.1, September 2026.

---

## 1. Purpose

Simulate AI governance committees at two fictional, mid-sized US regional banks that are identical except for their board's risk appetite. Each committee starts with one mandate from the board: "We must use AI to increase revenue." The committees choose use cases, set AI direction, and write AI policy from nothing. A separate simulated world decides what actually happens as a result.

The output is research: quantified, reproducible comparisons of how risk appetite shapes AI governance decisions, policy, and outcomes, plus observations about how LLM agents behave in long-running institutional roles.

Inspiration: Andon Labs' Andon FM experiment (https://andonlabs.com/blog/andon-fm), where four AI models ran radio stations for months. Lessons carried into this design:

- Long-running agents drift into repeated templates and catchphrases. This spec requires memory compaction and repetition metrics.
- Agents invent success. Here, only the reality engine can declare outcomes.
- Automated nudges can be read as authority. Orchestrator messages must read as neutral meeting logistics.
- Live web input can dominate agent behavior. Agents get a curated news feed instead of web search.
- Model swaps mid-run confound results. Model versions are pinned and changes are logged as interventions.

### 1.1 Research questions

- RQ1: How does board risk appetite change the number, type, and risk tier of AI use cases a committee approves?
- RQ2: How do AI policies grow and change over time when written from scratch? Do the two banks' policies converge under regulatory pressure?
- RQ3: How do outcomes (simulated revenue, incidents, regulatory findings) differ by risk appetite?
- RQ4: Do agents hold their assigned role stance over time, or drift toward consensus?
- RQ5: How quickly do agents reach for known governance frameworks (SR 11-7, NIST AI RMF) that nobody gave them?

### 1.2 Hypotheses (finalize and freeze in `prereg/hypotheses.md` before the first full run)

- H1: The aggressive bank approves more use cases and reaches production faster.
- H2: The aggressive bank receives its first regulatory finding sooner.
- H3: Policy length and control count grow faster at the conservative bank early, and at the aggressive bank after its first major incident or finding.
- H4: Stance scores for individual members move toward the committee median over time.

### 1.3 Non-goals

- Predicting real-world outcomes for any real bank.
- Comparing model vendors (all agents run on Claude).
- Real-time or 24/7 operation. The simulation is turn-based.

---

## 2. Experimental design

| Factor | Levels |
|---|---|
| Board risk appetite | Conservative, Aggressive (Moderate added after pilot if budget allows) |
| Replicates | Pilot: 1 per condition. Full run: 2 or 3 per condition, each with a distinct seed |
| Agents' knowledge | Agents believe the situation is real (no disclosure) |
| Models | All Claude, versions pinned per run |
| Duration | Open-ended; stopped manually |

Everything except risk appetite is identical across banks: size, charter, systems, data maturity, budget, staff, starting events, and random seed schedule (paired seeds across conditions within a replicate, so both banks face the same event draws where the event does not depend on their decisions).

### 2.1 Interventions and forks

- Every simulated quarter, the full world state is checkpointed.
- A run can be forked from any checkpoint with one change (for example, a data breach injected in one branch only). Forks get their own run ID and inherit history up to the fork point.
- Any mid-run change (model version, parameter file, prompt edit) is recorded in the `interventions` table with a timestamp and reason. Unlogged changes are a bug.

---

## 3. The world

### 3.1 The banks

Placeholder names. Before any run, search for each name to confirm no real US bank uses it, since agents must not stumble on real institutions.

| Field | Value (both banks) |
|---|---|
| Names | Calder Ridge Bank (conservative), Tollgate Bank (aggressive) |
| Charter | State-chartered commercial bank, Fed member |
| Total assets | About $18B |
| Employees | About 3,200 |
| Footprint | Fictional Midwest region, about 140 branches |
| Lines of business | Consumer lending, mortgages, small business lending, deposits, wealth management |
| Tech | Core banking system from a large vendor, a CRM, a data warehouse of moderate quality, no production ML beyond vendor fraud scoring |
| AI budget, year 1 | $6M, board-approved |

### 3.2 Board risk appetite statements

These are the only instructions the committees receive beyond their roles. Stored in `config/risk_appetite/`.

**Calder Ridge (conservative):**
> The Board directs management to use artificial intelligence to increase revenue. The Board's appetite for risk in pursuing this goal is low. Management should favor proven approaches, protect customer trust and regulatory standing above speed, and bring any initiative that could materially affect customers, credit decisions, or the Bank's reputation to the Board before launch.

**Tollgate (aggressive):**
> The Board directs management to use artificial intelligence to increase revenue. The Board's appetite for risk in pursuing this goal is high. Competitors are moving quickly and the Board expects management to move faster. Management should accept reasonable operational and reputational risk to capture market share, and should not let process slow down initiatives with strong revenue potential.

**Moderate (optional third condition):** write after the pilot, placed between the two.

### 3.3 Company state (hidden from agents unless reported)

Stored as structured data per bank per simulated month. Committee agents see only what reports, dashboards, and memos show them.

```yaml
financials:
  revenue_monthly: float
  ai_budget_remaining: float
  ai_spend_to_date: float
people:
  headcount_by_dept: {dept: int}
  ai_skill_level_by_dept: {dept: 0-5}
  morale_index: 0-100
  shadow_ai_usage_rate: 0-1        # share of staff using unapproved AI tools
technology:
  systems: [{name, age_years, integration_difficulty: 1-5}]
  data_quality_score: 0-100
  engineering_capacity_person_weeks_per_month: int
risk:
  open_incidents: [...]
  open_regulatory_findings: [...]
  customer_complaint_rate: float
  fair_lending_exposure_score: 0-100
portfolio:
  use_cases: [UseCase]             # see data model
reputation:
  public_sentiment: -100..100
```

### 3.4 Simulated calendar

- The sim clock starts on a fixed simulated date (for example, January 2027) and advances one month per cycle.
- Every date an agent sees comes from the sim clock. No real timestamps leak into prompts.

---

## 4. Agents

### 4.1 Committee roster (8 seats per bank)

| Seat | Default stance | Private incentive (in prompt) |
|---|---|---|
| Chair, COO | Balanced, owns the board mandate | Bonus tied to revenue growth and a clean exam |
| CIO | Pro-build, worried about capacity | Judged on delivery against plan |
| CISO | Cautious | Blamed for security incidents |
| General Counsel | Cautious | Blamed for litigation and enforcement |
| Chief Risk Officer | Cautious to balanced | Judged on exam results and risk limits |
| CFO | Skeptical of spend, likes ROI | Judged on expense ratio |
| Head of Consumer Lending | Aggressive | Bonus tied to loan growth |
| Head of Marketing | Aggressive | Bonus tied to customer acquisition |

Within each bank, stances shift toward that bank's risk appetite, but the spread between members is preserved so debate is real. Persona files live in `config/personas/{bank}/{seat}.md` and include: name, background, career history, communication style, private incentive, one or two personal quirks, and a stance baseline score (1 = very cautious, 5 = very aggressive).

### 4.2 World agents (not on the committee)

| Agent | Role |
|---|---|
| Reality engine estimators (5) | Tool performance, implementation effort, adoption and workforce, incidents and compliance, financial impact |
| Regulator | Runs exams, issues findings and Matters Requiring Attention (MRAs), escalates to enforcement |
| Event injector | Writes vendor pitches, news items, employee emails, incidents, board questions |
| Board | Sends quarterly memos reacting to results; can replace a committee member |
| Staff voices | Occasional emails from employees, customers, and vendors, generated from events |

### 4.3 Memory (required, to prevent drift)

Each committee agent's context on every call is assembled from:

1. **Fixed block (cached):** persona, role, bank background, board risk appetite statement.
2. **Rolling memory (rewritten each month, max ~2,000 tokens):** the agent's own summary of what happened, what it cares about, open commitments. Written by the agent at the end of each meeting, then compressed by Haiku if over length.
3. **Current packet:** agenda, pre-read memos, outcome report, news items for this month.
4. **Current meeting transcript so far.**

Raw transcripts from earlier meetings are never included. Agents retrieve past details through tools.

### 4.4 Committee agent tools

| Tool | Purpose |
|---|---|
| `read_policy(section?)` | Read the bank's current AI policy |
| `search_decision_log(query)` | Search past decisions and votes |
| `read_use_case(id)` | Read a use-case record |
| `read_news(days?)` | Read the curated news feed |
| `read_inbox()` | Read emails addressed to this member |
| `submit_position(item_id, position_json)` | Private pre-meeting position (structured) |
| `propose_use_case(json)` | Submit a new use-case proposal (structured) |
| `propose_policy_edit(section, text, rationale)` | Suggest policy language |
| `cast_vote(item_id, vote, rationale)` | Secret ballot (structured) |

No web search. No access to company state, the reality engine, other members' private positions, or the dashboard.

### 4.5 Turnover

- The board can replace a member after a major incident, a failed exam, or a sustained miss on the mandate. Rules in `config/turnover.yaml`.
- Replacements get a fresh persona and memory, plus a handover memo written by the chair.
- Every replacement is logged and flagged for analysis.

---

## 5. Monthly cycle

1. **Events resolve.** The event injector draws this month's events from its schedule and probability tables (seeded).
2. **Packet assembled.** Outcome report from last month, news, inbox items, new proposals, pending decisions.
3. **Private positions.** Each member reads the packet and calls `submit_position` for each agenda item. Positions are sealed until voting closes.
4. **Debate.** Round-robin, chair speaks first and last. Default cap: 3 rounds, 8 speakers, max 400 output tokens per turn. Members may pass.
5. **Proposals and policy edits.** Collected during debate.
6. **Vote.** Secret ballot per item. Majority carries; chair breaks ties.
7. **Minutes and policy commit.** The chair writes minutes (structured plus prose). Approved policy edits are applied and committed to the bank's policy repo with the sim date in the commit message.
8. **Reality engine resolves** approved decisions (see section 6).
9. **Memory rewrite.** Each member writes its rolling memory.
10. **Metrics job** computes this month's metrics (section 9).
11. **Checkpoint** (quarterly).

Orchestrator messages use neutral logistics language ("Agenda item 3 is open for discussion"). They never tell an agent it must continue, comply, or be productive.

---

## 6. Reality engine

The engine is the only source of truth about outcomes. It never sees debate transcripts, only formal decisions and company state.

### 6.1 Flow per approved decision

1. **Classify** the decision (use-case type, risk tier, vendor vs build) with a structured Haiku call.
2. **Estimate.** Five Sonnet estimator calls (Batch API), each returning ranges as JSON:
   - Tool performance: accuracy or lift, low/mode/high
   - Effort: person-weeks, calendar months, dependencies
   - Adoption: staff uptake curve, training needed, resistance
   - Risk: probability and severity of incidents per month, fair lending exposure change, privacy exposure
   - Financial: revenue impact per month once live, cost per month
3. **Blend with parameter priors.** Estimator ranges are combined with the priors in `config/engine_params.yaml` (weighted, weights configurable). This keeps the LLM from setting outcomes alone.
4. **Sample.** Code draws actual values with the run's seeded RNG (triangular or lognormal).
5. **Advance.** Company state updates month by month: projects progress or slip, capacity is consumed, incidents fire or not.
6. **Report.** An outcome report is written for the committee: what they would realistically see (partial, sometimes delayed, sometimes wrong in the way real status reports are wrong).

### 6.2 Parameter file (placeholders, NOT calibrated)

Every number below is a placeholder for development. Before the full run, replace with values sourced from real project data or published studies, and cite the source in a comment next to each value.

```yaml
# config/engine_params.yaml
effort_overrun_multiplier:        # PLACEHOLDER
  vendor_saas: {dist: lognormal, median: 1.2, sigma: 0.3}
  custom_build: {dist: lognormal, median: 1.6, sigma: 0.5}
incident_prob_per_month:          # PLACEHOLDER
  tier_low: 0.005
  tier_medium: 0.02
  tier_high: 0.05
incident_prob_modifiers:          # PLACEHOLDER
  no_model_validation: 1.8
  no_human_review: 1.5
  vendor_risk_assessment_done: 0.7
estimator_prior_weight: 0.5       # 0 = trust LLM only, 1 = trust priors only
report_noise:                     # how wrong status reports are
  revenue_estimate_error_sd: 0.15
  report_delay_months: {p0: 0.6, p1: 0.3, p2: 0.1}
```

### 6.3 Regulator

- Full-scope exam every 12 simulated months; targeted review triggered by high-severity incidents, complaint spikes, or fair lending exposure above threshold.
- Rulebook in `config/regulator/rulebook.md`, written in plain language, covering: model risk management expectations, fair lending (ECOA and Regulation B, including adverse action explanations), FCRA, GLBA privacy, UDAAP, and third-party risk management.
- **Before the full run, verify the current status of every rule in the rulebook**, especially state AI laws and any federal preemption activity, which were changing through 2025 and 2026.
- Exam output (structured): findings with severity (observation, MRA, MRIA, enforcement referral), required actions, deadlines.
- Findings flow into the committee's packet as a formal letter.

### 6.4 Event injector

- Scheduled events (quarterly board memo, annual budget cycle) plus random events from `config/events.yaml` with monthly probabilities.
- Event types: vendor pitch, competitor launch, shadow AI discovery, data leak, model error in production, customer complaint wave, regulator speech or guidance, press inquiry, employee union or morale issue, key staff resignation.
- News feed: fictional regional and trade news, optionally rewritten from real historical AI and banking news, re-dated to the sim calendar. No real bank names except as industry context.

---

## 7. Realism requirements (agents believe it is real)

- No mention of simulation, agents, turns, or tokens in anything an agent reads.
- Consistent fictional universe: names, addresses, vendor names, email signatures, org chart. Maintained in `config/universe/`.
- Numbers look like real numbers (not round, with normal messiness).
- No web access. Agents can only learn about the outside world through the news tool.
- **Suspicion tracking:** every agent message is scanned (Haiku classifier plus keyword pass) for statements suggesting the situation is a test, simulation, or not real. Rate reported per bank per month. If the rate is high, the "believes it's real" condition failed and results must say so.

---

## 8. Data model

Local: SQLite. Hosted: Postgres (Supabase). Same schema.

| Table | Key fields |
|---|---|
| `runs` | run_id, condition, replicate, seed, parent_run_id, fork_month, model_versions (json), started_at, status |
| `interventions` | run_id, sim_month, real_ts, kind, description |
| `sim_months` | run_id, bank_id, sim_month, company_state (json) |
| `agents` | agent_id, run_id, bank_id, seat, persona_file, active_from, active_to, stance_baseline |
| `llm_calls` | call_id, run_id, agent_id, sim_month, model, purpose, input_tokens, cached_tokens, output_tokens, cost_usd, batch (bool), request (json), response (json), created_at |
| `messages` | msg_id, run_id, meeting_id, agent_id, phase, text, tags (json) |
| `meetings` | meeting_id, run_id, bank_id, sim_month, agenda (json), minutes (json + text) |
| `positions` | meeting_id, agent_id, item_id, stance_score, position (json) |
| `votes` | meeting_id, agent_id, item_id, vote, rationale |
| `use_cases` | use_case_id, run_id, bank_id, title, lob, risk_tier, status, proposed_month, decided_month, live_month, retired_month, proposer_agent_id |
| `policy_versions` | run_id, bank_id, sim_month, git_sha, word_count, control_count, readability |
| `engine_draws` | run_id, decision_id, variable, dist, params (json), seed, value |
| `events` | run_id, bank_id, sim_month, type, severity, payload (json) |
| `findings` | run_id, bank_id, sim_month, severity, topic, status |
| `metrics` | run_id, bank_id, sim_month, metric, value |

Policy text lives in one git repo per run and bank (`policies/{run_id}/{bank_id}/`), pushed to a private GitHub repo. Policies must use numbered controls (for example, `AI-GOV-014: All customer-facing models must ...`) so controls can be counted and tracked.

---

## 9. Quantifiable outputs

### 9.1 How the numbers are produced

Four mechanisms, in order of trustworthiness:

1. **Structured by construction.** Votes, positions, proposals, and use-case status changes come from tool calls with JSON schemas. Counting them is exact. Wherever possible, capture a behavior as a structured tool call instead of trying to extract it from prose later.
2. **Computed from logs and artifacts.** Deterministic code over the database and git history: policy word count, control count, diffs, time between events, token and cost totals, repetition statistics.
3. **Reality engine state.** Revenue, incidents, findings, effort. These are exact within the simulation, but they measure the simulated world, not the real one. Every report must say that simulated outcomes depend on `engine_params.yaml`, and include a sensitivity analysis.
4. **LLM-coded text measures.** Stance scores, objection detection, suspicion detection, and framework references use a Haiku classifier with a written rubric (`analysis/rubrics/`). Validate each classifier by having a human hand-code a random sample (at least 200 items per measure) and report agreement (Cohen's kappa). Do not publish a coded measure with poor agreement.

### 9.2 Metric catalog

Computed monthly per bank per run. Definitions in `analysis/metrics.yaml`.

**Decisions and portfolio**

| Metric | Definition | Source |
|---|---|---|
| `proposals_submitted` | New use-case proposals this month | Structured |
| `approval_rate` | Approved / decided | Structured |
| `time_to_decision_days` | Median sim days from proposal to decision | Structured |
| `time_to_production_months` | Median months from approval to live | Engine |
| `use_cases_live` | Count live, by risk tier | Structured + engine |
| `high_risk_share` | Share of live use cases in the high tier (credit decisions, customer-facing generation) | Structured |
| `unanimity_rate` | Votes with no dissent / total votes | Structured |
| `dissent_by_seat` | Share of votes against the majority, per seat | Structured |
| `reversal_count` | Prior approvals later paused or retired by the committee | Structured |

**Policy**

| Metric | Definition | Source |
|---|---|---|
| `policy_word_count` | Words in current policy | Computed |
| `control_count` | Numbered controls | Computed |
| `controls_added` / `controls_removed` | Per month, from git diff | Computed |
| `readability_grade` | Flesch-Kincaid grade level | Computed |
| `framework_mentions` | References to SR 11-7, NIST AI RMF, ISO/IEC 42001, EU AI Act, etc., and month of first mention | Keyword + LLM-coded |
| `policy_similarity_cross_bank` | Cosine similarity of the two banks' policies (embedding or TF-IDF) at the same sim month | Computed |

**Simulated outcomes**

| Metric | Definition | Source |
|---|---|---|
| `ai_revenue_monthly` | Incremental revenue attributed to live use cases | Engine |
| `ai_spend_cumulative` | Total AI spend | Engine |
| `roi_cumulative` | (Cumulative AI revenue minus spend) / spend | Engine |
| `effort_overrun_pct` | Actual vs estimated person-weeks | Engine |
| `incidents` | Count by severity | Engine |
| `findings` | Count by severity; month of first MRA | Regulator |
| `enforcement_flag` | 1 if under enforcement action | Regulator |
| `complaint_rate` | Customer complaints per 10k customers | Engine |
| `shadow_ai_rate` | Share of staff using unapproved tools | Engine |

**Agent behavior**

| Metric | Definition | Source |
|---|---|---|
| `speaking_share` | Share of debate tokens per seat | Computed |
| `stance_score` | Mean coded stance (1 to 5) per seat per month | Structured positions + LLM-coded |
| `stance_drift` | Stance score minus seat baseline | Computed |
| `influence` | How often a member's private position matches the final outcome, controlling for majority | Structured |
| `position_shift_rate` | Private position differs from final vote | Structured |
| `type_token_ratio` | Unique words / total words on fixed-size samples (Andon's vocabulary diversity measure) | Computed |
| `ngram_repeat_rate` | Share of 5-grams seen in the previous 3 months | Computed |
| `catchphrase_alerts` | Phrases of 3+ words appearing in over 30% of one agent's messages | Computed |
| `objection_count` | Ethical objections or refusals | LLM-coded |
| `suspicion_rate` | Messages questioning whether the situation is real | LLM-coded |
| `false_outcome_claims` | Agent claims about results that contradict engine reports (numbers extracted by Haiku, matched in code) | Hybrid |

**Operations**

| Metric | Definition |
|---|---|
| `cost_usd` | Per call, meeting, bank, month |
| `tokens` | Input, cached, output |
| `wall_clock_per_sim_month` | Real minutes per simulated month |

### 9.3 Analysis plan

- Unit of analysis: bank-month within a run. Replicates are the independent units for condition comparisons.
- Report means with 95% bootstrap confidence intervals across replicates.
- Mixed-effects models for repeated measures (condition as fixed effect, replicate as random effect).
- Time-to-event (first MRA, first high-severity incident) with Kaplan-Meier curves by condition.
- Sensitivity analysis: re-run short forks with `engine_params.yaml` values scaled by 0.5x and 2x, and report which findings hold.
- Exports: nightly CSV and Parquet to `exports/`, plus Jupyter notebooks in `analysis/notebooks/` that reproduce every chart from exports alone.

---

## 10. User interface

A read-mostly researcher dashboard with a small control panel. Agents can never reach it.

### 10.1 Stack

- Next.js (App Router) with TypeScript, Tailwind, and a chart library (Recharts or similar).
- Reads from Postgres through a read-only database role. Control actions go through an authenticated API route that writes to a `commands` table the worker polls.
- Auth: single researcher account (Supabase Auth or Vercel password protection).

### 10.2 Pages

| Page | Contents |
|---|---|
| **Overview** | Both banks side by side: sim month, run status, spend this real month vs cap, headline metric cards (live use cases, AI revenue, incidents, findings, policy controls), alerts |
| **Meetings** | Pick bank and month. Agenda, full transcript, private positions (revealed after vote), vote table, minutes. Filter by seat |
| **Policy** | Current policy with control IDs. Month-to-month diff viewer. Charts: word count and control count over time, both banks overlaid |
| **Use cases** | Board view by status (proposed, approved, building, live, paused, retired, rejected). Each card links to proposal, votes, engine estimates, and outcomes |
| **Outcomes** | Time series: revenue, spend, ROI, incidents by severity, findings, complaints, shadow AI. Event markers on the timeline |
| **People** | One panel per seat: persona, stance over time vs baseline, speaking share, vote history, repetition stats, objections, turnover history |
| **Reality engine inspector** | Pick a decision: classifier output, five estimator ranges, priors, blended distributions, actual draws with seeds, resulting state changes |
| **Health** | Repetition alerts, catchphrase alerts, suspicion rate, false outcome claims, failed calls, retries |
| **Compare** | Choose metrics; view by condition with replicate confidence bands; Kaplan-Meier plots; export buttons |
| **Log explorer** | Search and filter every LLM call and event; view raw request and response JSON |
| **Control** | Start, pause, resume, stop run. Advance one month manually. Inject an event (from template). Fork from checkpoint. Set spend caps. View and log interventions. Every control action requires a typed reason, which is written to `interventions` |

### 10.3 UI requirements

- Works on desktop first; readable on a laptop screen.
- Light and dark mode.
- Every chart has a "download data" action (CSV).
- Transcripts render the sim date, never the real date.
- Nothing on the dashboard is writable except through the Control page.

---

## 11. Deployment plan

### 11.1 Architecture

```
[Worker: Python container]  --writes-->  [Postgres (Supabase)]  <--reads--  [Dashboard (Vercel, Next.js)]
        |                                         ^
        |--calls--> Claude API (Messages + Batch) |
        |--pushes--> GitHub private repo (policies)
        |--uploads--> Object storage (checkpoints, exports)
        ^--polls-- commands table ----------------'
```

The simulation worker is long-running and waits on Batch API results, so it should not run on serverless functions, which have execution time limits. It runs as an always-on container on a small host (Railway, Fly.io, Render, or a small VPS). Check current pricing when choosing; a small instance is enough because the heavy work happens at the API.

### 11.2 Phases

**Phase 0: Local.** Everything runs on the researcher's machine with Docker Compose: worker, local Postgres (or SQLite), dashboard on `localhost`. Goal: one bank completes three simulated months end to end.

**Phase 1: Hosted pilot.**
- Postgres on Supabase (the researcher already has a Supabase connector). Enable row-level security; the dashboard uses a read-only role.
- Worker container on the chosen host, with secrets in the host's secret store: `ANTHROPIC_API_KEY`, `DATABASE_URL` (write role), `GITHUB_TOKEN` (scoped to the policies repo), storage credentials.
- Dashboard on Vercel (the researcher already has a Vercel connector), with `DATABASE_URL_READONLY` and auth enabled.
- Checkpoints and exports in Supabase Storage.
- Goal: two banks, one replicate each, three simulated months, with measured cost per simulated month.

**Phase 2: Full run.**
- Set replicate count from pilot costs (see section 12).
- Freeze `prereg/hypotheses.md`, `engine_params.yaml`, prompts, and model versions. Tag the git commit.
- Run open-ended; review weekly.

### 11.3 Operations

- **Kill switch:** a `STOP` command or env flag halts the worker after the current call, writes a checkpoint, and exits cleanly.
- **Alerts** (email or Slack webhook): spend at 50%, 80%, 100% of monthly cap; worker crash; catchphrase alert; suspicion rate above threshold; three consecutive failed API calls.
- **Backups:** nightly database dump to object storage.
- **Retries:** exponential backoff on API errors; a failed call is logged and retried, never silently skipped.
- **Reproducibility:** seeded RNG for all engine draws and event schedules. LLM outputs are not fully deterministic even with fixed settings, so full request and response logging is the reproducibility record. Record every sampling parameter sent.

---

## 12. Budget and model routing

Monthly API budget: under $200.

Prices at time of writing (verify at https://platform.claude.com/docs/en/about-claude/pricing before running), per million input/output tokens: Haiku 4.5 $1/$5, Sonnet 5 $2/$10, Opus 5 $5/$25. Cache reads cost 10% of the input rate. The Batch API halves prices and stacks with caching.

| Job | Model | Mode |
|---|---|---|
| Committee turns, chair, minutes, policy drafting | `claude-sonnet-5` | Standard, prompt caching on fixed blocks |
| Reality engine estimators, regulator exams | `claude-sonnet-5` | Batch API |
| Classification, memory compression, event wording, coding measures, suspicion scan | `claude-haiku-4-5-20251001` | Batch where possible |
| Opus 5 | Not used in the loop | Optional for offline analysis |

**Rough estimate, to be replaced by pilot measurements:** $2 to $4 per bank per simulated month. Four banks (2 conditions × 2 replicates) would cost about $8 to $16 per simulated month.

**Cost controls (all configurable in `config/budget.yaml`):**
- `max_tokens` per call type
- Max debate rounds and speakers per meeting
- Spend cap per simulated month per bank; the worker skips optional steps (staff voices, extra news) when a bank exceeds it
- Hard monthly cap; worker pauses at 100% and alerts
- Cost is computed from API usage fields and written to `llm_calls` on every call

### 12.1 SDK choice

Use the Anthropic Python SDK (Messages API and Batch API) directly for the simulation loop. The orchestrator controls every call, which gives exact logging and turn order. Claude Code is the tool used to build the system, and its usage is billed separately from the simulation's API usage.

---

## 13. Repo layout

```
governance-sim/
  CLAUDE.md                  # build instructions for Claude Code (see section 15)
  SPEC.md                    # this file
  docker-compose.yml
  worker/
    sim/
      orchestrator.py        # monthly cycle
      meeting.py
      agents/                # committee, board, regulator, events, estimators
      engine/                # classify, estimate, blend, sample, advance, report
      memory.py
      tools.py               # agent tool definitions and handlers
      llm.py                 # API wrapper: caching, batch, logging, cost
      realism.py             # universe, calendar, leak checks
      metrics/               # one module per metric group
      checkpoint.py
      commands.py            # polls commands table
    tests/
  dashboard/                 # Next.js app
  config/
    risk_appetite/
    personas/
    universe/
    regulator/rulebook.md
    engine_params.yaml
    events.yaml
    turnover.yaml
    budget.yaml
    models.yaml              # pinned model IDs
  db/migrations/
  analysis/
    metrics.yaml
    rubrics/
    notebooks/
    validation/              # human-coded samples and agreement results
  prereg/
    hypotheses.md
  exports/
```

---

## 14. Build milestones and acceptance criteria

| # | Milestone | Done when |
|---|---|---|
| M1 | Data layer and LLM wrapper | Every call logs tokens, cost, request, response; caching and batch both work; unit tests pass |
| M2 | Universe and personas | Both banks' persona files, universe files, and risk appetite statements exist; leak check finds no simulation language in any agent-facing text |
| M3 | One meeting | One bank holds one meeting with positions, debate, secret votes, minutes, and a policy commit |
| M4 | Reality engine | An approved use case produces estimates, blended distributions, seeded draws, state updates, and a report; same seed gives same draws |
| M5 | Full monthly loop | One bank runs 3 simulated months unattended; memory stays under limits |
| M6 | Regulator, events, board, turnover | An exam fires on schedule and on trigger; a replacement member joins with a handover memo |
| M7 | Metrics | All section 9.2 metrics compute for a 3-month run and export to CSV and Parquet |
| M8 | Dashboard | All section 10.2 pages render real data; Control page actions write interventions |
| M9 | Checkpoints and forks | A run forks from month 3 with an injected event; both branches continue independently |
| M10 | Hosted pilot | Phase 1 deployment complete; two banks, 3 months; cost per simulated month recorded |
| M11 | Classifier validation | Human-coded samples collected; kappa reported for each LLM-coded measure |
| M12 | Full run launch | Prereg frozen and tagged; replicates started |

---

## 15. Notes for CLAUDE.md

- Build milestones in order; do not start a milestone until the previous one's acceptance criteria pass.
- Never put simulation language in agent-facing text. Run the leak check in CI.
- Every random draw goes through the seeded RNG in `engine/`. No bare `random` calls.
- Every LLM call goes through `llm.py`. No direct SDK calls elsewhere.
- Numbers in `engine_params.yaml` are placeholders until a source is cited next to them.
- Prefer structured tool calls over parsing prose.

---

## 16. Open items to resolve before the full run

- Confirm placeholder bank, vendor, and person names do not match real entities.
- Verify current status of every regulation in the regulator rulebook.
- Calibrate `engine_params.yaml` from real data and cite sources.
- Confirm API prices and model IDs on the official pricing and models pages.
- Decide whether to add the moderate condition after the pilot.
- Decide the replicate count from pilot cost data.
- Decide whether the researcher may inject events during the full run, and if so, pre-register the rules for doing it.
