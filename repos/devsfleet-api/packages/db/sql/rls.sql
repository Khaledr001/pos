-- =============================================================================
-- ROW-LEVEL SECURITY
--
-- Re-run after every migration (scripts/migrate.ts does this automatically).
-- Idempotent: it drops and recreates each policy, so a new table picks up
-- isolation the moment it appears — nobody has to remember to add it.
--
-- The rule is deliberately mechanical: any table with a `tenant_id` column gets
-- a policy comparing that column to `current_tenant_id()`. That is why
-- `tenantScope` in src/schema/_shared.ts is spread rather than hand-written —
-- a table that spells the column differently silently opts out of isolation,
-- and nothing would fail loudly to tell you.
-- =============================================================================

DO $$
DECLARE
    tbl RECORD;
BEGIN
    FOR tbl IN
        SELECT c.relname AS table_name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND a.attname = 'tenant_id'
          AND a.attnum > 0
          AND NOT a.attisdropped
          AND c.relname <> 'drizzle_migrations'
        ORDER BY c.relname
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl.table_name);

        -- FORCE also applies the policy to the table owner. Without it the
        -- migrator role reads every tenant, which is fine for migrations but
        -- makes an accidental runtime connection as the owner invisible.
        -- Platform operations opt out explicitly via is_platform_admin().
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tbl.table_name);

        EXECUTE format(
            'DROP POLICY IF EXISTS tenant_isolation ON public.%I',
            tbl.table_name
        );

        -- USING filters what a query can SEE.
        -- WITH CHECK filters what it can WRITE — without it, a tenant could
        -- insert a row stamped with someone else's tenant_id.
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON public.%I
               FOR ALL
               TO devsfleet_app, devsfleet_migrator
               USING (tenant_id = public.current_tenant_id() OR public.is_platform_admin())
               WITH CHECK (tenant_id = public.current_tenant_id() OR public.is_platform_admin())',
            tbl.table_name
        );

        EXECUTE format(
            'GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO devsfleet_app',
            tbl.table_name
        );
    END LOOP;
END
$$;

-- -----------------------------------------------------------------------------
-- `tenants` has no tenant_id — it IS the tenant. Scope it on the primary key.
-- -----------------------------------------------------------------------------
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_self_isolation ON public.tenants;
CREATE POLICY tenant_self_isolation ON public.tenants
    FOR ALL
    TO devsfleet_app, devsfleet_migrator
    USING (id = public.current_tenant_id() OR public.is_platform_admin())
    WITH CHECK (id = public.current_tenant_id() OR public.is_platform_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenants TO devsfleet_app;

-- -----------------------------------------------------------------------------
-- Verification
--
-- Both queries must return zero rows. If either does not, a table is reachable
-- across tenants — treat that as a production incident, not a warning.
-- -----------------------------------------------------------------------------

-- 1. Tables with tenant_id but no RLS enabled:
--
--    SELECT c.relname
--    FROM pg_class c
--    JOIN pg_namespace n ON n.oid = c.relnamespace
--    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id'
--    WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
--
-- 2. Tables with RLS enabled but no policy attached:
--
--    SELECT c.relname
--    FROM pg_class c
--    JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
--      AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid);
