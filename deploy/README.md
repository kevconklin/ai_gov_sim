# Deployment (SPEC 11)

Nothing here has been deployed. Every step below creates or changes external resources, and some cost money.

## Phase 0: local
Without Docker (what was tested):
```bash
cd worker && python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'
.venv/bin/python -m sim create --name pilot --seed 2027
.venv/bin/python -m sim advance --experiment <experiment_id> --months 3 --demo   # free, scripted
cd ../dashboard && npm ci && npm run build
DATABASE_URL=../data/sim.sqlite DASHBOARD_PASSWORD=... DASHBOARD_SESSION_SECRET=$(openssl rand -base64 48) npm start
```
With Docker Compose (written but not run here, since Docker was not running): see the header of `docker-compose.yml`.

## Kubernetes

See [k8s/README.md](k8s/README.md). The manifests in `k8s/` cover the namespace, the migration
Job, the worker, the dashboard, and network policy.

## Phase 1: hosted pilot
1. **Supabase Postgres**: create a project. Run `db/migrations/0001_init.sql` (or let the worker migrate on start with the
   owner connection once), then `db/postgres/roles.sql` with real passwords. Create a private Storage bucket
   `sim-artifacts` for checkpoints and exports.
2. **Worker container** on Railway, Fly.io, Render, or a small VPS, built from `worker/Dockerfile` with the repo root as
   context. Secrets:
   - `ANTHROPIC_API_KEY`
   - `DATABASE_URL`: the `sim_worker` role
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`: checkpoint uploads
   - `ALERT_WEBHOOK_URL`: Slack-compatible incoming webhook (optional)
   - `GITHUB_TOKEN`: only if you add pushing of policy repos (not implemented; policy repos live in `SIM_DATA_DIR/policies`
     and every version is also stored in `policy_versions.policy_text`)
   Mount a persistent volume at `/data`.
3. **Dashboard on Vercel**: root directory `dashboard/`. Env: `DATABASE_URL` (dashboard_readonly role),
   `DATABASE_URL_CONTROL` (dashboard_control role), `DASHBOARD_PASSWORD`, `DASHBOARD_SESSION_SECRET`.
   Use the Supabase connection pooler URL for serverless.
4. **Pilot**: `python -m sim create --name pilot --seed <seed>` (one replicate, both banks), start both runs from the
   Control page, run 3 simulated months, read cost per sim month from Overview or `metrics.cost_usd`.

## Before any paid run
- Run `worker/scripts/smoke_llm.py` to confirm caching and batches on the real API.
- Verify prices and model ids in `config/models.yaml` against the official pricing and models pages.

## Operations
- One worker per run: on Postgres, `advance` takes a session advisory lease, so two workers on any host cannot
  advance the same run (overlapping workers corrupt a month). The lease is released when the connection drops.
  On SQLite it falls back to a file lock in `SIM_DATA_DIR/locks`, which only covers one host.
- Kill switch: `SIM_STOP=1`, a `STOP` file in `SIM_DATA_DIR`, or a stop command. The worker makes no further API calls,
  rolls back the in-progress month, checkpoints the last completed month, and exits. Note that a pending stop command
  halts the whole worker, not just one run.
- Hard monthly cap (`config/budget.yaml`): alerts at 50/80/100%; runs pause at 100%.
- Backups: schedule `pg_dump` nightly (Supabase includes daily backups on paid plans) plus `python -m sim export`.
