-- =============================================================================
-- Runs once, on first `docker compose up`, against an empty data directory.
-- If you change this file you must `pnpm infra:nuke` to re-run it.
--
-- Two roles, and the split matters:
--   devsfleet_migrator  owns every object, BYPASSRLS. Migrations + seed only.
--   devsfleet_app       runtime role for apps/api. RLS is ENFORCED against it.
--
-- The app role must never own tables: in PostgreSQL a table owner is exempt
-- from its own RLS policies unless FORCE ROW LEVEL SECURITY is set, and
-- relying on that is one `ALTER TABLE` away from a silent cross-tenant leak.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";      -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";       -- fuzzy product search for the AI
CREATE EXTENSION IF NOT EXISTS "unaccent";      -- accent-insensitive search
CREATE EXTENSION IF NOT EXISTS "btree_gin";     -- composite GIN (tenant_id, tsvector)

-- -----------------------------------------------------------------------------
-- Application role
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'devsfleet_app') THEN
        CREATE ROLE devsfleet_app LOGIN PASSWORD 'app_dev_password' NOBYPASSRLS;
    END IF;
END
$$;

GRANT CONNECT ON DATABASE devsfleet TO devsfleet_app;
GRANT USAGE ON SCHEMA public TO devsfleet_app;

-- Applies to tables the migrator creates from here on.
ALTER DEFAULT PRIVILEGES FOR ROLE devsfleet_migrator IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO devsfleet_app;
ALTER DEFAULT PRIVILEGES FOR ROLE devsfleet_migrator IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO devsfleet_app;
ALTER DEFAULT PRIVILEGES FOR ROLE devsfleet_migrator IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO devsfleet_app;

-- -----------------------------------------------------------------------------
-- Tenant context helper.
--
-- apps/api opens a transaction per request and issues
--     SET LOCAL app.current_tenant_id = '<uuid>';
-- Every RLS policy compares tenant_id against this function.
--
-- `true` on current_setting() = return NULL instead of erroring when the GUC
-- was never set. A NULL tenant matches no row, so a request that forgets to
-- set context reads nothing rather than reading everything.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
    SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid;
$$;

GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO devsfleet_app;

-- Set by admin/support tooling to deliberately read across tenants.
-- Defaults to off; policies check it explicitly.
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
    SELECT COALESCE(current_setting('app.is_platform_admin', true), 'off') = 'on';
$$;

GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO devsfleet_app;
