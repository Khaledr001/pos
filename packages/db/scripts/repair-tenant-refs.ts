/**
 * Find, and where it is safe, repair rows that point at another tenant's rows.
 *
 *   pnpm db:repair-tenant-refs             report only, changes nothing
 *   pnpm db:repair-tenant-refs -- --apply  repair what can be repaired
 *
 * A foreign key proves the referenced row exists, not that it belongs to the
 * same business, and Postgres checks foreign keys without row-level security.
 * While a connection bypassed RLS (dev, 2026-10-01 to 10-09), lookups by name
 * matched other tenants' rows and the writes that followed linked to them:
 * products on another tenant's "pcs", storefront listings of another tenant's
 * products, one sale booked against another tenant's branch. `triggers.sql`
 * now refuses new ones; this cleans up what got in before it.
 *
 * WHAT --apply DOES, AND WHY ONLY THAT
 *
 * - A reference to another tenant's UNIT or BRAND is master data that means
 *   the same thing in every business. It is re-pointed at the row's own
 *   tenant's unit with the same abbreviation, or brand with the same name —
 *   created first if that tenant has none, so nothing is lost.
 * - A storefront LISTING or IMAGE CANDIDATE of another tenant's product is a
 *   row that should never have existed: it is deleted.
 * - Everything else — a sale, a payment, a stock movement — is a tax document
 *   or an append-only ledger. Rewriting which branch a sale was booked at is
 *   not a data fix, it is a decision about what happened; those are reported
 *   and left alone, and the script exits non-zero while any remain.
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import postgres from "postgres";

config({ path: resolve(import.meta.dirname, "../../../.env") });
config({ path: resolve(process.cwd(), ".env") });

const url = process.env.DATABASE_URL_MIGRATOR;
if (!url) {
  console.error("DATABASE_URL_MIGRATOR is not set. Copy .env.example to .env.");
  process.exit(1);
}

const apply = process.argv.includes("--apply");

interface Reference {
  child_table: string;
  child_column: string;
  parent_table: string;
  parent_column: string;
}

/** Tables whose foreign rows are junk to delete rather than data to keep. */
const DELETE_WHEN_FOREIGN = new Set(["product_listings", "product_image_candidates"]);

/** Parents whose rows are interchangeable across tenants by a natural key. */
const REMAP_BY: Record<string, { key: string; copy: string[] }> = {
  units: { key: "abbreviation", copy: ["name", "abbreviation", "allows_fractions"] },
  brands: { key: "name", copy: ["name", "slug"] },
};

const sql = postgres(url, { max: 1, onnotice: () => {} });

/**
 * A quoted identifier, for the two spots where postgres.js reads its own
 * helper as something else — after INSERT INTO it builds a VALUES list, after
 * SET an assignment object. Names here come from pg_catalog or the constants
 * above, never from input.
 */
const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

async function crossTenantCount(tx: postgres.Sql | postgres.TransactionSql, ref: Reference) {
  const [row] = await tx<{ n: string }[]>`
    SELECT count(*)::text AS n
    FROM ${tx(ref.child_table)} ch
    JOIN ${tx(ref.parent_table)} pa ON pa.${tx(ref.parent_column)} = ch.${tx(ref.child_column)}
    WHERE pa.tenant_id IS DISTINCT FROM ch.tenant_id
  `;
  return Number(row?.n ?? 0);
}

