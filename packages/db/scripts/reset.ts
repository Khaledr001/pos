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

/**
 * Real process.env always wins — dotenv does not override what is already set.
 * That is what lets a migration job in production pass DATABASE_URL_MIGRATOR
 * directly while a developer relies on the repo-root .env. A missing file is
 * not an error.
 */
config({ path: resolve(import.meta.dirname, "../../../.env") });
config({ path: resolve(process.cwd(), ".env") });

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

  // The extensions and helper functions went with the schema. `db:migrate`
  // recreates them from sql/bootstrap.sql — deliberately not duplicated here,
  // because two copies of a bootstrap drift and only one of them is the copy a
  // production deploy runs.

  console.log("✓ schema reset. Run `pnpm db:migrate` then `pnpm db:seed`.");
} catch (error) {
  console.error("✗ reset failed:", error);
  process.exit(1);
} finally {
  await client.end();
}
