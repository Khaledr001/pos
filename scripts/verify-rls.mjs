#!/usr/bin/env node
/**
 * Prove that row-level security actually isolates tenants.
 *
 * This cannot be a unit test. Isolation is enforced by PostgreSQL, not by
 * application code, so the only way to know it works is to connect as the
 * unprivileged runtime role and try to read across the boundary. A mocked
 * database would happily "pass" while production leaked.
 *
 * Creates a probe tenant, checks every assertion, and removes it again.
 *
 *   DATABASE_URL_MIGRATOR=... DATABASE_URL=... node scripts/verify-rls.mjs
 *
 * Runs in CI on every change to apps/api or packages/**.
 */
import postgres from "postgres";

const migratorUrl = process.env.DATABASE_URL_MIGRATOR;
const appUrl = process.env.DATABASE_URL;

if (!migratorUrl || !appUrl) {
  console.error("Both DATABASE_URL_MIGRATOR and DATABASE_URL must be set.");
  process.exit(1);
}

if (appUrl.includes("devsfleet_migrator")) {
  console.error(
    "DATABASE_URL points at the migrator role, which bypasses RLS. " +
      "This check would pass without proving anything.",
  );
  process.exit(1);
}

const migrator = postgres(migratorUrl, { max: 1, onnotice: () => {} });
const app = postgres(appUrl, { max: 1, onnotice: () => {} });

const results = [];
const check = (name, passed, detail = "") =>
  results.push({ name, passed, detail });

const PROBE_SLUG = "rls-probe-tenant";

