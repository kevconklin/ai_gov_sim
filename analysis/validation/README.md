# Classifier validation (SPEC 9.1, milestone M11)

For each LLM-coded measure (stance, objection, suspicion, frameworks, outcome_claims):

1. Draw a sample of at least 200 coded messages:
   `cd worker && python -m sim validation-sample --measure stance --n 200 --out ../analysis/validation/stance_sample.csv`
2. A human coder fills `human_code` using `analysis/rubrics/<measure>.md`, without looking at `model_code`
   (hide that column while coding). Use the rubric's exact output format, as JSON (e.g. `3`, `null`, `true`, `["sr_11_7"]`).
3. Compute agreement: `python -m sim kappa --measure stance --file ../analysis/validation/stance_sample.csv`
   (stance uses quadratic-weighted kappa; frameworks averages per-id kappa; outcome_claims reports agreement on
   whether any claim is present).
4. Record results in `results.md` with date, coder, rubric version, n, and kappa. Do not publish a measure with poor
   agreement (pre-register the threshold in `prereg/hypotheses.md`).

Samples must come from real runs; demo runs use a scripted client and are not valid for validation.
