/**
 * Compiled migration entrypoint, for production containers.
 *
 *   node node_modules/@devsfleet/db/dist/bin/migrate.js
 *
 * Reads DATABASE_URL_MIGRATOR from the real environment only — no dotenv, no
 * repo-root lookup. In a container there is no repo, and a migration that
 * silently picked up a stale file would be worse than one that refuses to run.
 *
 * Developers use `pnpm db:migrate`, which goes through scripts/migrate.ts and
 * does read .env.
 */
import { runMigrations } from "../migrator.js";

const url = process.env.DATABASE_URL_MIGRATOR;

if (!url) {
  console.error(
    "DATABASE_URL_MIGRATOR is not set.\n" +
      "Pass it as an environment variable — this entrypoint deliberately does " +
      "not read .env files.",
  );
  process.exit(1);
}

try {
  await runMigrations({ url, log: (m) => console.log(m) });
} catch (error) {
  console.error("✗ migration failed:", error instanceof Error ? error.message : error);
  process.exit(1);
}
