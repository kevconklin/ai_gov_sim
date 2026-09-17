# Governance Sim

Simulation of AI governance committees at two fictional banks. `SPEC.md` is the source of truth; read the relevant section before changing anything.

## Rules (SPEC section 15)

- Build milestones (SPEC section 14) in order. Do not start a milestone until the previous one's acceptance criteria pass.
- Never put simulation language in agent-facing text. `python -m sim leak-check` runs in CI; agent-facing text lives in `config/personas`, `config/risk_appetite`, `config/universe`, and `worker/sim/prompts/{committee,world}`.
- Every random draw goes through `worker/sim/engine/rng.py` (seeded, stateless, logged to `engine_draws`). No bare `random` calls.
- Every LLM call goes through `worker/sim/llm.py`. No direct SDK calls elsewhere.
- Numbers in `config/engine_params.yaml` are placeholders until a source is cited next to them.
- Prefer structured tool calls over parsing prose.
- Real timestamps (`utc_now_iso`) are for logs only. Agents see dates from `worker/sim/calendar.py`.
- Changing `config/`, prompts, or model versions during a run must be logged in `interventions`.
- Run-scoped ids start with `<run_id>/` so checkpoints and forks can remap them. Keep it that way for new tables, and add new run-scoped tables to `RUN_TABLES` in `worker/sim/checkpoint.py`.
- The schema must run on both SQLite and Postgres (`tests/test_postgres.py` uses embedded Postgres).

## Layout (worker/sim)

- `orchestrator.py` monthly cycle with rollback; `meeting.py`, `decisions.py`, `packet.py`, `tools.py`, `agents/` (tool loop, memory, structured output)
- `engine/` state, pipeline (classify, estimate via batch, blend, sample), advance, report, resolve
- `events.py`, `regulator.py`, `board.py` world agents; `coding.py` LLM-coded measures; `metrics/` SPEC 9.2
- `checkpoint.py` checkpoints, rollback, forks; `commands.py` control commands and kill switch; `budget.py`, `alerts.py`
- `demo_llm.py` scripted client for tests and free demo runs; `cli.py` entry point

## Commands

```bash
cd worker
python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'
.venv/bin/pytest -q -p no:cacheprovider          # unit, e2e (scripted client), Postgres; coverage gate 80%
.venv/bin/python -m sim leak-check
.venv/bin/python -m sim create --name demo --seed 1 && .venv/bin/python -m sim advance --experiment <id> --months 3 --demo
.venv/bin/python scripts/smoke_llm.py            # live cache + batch check, needs ANTHROPIC_API_KEY
cd ../dashboard && npm test && npm run build     # dashboard
```

## Status

- M1-M9 built and tested with the scripted client; M1 live smoke check not yet run against the real API.
- M10 deploy files written (`deploy/README.md`), not deployed. M11 tooling written, needs human coders and real runs. M12 needs frozen prereg and funded runs.
