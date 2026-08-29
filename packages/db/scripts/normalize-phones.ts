/**
 * One-time backfill: rewrite stored phone numbers to E.164.
 *
 *   pnpm db:normalize-phones            report only, changes nothing
 *   pnpm db:normalize-phones -- --apply write the changes
 *
 * `normalizePhone` now runs at the validation boundary
 * (`CreateCustomerSchema`), so everything written from today is already
 * canonical. Everything written BEFORE today is not: `+971501234567`,
 * `971501234567` and `0501234567` are three distinct stored values, and the
 * WhatsApp bot matches an inbound sender by exact equality on
 * `whatsapp_phone`. Without this backfill the bot silently fails to recognise
 * existing customers, and the failure is indistinguishable from "this person
 * is not a customer".
 *
 * THE COLLISION CASE IS THE WHOLE REASON THIS IS A SCRIPT AND NOT A MIGRATION.
 *
 * `uq_customers_tenant_whatsapp` is a real unique index. Two rows holding
 * `0501234567` and `+971501234567` are legal today and become the SAME value
 * once normalised — so a naive `UPDATE` fails on the constraint, or worse,
 * would merge two identities if the constraint were not there. Those rows are
 * reported and skipped: which of two customers owns a number is a question
 * about the business, not about data, and it is not one a script should
 * answer.
 */
import { normalizePhone } from "@devsfleet/shared-utils";
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

interface Row {
  id: string;
  tenant_id: string;
  name: string;
  phone: string | null;
  whatsapp_phone: string | null;
}

const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
  // The migrator role is RLS-subject and needs the platform escape hatch to
  // see across tenants — same mechanism the seed uses. See docs/DECISIONS.md D1.
  await sql`SELECT set_config('app.is_platform_admin', 'on', false)`;

  const rows = await sql<Row[]>`
    SELECT id, tenant_id, name, phone, whatsapp_phone
    FROM customers
    WHERE deleted_at IS NULL
      AND (phone IS NOT NULL OR whatsapp_phone IS NOT NULL)
    ORDER BY tenant_id, created_at
  `;

  /** Where a normalised whatsapp number would land, per tenant. */
  const claimed = new Map<string, Row>();
  const collisions: Array<{ row: Row; target: string; heldBy: Row }> = [];
  const updates: Array<{ id: string; phone: string | null; whatsapp: string | null }> = [];

  // Rows already canonical claim their number first, so an unchanged row is
  // never reported as losing a collision to a row that had to be rewritten.
  const ordered = [
    ...rows.filter((r) => r.whatsapp_phone && normalizePhone(r.whatsapp_phone) === r.whatsapp_phone),
    ...rows.filter((r) => !(r.whatsapp_phone && normalizePhone(r.whatsapp_phone) === r.whatsapp_phone)),
  ];

  for (const row of ordered) {
    const phone = row.phone ? normalizePhone(row.phone) : null;
    const whatsapp = row.whatsapp_phone ? normalizePhone(row.whatsapp_phone) : null;

    let whatsappTarget = whatsapp;
    if (whatsapp) {
      const key = `${row.tenant_id}:${whatsapp}`;
      const holder = claimed.get(key);
      if (holder && holder.id !== row.id) {
        collisions.push({ row, target: whatsapp, heldBy: holder });
        // Leave this row's whatsapp number exactly as it was. A half-migrated
        // value would be neither findable nor safely re-runnable.
        whatsappTarget = row.whatsapp_phone;
      } else {
        claimed.set(key, row);
      }
    }

    const phoneChanged = phone !== row.phone;
    const whatsappChanged = whatsappTarget !== row.whatsapp_phone;
    if (phoneChanged || whatsappChanged) {
      updates.push({ id: row.id, phone, whatsapp: whatsappTarget });
    }
  }

  console.log(`\nScanned ${rows.length} customer(s) with a phone number.\n`);

  if (collisions.length > 0) {
    console.warn(`⚠  ${collisions.length} WhatsApp number(s) would collide — SKIPPED, resolve by hand:\n`);
    for (const { row, target, heldBy } of collisions) {
      console.warn(`   ${target}`);
      console.warn(`     keeps it : ${heldBy.name} (${heldBy.id}) — stored as ${heldBy.whatsapp_phone}`);
      console.warn(`     skipped  : ${row.name} (${row.id}) — stored as ${row.whatsapp_phone}`);
    }
    console.warn(
      `\n   Decide which customer owns each number, clear the other, then re-run.\n` +
        `   Until then the skipped customer will not be recognised by the bot.\n`,
    );
  }

  if (updates.length === 0) {
    console.log("✓ Nothing to rewrite — every stored number is already E.164.\n");
  } else if (!apply) {
    console.log(`${updates.length} row(s) would be rewritten. Sample:\n`);
    for (const u of updates.slice(0, 10)) {
      const before = rows.find((r) => r.id === u.id)!;
      console.log(
        `   ${before.name.slice(0, 28).padEnd(30)} ` +
          `phone ${String(before.phone).padEnd(18)} -> ${String(u.phone).padEnd(18)} | ` +
          `whatsapp ${String(before.whatsapp_phone).padEnd(18)} -> ${u.whatsapp}`,
      );
    }
    if (updates.length > 10) console.log(`   … and ${updates.length - 10} more`);
    console.log(`\nDry run — nothing written. Re-run with --apply to commit.\n`);
  } else {
    // One transaction: a partly-normalised customer table is worse than an
    // un-normalised one, because you cannot tell by looking which rows are done.
    await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.is_platform_admin', 'on', true)`;
      for (const u of updates) {
        await tx`
          UPDATE customers
          SET phone = ${u.phone}, whatsapp_phone = ${u.whatsapp}
          WHERE id = ${u.id}
        `;
      }
    });
    console.log(`✓ Rewrote ${updates.length} row(s) to E.164.\n`);
  }

  if (collisions.length > 0) process.exitCode = 1;
} catch (error) {
  console.error("✗ backfill failed:", error instanceof Error ? error.message : error);
  process.exit(1);
} finally {
  await sql.end();
}
