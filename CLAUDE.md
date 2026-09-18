# AI Governance Reviews

The main feature is the human-triggered review: a person submits AI matters, convenes a committee of targeted AI advisers on an agenda they set, reads its recommendation and dissent, and decides. Everything else supports that.

Two packages under `worker/`:

- `govern/` is the product. It must never import `sim` (`tests/test_architecture.py` enforces it).
- `sim/` is the simulation of committees at two fictional banks, now a client of `govern/`. It is the test bench a committee configuration is tried on, and the research instrument `SPEC.md` describes. `SPEC.md` remains the source of truth for the simulation; read the relevant section before changing it.

## Rules (SPEC section 15)

- Build milestones (SPEC section 14) in order. Do not start a milestone until the previous one's acceptance criteria pass.
- Never put simulation language in the simulation's agent-facing text. `python -m sim leak-check` runs in CI; that text lives in `config/personas`, `config/risk_appetite`, `config/universe`, `worker/govern/prompts/committee`, and `worker/sim/prompts/world`.
- The opposite rule holds for a workspace: its members must be told they are AI advisers, that output is advisory, and that a person decides. That brief is `worker/govern/prompts/review/fixed.md`; `python -m sim disclosure-check` runs in CI. Never route a disclosed workspace through the simulation's brief or the reverse.
- Nothing a review recommends may apply without an attestation. `govern.review.Review` never calls `apply_decisions`; only `govern.attestation.apply_attested` does, and only the simulation's `Meeting` applies without a person.
- Priority is computed (`govern/agenda.py`), never asked of a model, and never shown to members.
- Changing a member's brief (`govern.committee.set_brief`) is a prompt change and is logged in `interventions`.
- Every random draw goes through `worker/sim/engine/rng.py` (seeded, stateless, logged to `engine_draws`). No bare `random` calls.
- Every LLM call goes through `worker/govern/llm.py`. No direct SDK calls elsewhere.
- Numbers in `config/engine_params.yaml` are placeholders until a source is cited next to them.
- Prefer structured tool calls over parsing prose.
- Real timestamps (`utc_now_iso`) are for logs only. In the simulation, agents see dates from `worker/govern/calendar.py`; a workspace is reviewed on the real date.
- Changing `config/`, prompts, or model versions during a run must be logged in `interventions`.
- Run-scoped ids start with `<run_id>/` so checkpoints and forks can remap them. Keep it that way for new tables, and add new run-scoped tables to `RUN_TABLES` in `worker/sim/checkpoint.py`.
- The schema must run on both SQLite and Postgres (`tests/test_postgres.py` uses embedded Postgres).

## Layout (worker/govern) - the product

- `review.py` a review: sealed positions and perspectives, debate, secret ballot, synthesis; applies nothing. `service.py` convenes one (lock, panel, date)
- `intake.py` how a matter arrives; `agenda.py` ranked candidates and deferrals; `panels.py` which seats a matter needs
- `attestation.py` the person on record, dissent responses, `apply_attested`; `advisory.py` perspectives and computed synthesis
- `workspace.py` an organisation's committee with no simulation behind it; `committee.py` seats and briefs as data; `context.py` `ReviewContext` and `OrgProfile`
- `disclosure.py`, `prompts/` (registry: roots and per-directory checks), `llm.py`, `db.py`, `locks.py`, `agents/`, `tools.py`, `packet.py`, `decisions.py`, `policy.py`

## Layout (worker/sim) - the simulation

- `orchestrator.py` monthly cycle with rollback; `meeting.py` (`Meeting(Review)`: circulate, standing items, derived agenda, auto-apply); `context.py` (`RunContext(ReviewContext)`: builds the `OrgProfile` from the fictional bank)
- `engine/` state, pipeline (classify, estimate via batch, blend, sample), advance, report, resolve
- `events.py`, `regulator.py`, `board.py` world agents; `coding.py` LLM-coded measures; `metrics/` SPEC 9.2
- `checkpoint.py` checkpoints, rollback, forks; `commands.py` control commands and kill switch (`budget.py` and `alerts.py` live in `govern/`)
- `demo_llm.py` scripted client for tests and free demo runs; `cli.py` entry point

## Commands

```bash
cd worker
python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'
.venv/bin/pytest -q -p no:cacheprovider          # unit, e2e (scripted client), Postgres; coverage gate 80%
.venv/bin/python -m sim leak-check && .venv/bin/python -m sim disclosure-check
.venv/bin/python -m sim create --name demo --seed 1 && .venv/bin/python -m sim advance --experiment <id> --months 3 --demo
.venv/bin/python -m sim workspace --name "Org" --risk-appetite "The board's direction on AI..."      # a real organisation
.venv/bin/python -m sim submit --run <ws> --kind vendor --title "..." --description "..." --by you@org
.venv/bin/python -m sim convene --run <ws> --top 3 --demo && .venv/bin/python -m sim attest --run <ws> --show <meeting_id>
.venv/bin/python -m sim serve --demo --once      # drain commands queued by the dashboard
.venv/bin/python scripts/smoke_llm.py            # live cache + batch check, needs ANTHROPIC_API_KEY
cd ../dashboard && npm test && npm run build     # dashboard
```

## Status

- M1-M9 built and tested with the scripted client; M1 live smoke check not yet run against the real API.
- M10 deploy files written (`deploy/README.md`), not deployed. M11 tooling written, needs human coders and real runs. M12 needs frozen prereg and funded runs.
- Review core (`govern/`), workspaces, intake, panels, attestation, dashboard `/reviews`: built and exercised end to end on the scripted client only. Real accounts are not built: attestations bind to a signed session on one shared credential.
