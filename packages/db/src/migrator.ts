import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";

/**
 * Migration runner, as a library function rather than a script.
 *
 * It lives in `src/` (and therefore in `dist/`) so a production container can
 * run it with plain `node`. The CLI wrapper in `scripts/migrate.ts` uses `tsx`,
 * which is a devDependency and does not exist in a deployed image — putting the
 * logic only there would mean production migrations had no way to run.
 */

export interface MigrateOptions {
  /** MIGRATOR role. Owns the schema and bypasses RLS. Never the app role. */
  url: string;
  /**
   * Folder holding drizzle's generated SQL. Defaults to the copy shipped inside
   * this package, which is correct both in the monorepo and after
   * `pnpm deploy`, because package.json lists `migrations` and `sql` in `files`.
   */
  migrationsFolder?: string;
  sqlFolder?: string;
  log?: (message: string) => void;
}

export interface MigrateResult {
  applied: true;
  /** Tenant-scoped tables found without RLS. Non-empty means the run failed. */
  unprotectedTables: string[];
}

const packageRoot = resolve(import.meta.dirname, "..");

/**
 * Apply migrations, then reapply the hand-written SQL drizzle-kit cannot
 * express: the RLS policies and the triggers.
 *
 * Both SQL files are idempotent and run every time, so a table added in this
 * migration picks up its tenant isolation and its `updated_at` trigger without
 * anyone having to remember. The final check is the safety net: if a
 * tenant-scoped table ended up without row-level security, this throws rather
 * than leaving a table that silently serves every tenant's data.
 */
export async function runMigrations(options: MigrateOptions): Promise<MigrateResult> {
  const {
    url,
    migrationsFolder = resolve(packageRoot, "migrations"),
    sqlFolder = resolve(packageRoot, "sql"),
    log = () => {},
  } = options;

  if (url.includes("devsfleet_app")) {
    throw new Error(
      "Migrations must run as devsfleet_migrator. The app role cannot alter " +
        "schema, and pointing this at it would fail halfway through.",
    );
  }

  // max: 1 — migrations must run on a single connection, in order.
  const client = postgres(url, { max: 1, onnotice: () => {} });

  try {
    log("→ applying drizzle migrations");
    await migrate(drizzle(client), {
      migrationsFolder,
      migrationsTable: "drizzle_migrations",
    });

    for (const file of ["triggers.sql", "rls.sql"]) {
      log(`→ applying sql/${file}`);
      await client.unsafe(await readFile(resolve(sqlFolder, file), "utf8"));
    }

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

    const unprotectedTables = unprotected.map((row) => row.relname);
    if (unprotectedTables.length > 0) {
      throw new Error(
        `${unprotectedTables.length} tenant-scoped table(s) have no row-level ` +
          `security: ${unprotectedTables.join(", ")}. ` +
          `Every one of them would serve data across tenants.`,
      );
    }

    log("✓ migrations applied, RLS verified");
    return { applied: true, unprotectedTables };
  } finally {
    await client.end();
  }
}
