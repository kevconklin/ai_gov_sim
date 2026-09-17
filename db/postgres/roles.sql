-- Hosted pilot roles (SPEC 10.1, 11.2). Run once as the database owner after migrations.
-- Replace the passwords, or create the roles in the Supabase dashboard and run only the GRANT/POLICY parts.

CREATE ROLE sim_worker LOGIN PASSWORD 'replace-me-worker';
CREATE ROLE dashboard_readonly LOGIN PASSWORD 'replace-me-readonly';
CREATE ROLE dashboard_control LOGIN PASSWORD 'replace-me-control';

GRANT USAGE ON SCHEMA public TO sim_worker, dashboard_readonly, dashboard_control;

-- Worker: full read/write on simulation tables.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sim_worker;

-- Dashboard pages: read everything, write nothing.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO dashboard_readonly;

-- Dashboard control actions: insert commands and interventions only.
GRANT SELECT ON runs, checkpoints, commands, interventions TO dashboard_control;
GRANT INSERT ON commands, interventions TO dashboard_control;

-- Row-level security: enabled on every table so the Supabase anon/authenticated API roles see nothing.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    EXECUTE format('CREATE POLICY worker_all ON public.%I TO sim_worker USING (true) WITH CHECK (true)', t.tablename);
    EXECUTE format('CREATE POLICY dashboard_read ON public.%I FOR SELECT TO dashboard_readonly USING (true)', t.tablename);
  END LOOP;
END $$;

CREATE POLICY control_read ON public.runs FOR SELECT TO dashboard_control USING (true);
CREATE POLICY control_read ON public.checkpoints FOR SELECT TO dashboard_control USING (true);
CREATE POLICY control_read ON public.commands FOR SELECT TO dashboard_control USING (true);
CREATE POLICY control_read ON public.interventions FOR SELECT TO dashboard_control USING (true);
CREATE POLICY control_insert ON public.commands FOR INSERT TO dashboard_control
  WITH CHECK (status = 'pending' AND length(reason) >= 10);
CREATE POLICY control_insert ON public.interventions FOR INSERT TO dashboard_control
  WITH CHECK (source = 'dashboard');
