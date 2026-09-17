# Local pilot findings (experiment `pilot-932476`, first real-API run)

Two banks, one replicate, seed 2027, sim months from 2027-01. Run on a laptop against the real API.
Everything here was found by running for real; the scripted client used in tests could not have caught most of it.

## Defects found and fixed

| # | Defect | Effect on data | Fix |
|---|---|---|---|
| 1 | The Messages API no longer accepts `temperature` or `top_p` | No calls possible at all | Removed from `LLMRequest` (commit `155cc7a`) |
| 2 | Forked policy repos had no git identity | Fork's first policy commit failed (found by CI) | Clone copies the parent's identity (`155cc7a`) |
| 3 | Reading tools crowded out recording | Missing ballots and positions: Calder Ridge 2027-02 PE-006 (6 of 8) and SC-001 (5 of 8) | Required phases force their recording tool after a few reading steps (`52bc2e8`) |
| 4 | Adaptive thinking counts against `max_tokens` | **Three bank-months with no decisions at all** (Tollgate 2027-02, both banks 2027-03): proposal tool calls truncated to empty input | Token budgets sized for thinking; truncated replies retried in-turn (`0fbfbd9`) |
| 5 | Prose-only phases could end with no text | One member's private notes missing (Tollgate 2027-02) | Memory and handover turns are sent with no tools (`838a0b9`) |
| 6 | Catchphrase detector far too sensitive early | 97 spurious alerts in month 2 | Needs 3+ occurrences, 8+ messages, 2+ content words (`838a0b9`) |
| 7 | Suspicion keyword matched ordinary speech | 4 false "questions whether this is real" flags on "staged budget release" | Pattern narrowed; rate recomputed to 0 (`e43a345`) |
| 8 | No lock between worker processes | A stale worker raced a new one and died on a foreign key error | Per-run file lock (`254aabd`) |
| 9 | Classifier could return `delivery: "undecided"` | Engine crashed (`KeyError`), rolling back a paid month | Classifier output normalized (`333163f`) |
| 10 | Hard kill left a month half-written | Manual repair needed once | Month-start snapshot on disk; next run restores and retries (`e43a345`) |

## Deviation from SPEC

- **SPEC 5 caps debate turns at 400 output tokens.** This model thinks adaptively and thinking tokens count against
  `max_tokens`, so 400 truncates tool calls and often the remark itself. Debate turns now allow 1,800 tokens, of which
  roughly 1,000-1,400 is thinking. Visible remarks stay near the 250-word instruction. `config/budget.yaml` documents
  each limit. If thinking needs to be cheaper, `LLMRequest.effort` sets `output_config.effort`; effort `low` produced
  no thinking in testing.

## Data caveats for this pilot

- Calder Ridge 2027-02: incomplete ballots on PE-006 and SC-001 (defect 3). Logged as an `incomplete_ballots`
  intervention. Exclude that meeting from vote-based metrics.
- Tollgate 2027-02, both banks 2027-03: no decisions, because proposals were truncated (defect 4). These months are
  not usable for decision or policy metrics.
- Months 2027-01 to 2027-03 were computed with the old catchphrase thresholds; recompute before using
  `catchphrase_alerts`.
- Two `recovered_interrupted_month` interventions come from the low-memory kill, not from model behaviour.

## Observations worth carrying into the full run

- **Unanimity early, disagreement later.** Everything in January was 8-0 at both banks. By April, Calder Ridge
  rejected PE-010 8-0 against, split 3-5 on PE-008, and carried four items 7-1. Watch `unanimity_rate` over a longer
  run before concluding anything about consensus drift (H4).
- **Policy grows faster at the conservative bank** (42 controls and 1,682 words by April, against 28 and 1,108),
  which is the direction H3 predicts for the early months.
- **Members invent facts they were not given.** The CIO cited "214 technology staff" when the hidden state says 331.
  That is what `false_outcome_claims` is for; the committee is given no staffing figures.
- **Speech habits are already visible**: the chair opens every meeting with "good morning everyone let's get started",
  and members sign their remarks with their own names even though the transcript labels each speaker.
- **Cost rises with the agenda.** About $2.40 per bank-month in January against roughly $5 in April, when 13 items
  were decided. Budget from the later figure, not the first month.