try {
  // The migrator role is RLS-subject and needs the platform escape hatch to
  // see across tenants — same mechanism the seed uses. See docs/DECISIONS.md D1.
  await sql`SELECT set_config('app.is_platform_admin', 'on', false)`;

  // Every single-column foreign key between two tenant-scoped tables, except
  // to `users`: an actor from another tenant (the platform operator behind an
  // impersonation) is legitimate, and the trigger skips it for the same reason.
  const references = await sql<Reference[]>`
    SELECT child.relname AS child_table, ca.attname AS child_column,
           parent.relname AS parent_table, pa.attname AS parent_column
    FROM pg_constraint con
    JOIN pg_class child  ON child.oid = con.conrelid
    JOIN pg_class parent ON parent.oid = con.confrelid
    JOIN pg_namespace n  ON n.oid = child.relnamespace
    JOIN pg_attribute ca ON ca.attrelid = con.conrelid  AND ca.attnum = con.conkey[1]
    JOIN pg_attribute pa ON pa.attrelid = con.confrelid AND pa.attnum = con.confkey[1]
    WHERE con.contype = 'f' AND n.nspname = 'public'
      AND array_length(con.conkey, 1) = 1
      AND parent.relname <> 'users'
      AND ca.attname <> 'tenant_id'
      AND EXISTS (SELECT 1 FROM pg_attribute x WHERE x.attrelid = child.oid  AND x.attname = 'tenant_id' AND NOT x.attisdropped)
      AND EXISTS (SELECT 1 FROM pg_attribute x WHERE x.attrelid = parent.oid AND x.attname = 'tenant_id' AND NOT x.attisdropped)
    ORDER BY 1, 2
  `;

  const found: Array<Reference & { count: number }> = [];
  for (const ref of references) {
    const count = await crossTenantCount(sql, ref);
    if (count > 0) found.push({ ...ref, count });
  }

  if (found.length === 0) {
    console.log("✓ No row points at another tenant's row.");
    process.exit(0);
  }

  console.log("Rows pointing at another tenant's row:\n");
  for (const f of found) {
    const action = DELETE_WHEN_FOREIGN.has(f.child_table)
      ? "delete"
      : REMAP_BY[f.parent_table]
        ? `re-point at own ${f.parent_table}`
        : "REPORT ONLY";
    console.log(`  ${f.child_table}.${f.child_column} → ${f.parent_table}: ${f.count}  (${action})`);
  }

  if (!apply) {
    console.log("\nReport only. Re-run with --apply to repair the units, brands and storefront rows.");
    process.exit(found.some((f) => !DELETE_WHEN_FOREIGN.has(f.child_table) && !REMAP_BY[f.parent_table]) ? 2 : 0);
  }

  await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.is_platform_admin', 'on', true)`;

    for (const f of found) {
      if (DELETE_WHEN_FOREIGN.has(f.child_table)) {
        const deleted = await tx`
          DELETE FROM ${tx(f.child_table)} ch
          USING ${tx(f.parent_table)} pa
          WHERE pa.${tx(f.parent_column)} = ch.${tx(f.child_column)}
            AND pa.tenant_id IS DISTINCT FROM ch.tenant_id
        `;
        console.log(`  deleted ${deleted.count} ${f.child_table} row(s)`);
        continue;
      }

      const remap = REMAP_BY[f.parent_table];
      if (!remap) continue;
      const key = remap.key;

      // The child's tenant gets its own copy of any unit/brand it is missing.
      const created = await tx`
        INSERT INTO ${tx.unsafe(ident(f.parent_table))} (tenant_id, ${tx.unsafe(remap.copy.map(ident).join(", "))})
        SELECT DISTINCT ON (ch.tenant_id, lower(pa.${tx(key)}))
               ch.tenant_id, ${tx.unsafe(remap.copy.map((c) => `pa.${ident(c)}`).join(", "))}
        FROM ${tx(f.child_table)} ch
        JOIN ${tx(f.parent_table)} pa ON pa.${tx(f.parent_column)} = ch.${tx(f.child_column)}
        WHERE pa.tenant_id IS DISTINCT FROM ch.tenant_id
          AND NOT EXISTS (
            SELECT 1 FROM ${tx(f.parent_table)} own
            WHERE own.tenant_id = ch.tenant_id AND lower(own.${tx(key)}) = lower(pa.${tx(key)})
          )
        ON CONFLICT DO NOTHING
      `;
      if (created.count > 0) console.log(`  created ${created.count} ${f.parent_table} row(s) for their own tenants`);

      // A correlated subquery rather than a LATERAL join: an UPDATE's own
      // target cannot be referenced from a LATERAL in its FROM. Rows with no
      // own match are left alone (and reported below) rather than set to NULL.
      const ownMatch = tx`
        SELECT o.id FROM ${tx(f.parent_table)} o
        WHERE o.tenant_id = ch.tenant_id AND lower(o.${tx(key)}) = lower(pa.${tx(key)})
        ORDER BY o.created_at, o.id
        LIMIT 1
      `;
      const updated = await tx`
        UPDATE ${tx(f.child_table)} ch
        SET ${tx.unsafe(ident(f.child_column))} = (${ownMatch})
        FROM ${tx(f.parent_table)} pa
        WHERE pa.${tx(f.parent_column)} = ch.${tx(f.child_column)}
          AND pa.tenant_id IS DISTINCT FROM ch.tenant_id
          AND EXISTS (${ownMatch})
      `;
      console.log(`  re-pointed ${updated.count} ${f.child_table}.${f.child_column} row(s)`);
    }
  });

  const remaining: Array<Reference & { count: number }> = [];
  for (const ref of references) {
    const count = await crossTenantCount(sql, ref);
    if (count > 0) remaining.push({ ...ref, count });
  }

  if (remaining.length === 0) {
    console.log("\n✓ Repaired. No row points at another tenant's row.");
  } else {
    console.log("\nStill pointing at another tenant — needs a decision, not a script:\n");
    for (const r of remaining) console.log(`  ${r.child_table}.${r.child_column} → ${r.parent_table}: ${r.count}`);
    process.exitCode = 2;
  }
} finally {
  await sql.end();
}
