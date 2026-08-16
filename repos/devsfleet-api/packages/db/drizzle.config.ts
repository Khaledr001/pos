import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";
import { resolve } from "node:path";

// Single .env at the repo root; every workspace reads the same one.
// process.cwd() rather than import.meta.dirname: drizzle-kit bundles this file
// before evaluating it, and the bundle has no meaningful module directory.
config({ path: resolve(process.cwd(), "../../.env") });

const url = process.env.DATABASE_URL_MIGRATOR ?? process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL_MIGRATOR is not set. Copy .env.example to .env at the repo root.",
  );
}

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: { url },

  /**
   * Columns are declared in camelCase in TypeScript and created as snake_case
   * in Postgres.
   *
   * This MUST be mirrored in the runtime client (src/client.ts) — drizzle-kit
   * and drizzle-orm read the setting independently, and a mismatch produces
   * queries that reference columns which do not exist, at runtime only.
   */
  casing: "snake_case",

  verbose: true,
  strict: true,
});
