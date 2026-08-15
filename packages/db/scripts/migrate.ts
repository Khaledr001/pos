/**
 * Apply drizzle migrations, then re-apply the hand-written SQL that drizzle-kit
 * cannot express: RLS policies and triggers.
 *
 * Both SQL files are idempotent and run on every migrate, so a table added in
 * this migration gets its tenant isolation and its updated_at trigger without
 * anyone having to remember.
 *
 * Runs as the MIGRATOR role — the app role deliberately cannot alter schema.
 *
 *   pnpm db:migrate
 */
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";

config({ path: resolve(import.meta.dirname, "../../../.env") });

const url = process.env.DATABASE_URL_MIGRATOR;
if (!url) {
  console.error("DATABASE_URL_MIGRATOR is not set. Copy .env.example to .env.");
  process.exit(1);
}

const packageRoot = resolve(import.meta.dirname, "..");

// max: 1 — migrations must run on a single connection, in order.
const client = postgres(url, { max: 1, onnotice: () => {} });

try {
  console.log("→ applying drizzle migrations");
  await migrate(drizzle(client), {
    migrationsFolder: resolve(packageRoot, "migrations"),
    migrationsTable: "drizzle_migrations",
  });

  for (const file of ["triggers.sql", "rls.sql"]) {
    console.log(`→ applying sql/${file}`);
    const contents = await readFile(resolve(packageRoot, "sql", file), "utf8");
    await client.unsafe(contents);
  }

  // Fail loudly if any tenant-scoped table slipped through without isolation.
  const unprotected = await client<{ relname: string }[]>`
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id'
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND NOT a.attisdropped
      AND NOT c.relrowsecurity
  `;

  if (unprotected.length > 0) {
    console.error(
      `\n✗ ${unprotected.length} tenant-scoped table(s) have no row-level security:`,
    );
    for (const row of unprotected) console.error(`    ${row.relname}`);
    process.exit(1);
  }

  console.log("✓ migrations applied, RLS verified");
} catch (error) {
  console.error("✗ migration failed:", error);
  process.exit(1);
} finally {
  await client.end();
}
