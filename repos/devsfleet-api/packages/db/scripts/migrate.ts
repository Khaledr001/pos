/**
 * Developer-facing migration CLI.
 *
 *   pnpm db:migrate
 *
 * A thin wrapper: the actual work lives in src/migrator.ts so it compiles into
 * dist/ and a production container can run it with plain `node`, without `tsx`.
 * See packages/db/src/bin/migrate.ts for that entrypoint.
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { runMigrations } from "../src/migrator.js";

/**
 * Real process.env always wins — dotenv does not override what is already set.
 * That is what lets a one-off job pass DATABASE_URL_MIGRATOR directly while a
 * developer relies on the repo-root .env. A missing file is not an error.
 */
config({ path: resolve(import.meta.dirname, "../../../.env") });
config({ path: resolve(process.cwd(), ".env") });

const url = process.env.DATABASE_URL_MIGRATOR;
if (!url) {
  console.error("DATABASE_URL_MIGRATOR is not set. Copy .env.example to .env.");
  process.exit(1);
}

try {
  await runMigrations({ url, log: (message) => console.log(message) });
} catch (error) {
  console.error("✗ migration failed:", error instanceof Error ? error.message : error);
  process.exit(1);
}
