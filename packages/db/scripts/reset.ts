/**
 * DESTRUCTIVE. Drops every table in `public` and re-runs migrations from zero.
 *
 * Development only. Refuses to run when NODE_ENV is production, and refuses
 * against a URL that is not localhost unless FORCE_RESET=1 is set — the check
 * exists because "reset the dev database" typed against the wrong .env is a
 * mistake that only happens once.
 *
 *   pnpm db:reset
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import postgres from "postgres";

config({ path: resolve(import.meta.dirname, "../../../.env") });

const url = process.env.DATABASE_URL_MIGRATOR;
if (!url) {
  console.error("DATABASE_URL_MIGRATOR is not set.");
  process.exit(1);
}

if (process.env.NODE_ENV === "production") {
  console.error("✗ refusing to reset a production database.");
  process.exit(1);
}

const isLocal = /@(localhost|127\.0\.0\.1|postgres)[:/]/.test(url);
if (!isLocal && process.env.FORCE_RESET !== "1") {
  console.error(`✗ ${url.replace(/:[^:@]+@/, ":***@")} is not local.`);
  console.error("  Set FORCE_RESET=1 if you are certain.");
  process.exit(1);
}

const client = postgres(url, { max: 1, onnotice: () => {} });

try {
  console.log("→ dropping schema public");
  // Recreating the schema also drops every policy, trigger and function that
  // lived in it. Extensions and roles survive: they are created by the Docker
  // init script, which only runs against an empty data directory.
  await client.unsafe(`
    DROP SCHEMA public CASCADE;
    CREATE SCHEMA public;
    GRANT USAGE ON SCHEMA public TO devsfleet_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO devsfleet_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO devsfleet_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT EXECUTE ON FUNCTIONS TO devsfleet_app;
  `);

  // The helper functions live in `public` and were dropped with the schema.
  await client.unsafe(`
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";
    CREATE EXTENSION IF NOT EXISTS "pg_trgm";
    CREATE EXTENSION IF NOT EXISTS "unaccent";
    CREATE EXTENSION IF NOT EXISTS "btree_gin";

    CREATE OR REPLACE FUNCTION public.current_tenant_id()
    RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE AS $fn$
        SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid;
    $fn$;

    CREATE OR REPLACE FUNCTION public.is_platform_admin()
    RETURNS boolean LANGUAGE sql STABLE PARALLEL SAFE AS $fn$
        SELECT COALESCE(current_setting('app.is_platform_admin', true), 'off') = 'on';
    $fn$;

    GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO devsfleet_app;
    GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO devsfleet_app;
  `);

  console.log("✓ schema reset. Run `pnpm db:migrate` then `pnpm db:seed`.");
} catch (error) {
  console.error("✗ reset failed:", error);
  process.exit(1);
} finally {
  await client.end();
}
