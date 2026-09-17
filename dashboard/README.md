# Governance Sim researcher dashboard

Next.js (App Router) + TypeScript + Tailwind + Recharts. Implements SPEC sections 10 and 11 against the schema in `../db/migrations/0001_init.sql`.

## Commands

```bash
npm install
npm run seed:dev      # creates .dev/sim.sqlite from ../db/migrations/0001_init.sql plus DEV FIXTURE data
npm run dev           # http://localhost:3100
npm run build && npm start   # production server on port 3100
npm test              # vitest unit tests
npm run typecheck
```

The seed is invented sample data (experiment `devfx-exp-001`, both banks, one replicate, sim months 2027-01..03). It is not simulation output.

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Read connection for every page. SQLite file path, `file:./.dev/sim.sqlite`, or `postgres://` / `postgresql://`. Use a read-only role in production. SQLite is opened read-only. |
| `DATABASE_URL_CONTROL` | production | Connection used only by the Control page / `POST /api/control`. It only INSERTs into `commands` (status `pending`) and `interventions` (source `dashboard`); grant that role only those privileges. Falls back to `DATABASE_URL`. |
| `DASHBOARD_PASSWORD` | production | Single researcher password (compared in constant time). |
| `DASHBOARD_SESSION_SECRET` | production | HMAC-SHA256 key for session cookies, at least 32 characters (`openssl rand -base64 48`). |

In production (`NODE_ENV=production`) the app fails closed: if either auth variable is missing, every page returns 503 and sign-in is disabled. In development only, missing values fall back to password `dev-password` and a fixed dev secret.

Example local run against the seed:

```bash
DATABASE_URL=file:./.dev/sim.sqlite DASHBOARD_PASSWORD=choose-one \
DASHBOARD_SESSION_SECRET=$(openssl rand -base64 48) npm start
```

## Auth

- `proxy.ts` (Next 16's renamed middleware) verifies the `gsim_session` cookie with Web Crypto on every route except `/login*` and static assets. Pages redirect to `/login`; `/api/*` returns 401.
- `POST /login/session` (form fields `password`, `next`) sets an httpOnly, SameSite=Lax cookie `<expiresMs>.<nonce>.<hmac>` valid for 12 hours. `POST /logout` clears it.
- Write paths re-check the session and reject cross-origin `Origin` headers.

## Control API

The Control page uses server actions. The same logic is exposed as JSON:

```bash
curl -b cookies.txt -X POST http://localhost:3100/api/control \
  -H 'content-type: application/json' \
  -d '{"type":"command","kind":"advance","run_id":"devfx-r1-calder_ridge","reason":"Advance one month for review","payload":{"months":1}}'
```

Kinds and payloads (validated with zod, `lib/control/schema.ts`): `start|pause|resume|stop {}`, `advance {months: 1-12}`, `inject_event {event_type, severity: low|medium|high, notes}`, `fork {from_month: "YYYY-MM", inject_event?}`, `set_spend_cap {usd_per_sim_month > 0}`. Every action needs a `reason` of at least 10 characters. `{"type":"intervention","run_id":null,"kind":"note","reason":"..."}` logs an intervention without a command.

## Layout

- `lib/db/` adapter: `?` placeholders translated to `$n` for pg; JSON columns are TEXT parsed in TS; values normalized in `values.ts`.
- `lib/queries/` one module per page; `lib/compare.ts`, `lib/stats/` (Kaplan-Meier, bootstrap), `lib/csv.ts`.
- `app/(dash)/` pages: Overview, Meetings, Policy, Use cases, Outcomes, People, Reality engine, Health, Compare, Log explorer, Control.
- Every chart sits in `ChartPanel`, which has a client-side "Download CSV" button.
- Sim-facing pages show sim dates only; real timestamps appear on Log explorer, Control and Health.

## Conventions and assumptions

- Page selection: `?exp=<experiment_id>&rep=<replicate>` picks the base (non-fork) runs for both banks; `bank=` picks one bank where a page shows one.
- Compare groups base runs of the experiment by `runs.condition`. Bands are min-max or a seeded 95% percentile bootstrap of replicate values.
- Kaplan-Meier: time is months since `runs.start_month` (start month = 1), censored at `current_month`. "First MRA" = first finding with severity `mra`, `mria` or `enforcement_referral`. "High-severity incident" = event with severity `high` and type in `incident, data_leak, model_error, complaint_wave, shadow_ai_discovery` (the schema has no incident flag).
