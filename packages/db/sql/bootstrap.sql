-- Everything the schema depends on but cannot declare.
--
-- Applied by the migrator BEFORE drizzle's migrations, because migration 0000
-- indexes with `gin_trgm_ops` and mixes `tenant_id` into a GIN index — both of
-- which need an extension — and `rls.sql` calls the two helper functions below.
--
-- This used to live only in `db:reset`, which meant the one environment that
-- had never run reset (a fresh managed Postgres on first deploy) was the one
-- environment where migrations could not run at all.
--
-- Idempotent, and re-applied on every migration run.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "unaccent";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

/**
 * The tenant the current transaction is acting as.
 *
 * `SET LOCAL app.current_tenant_id` is what TenantDatabase.run() sets, and
 * every RLS policy compares against this. STABLE and PARALLEL SAFE so the
 * planner can hoist it out of a scan rather than calling it per row.
 *
 * The `true` argument to current_setting is load-bearing: without it, an
 * unset variable raises instead of returning NULL, and a query outside a
 * tenant context would error rather than returning zero rows.
 */
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE AS $fn$
    SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid;
$fn$;

/** Platform operators: tenant provisioning and cross-tenant reporting only. */
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean LANGUAGE sql STABLE PARALLEL SAFE AS $fn$
    SELECT COALESCE(current_setting('app.is_platform_admin', true), 'off') = 'on';
$fn$;

-- Guarded: a deployment that runs everything as one role has no `devsfleet_app`,
-- and an unconditional GRANT would abort the migration on a missing role.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'devsfleet_app') THEN
    GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO devsfleet_app;
    GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO devsfleet_app;
    GRANT USAGE ON SCHEMA public TO devsfleet_app;
  END IF;
END $$;
