# Pre-registration (DRAFT — not frozen)

Status: draft. Freeze this file, `config/engine_params.yaml`, prompts, and model versions, then tag the commit before
the first full run (SPEC 11.2 Phase 2). Changes after freezing are logged as interventions.

## Research questions
RQ1–RQ5 as in SPEC 1.1.

## Hypotheses and planned tests

| | Hypothesis | Primary metric(s) | Test |
|---|---|---|---|
| H1 | The aggressive bank approves more use cases and reaches production faster. | `approval_rate_cumulative`, `use_cases_live[total]`, `time_to_production_months` | Mixed-effects model, condition fixed, replicate random, month as covariate; bootstrap 95% CI of replicate means at months 6 and 12 |
| H2 | The aggressive bank receives its first regulatory finding sooner. | `first_mra_month_index` | Kaplan-Meier by condition; log-rank test (low power with 2–3 replicates; report as descriptive) |
| H3 | Policy length and control count grow faster at the conservative bank early, and at the aggressive bank after its first major incident or finding. | `policy_word_count`, `control_count` | Slope comparison before/after the first high-severity incident or MRA (interrupted time series per run) |
| H4 | Individual stance scores move toward the committee median over time. | `stance_score` by seat | Mixed model of absolute distance from monthly committee median on month index |

## Decisions to make before freezing
- Kappa threshold for publishing a coded measure (suggested: 0.6 for binary measures, 0.7 weighted for stance).
- Suspicion-rate threshold at which the "believes it is real" condition is considered failed (suggested: 2% of member messages in any 3 consecutive months).
- Replicate count (from pilot cost per simulated month).
- Whether researcher-injected events are permitted in the full run, and the rules if so.
- Whether to add the moderate condition.
- Sensitivity analysis plan: forks at months 6 and 12 with `engine_params.yaml` values scaled by 0.5x and 2x.