try {
  // ---------------------------------------------------------------------------
  // Set up: a second tenant with one product of its own.
  // ---------------------------------------------------------------------------
  await migrator.unsafe(`SET app.is_platform_admin = 'on'`);

  const [existing] = await migrator`
    SELECT id FROM tenants WHERE slug = ${PROBE_SLUG}
  `;
  const probeTenantId =
    existing?.id ??
    (
      await migrator`
        INSERT INTO tenants (name, slug) VALUES ('RLS Probe', ${PROBE_SLUG})
        RETURNING id
      `
    )[0].id;

  await migrator`
    INSERT INTO units (tenant_id, name, abbreviation)
    VALUES (${probeTenantId}, 'Piece', 'pcs')
    ON CONFLICT DO NOTHING
  `;
  const [probeUnit] = await migrator`
    SELECT id FROM units WHERE tenant_id = ${probeTenantId} LIMIT 1
  `;
  await migrator`
    INSERT INTO products (tenant_id, sku, name, unit_id)
    VALUES (${probeTenantId}, 'RLS-PROBE-001', 'RLS Probe Widget', ${probeUnit.id})
    ON CONFLICT DO NOTHING
  `;

  const [realTenant] = await migrator`
    SELECT id FROM tenants WHERE slug <> ${PROBE_SLUG} ORDER BY created_at LIMIT 1
  `;

  if (!realTenant) {
    console.error("No second tenant to test against — run `pnpm db:seed` first.");
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // 1. No tenant context reads nothing.
  //
  // current_tenant_id() returns NULL when the GUC was never set, and NULL
  // matches no row. A request that forgets to set context must therefore fail
  // closed — returning an empty result, never the whole table.
  // ---------------------------------------------------------------------------
  const [noContext] = await app`SELECT count(*)::int AS n FROM products`;
  check(
    "no tenant context returns zero rows",
    noContext.n === 0,
    `saw ${noContext.n}`,
  );

  // ---------------------------------------------------------------------------
  // 2. Scoped reads see only their own tenant.
  // ---------------------------------------------------------------------------
  const scopedRead = async (tenantId, sku) =>
    app.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      const [total] = await tx`SELECT count(*)::int AS n FROM products`;
      const [leaked] = await tx`
        SELECT count(*)::int AS n FROM products WHERE sku = ${sku}
      `;
      const [tenants] = await tx`SELECT count(*)::int AS n FROM tenants`;
      return { total: total.n, leaked: leaked.n, tenants: tenants.n };
    });

  const asProbe = await scopedRead(probeTenantId, "PVC-ELB-001");
  check(
    "probe tenant sees no rows from the seeded tenant",
    asProbe.leaked === 0,
    `leaked ${asProbe.leaked}`,
  );
  check(
    "probe tenant sees exactly its own tenant row",
    asProbe.tenants === 1,
    `saw ${asProbe.tenants}`,
  );

  const asReal = await scopedRead(realTenant.id, "RLS-PROBE-001");
  check(
    "seeded tenant sees no rows from the probe tenant",
    asReal.leaked === 0,
    `leaked ${asReal.leaked}`,
  );
  check("seeded tenant still sees its own products", asReal.total > 0, `saw ${asReal.total}`);

  // ---------------------------------------------------------------------------
  // 3. WITH CHECK blocks writing into another tenant.
  //
  // A USING clause alone would filter reads while still permitting an INSERT
  // stamped with someone else's tenant_id.
  // ---------------------------------------------------------------------------
  let writeBlocked = false;
  try {
    await app.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${realTenant.id}, true)`;
      await tx`
        INSERT INTO brands (tenant_id, name, slug)
        VALUES (${probeTenantId}, 'Smuggled', 'smuggled-probe')
      `;
    });
  } catch (error) {
    writeBlocked = /row-level security/i.test(String(error));
  }
  check("cross-tenant INSERT is rejected by WITH CHECK", writeBlocked);

  // ---------------------------------------------------------------------------
  // 4. Ledgers reject mutation.
  // ---------------------------------------------------------------------------
  const expectRejected = async (statement) => {
    try {
      await migrator.unsafe(`SET app.is_platform_admin = 'on'; ${statement}`);
      return false;
    } catch (error) {
      return /immutable/i.test(String(error));
    }
  };

  check(
    "inventory_transactions rejects UPDATE",
    await expectRejected(
      `UPDATE inventory_transactions SET quantity = '1'
       WHERE id = (SELECT id FROM inventory_transactions LIMIT 1)`,
    ),
  );

  /**
   * A row has to exist first. `BEFORE DELETE` triggers fire per row, so a
   * DELETE that matches nothing raises nothing — and on a freshly seeded
   * database `audit_log` is empty, which made this check report a failure the
   * schema had not actually committed.
   */
  await migrator`
    INSERT INTO audit_log (tenant_id, entity_type, action, reason)
    VALUES (${realTenant.id}, 'rls_probe', 'create', 'immutability check')
  `;
  check(
    "audit_log rejects DELETE",
    await expectRejected(`DELETE FROM audit_log WHERE entity_type = 'rls_probe'`),
  );
  check(
    "audit_log rejects UPDATE",
    await expectRejected(
      `UPDATE audit_log SET action = 'tampered' WHERE entity_type = 'rls_probe'`,
    ),
  );

  // ---------------------------------------------------------------------------
  // 5. Every tenant-scoped table is covered.
  // ---------------------------------------------------------------------------
  const unprotected = await migrator`
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id'
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND NOT a.attisdropped AND NOT c.relrowsecurity
  `;
  check(
    "every tenant-scoped table has RLS enabled",
    unprotected.length === 0,
    unprotected.map((r) => r.relname).join(", "),
  );

  const policyless = await migrator`
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
      AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
  `;
  check(
    "every RLS-enabled table has a policy attached",
    policyless.length === 0,
    policyless.map((r) => r.relname).join(", "),
  );

  // ---------------------------------------------------------------------------
  // Clean up the probe tenant.
  // ---------------------------------------------------------------------------
  await migrator.unsafe(`SET app.is_platform_admin = 'on'`);
  await migrator`DELETE FROM products WHERE tenant_id = ${probeTenantId}`;
  await migrator`DELETE FROM units WHERE tenant_id = ${probeTenantId}`;
  await migrator`DELETE FROM brands WHERE tenant_id = ${probeTenantId}`;
  await migrator`DELETE FROM tenants WHERE id = ${probeTenantId}`;
} catch (error) {
  console.error("✗ verification crashed:", error);
  process.exitCode = 1;
} finally {
  await migrator.end();
  await app.end();
}

// -----------------------------------------------------------------------------

const failed = results.filter((r) => !r.passed);

for (const r of results) {
  console.log(`  ${r.passed ? "✓" : "✗"} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
}

if (failed.length > 0) {
  console.error(
    `\n✗ ${failed.length} of ${results.length} checks failed.\n` +
      "Tenant isolation is not intact. Treat this as a production incident.\n",
  );
  process.exit(1);
}

console.log(`\n✓ all ${results.length} isolation checks passed`);
