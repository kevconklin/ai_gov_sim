# Governance Sim

Simulation of AI governance committees at two fictional US regional banks that differ only in board risk appetite.
`SPEC.md` is the design; `CLAUDE.md` has the rules for working in this repo.

| Path | What |
|---|---|
| `worker/` | Python simulation worker: monthly cycle, committee, reality engine, regulator, board, events, metrics, CLI |
| `dashboard/` | Next.js researcher dashboard (read-only pages plus Control) |
| `config/` | Banks, personas, universe, rulebook, engine parameters (placeholders), events, turnover, budget, pinned models |
| `db/` | Schema migrations (SQLite and Postgres) and hosted roles |
| `analysis/` | Metric definitions, coding rubrics, validation tools, notebooks |
| `prereg/` | Hypotheses (draft, not frozen) |
| `deploy/` | Deployment runbook |

Quick start (free, scripted client, no API key):
```bash
cd worker && python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'
.venv/bin/python -m sim create --name demo --seed 2027
.venv/bin/python -m sim advance --experiment <experiment_id printed above, from the run ids> --months 3 --demo
.venv/bin/python -m sim status
```
Demo runs exercise the pipeline; they are not research data.
