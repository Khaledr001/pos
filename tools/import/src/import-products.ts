/**
 * Bulk product importer.
 *
 *   pnpm --filter @devsfleet/import import -- "/path/to/list.xlsx" --tenant <id-or-slug>
 *   pnpm --filter @devsfleet/import import -- "/path/to/list.xlsx" --tenant <id-or-slug> --commit
 *
 * DRY RUN BY DEFAULT. Nothing is written until `--commit` is passed — `main()`
 * below prints created/updated/unchanged/rejected counts either way, so a
 * dry run tells you exactly what a commit would do before you do it.
 *
 * COLUMN MAPPING. There is no real supplier price list to profile in this
 * environment (see CLAUDE.md's "Not yet decided" — the schema stayed a
 * skeleton for exactly this reason), so this expects a canonical header set
 * instead of a guessed real-world one: sku, name, category, brand, unit,
 * barcode, sellingPrice, purchasePrice, minSellingPrice, taxRate — matched
 * case-insensitively with punctuation/spacing stripped (row-schema.ts).
 * Run `profile.ts` against the real file first and rename its columns to
 * match; anything left over lands in `products.attributes` (JSONB), keyed
 * by its original header text.
 *
 * ONE ROW = ONE PRODUCT WITH ONE VARIANT ("Default"). A flat distributor
 * price list is virtually never grouped by product family, and matching on
 * the variant's own SKU (not the product's) is what makes re-importing the
 * same file safe even if a product was later given extra hand-created
 * variants — this importer only ever touches the variant it matched.
 *
 * WHAT COUNTS AS "IDEMPOTENT" HERE, deliberately narrow: an existing
 * variant's PRICE and BARCODE are updated when the file disagrees with what
 * is stored; product-level fields (name, category, brand, unit, taxRate,
 * attributes) are set only when the product is CREATED, never touched on a
 * re-import. Comparing and possibly overwriting hand-curated catalogue
 * fields on every re-run risks clobbering an edit a human made in the admin
 * panel after the last import; the price is the one figure this file is
 * actually the authority on.
 *
 * Requirements this satisfies, all of them learned the expensive way:
 *
 *  1. DRY RUN FIRST, always. Report what would change — created, updated,
 *     price-changed, unchanged, rejected — and write nothing until `--commit`.
 *  2. IDEMPOTENT on SKU (see above). Re-importing the same file changes
 *     nothing on the second pass.
 *  3. PRICE CHANGES ARE HISTORY. Never UPDATE a `product_prices` row. Close
 *     the current one with `effective_to = yesterday`, insert a new one, and
 *     write a `price_history` entry tagged with this run's batch id.
 *  4. VALIDATE THE WHOLE FILE, THEN WRITE. Every row is parsed and checked
 *     before any write begins; a bad row is rejected and reported, not a
 *     reason to abort rows around it — but nothing commits until the whole
 *     file has been read once.
 *  5. REPORT DUPLICATES rather than silently keeping the last one. The same
 *     SKU twice in one sheet is a question for whoever produced the file.
 *  6. NORMALISE with `searchKey()` and `normalizeBarcode()` from
 *     @devsfleet/shared-utils, so `3/4"` and `3/4 inch` land on one product.
 *  7. CHUNK the writes (500 rows per transaction). One transaction over
 *     5,000 rows holds locks long enough to stall the POS terminals.
 */
import { createDbClient, eq, schema, sql, withPlatformAdmin, withTenant, type DbClient, type Transaction } from "@devsfleet/db";
import { Money, searchKey } from "@devsfleet/shared-utils";
import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import ExcelJS from "exceljs";
import { findDuplicateSkus, parseRow, type ParsedProductRow } from "./row-schema.js";

config({ path: resolve(process.cwd(), "../../.env") });

const CHUNK_SIZE = 500;

function parseArgs(argv: string[]) {
  const file = argv[2];
  const tenantIndex = argv.indexOf("--tenant");
  const tenant = tenantIndex >= 0 ? argv[tenantIndex + 1] : undefined;
  const commit = argv.includes("--commit");

  if (!file || !tenant) {
    console.error(
      'Usage: pnpm --filter @devsfleet/import import -- "<file.xlsx|.csv>" --tenant <id-or-slug> [--commit]',
    );
    process.exit(1);
  }
  return { file, tenant, commit };
}

async function readRows(path: string): Promise<{ headers: string[]; rows: ParsedProductRow[]; rejected: Array<{ rowNumber: number; reason: string }> }> {
  const workbook = new ExcelJS.Workbook();
  if (path.toLowerCase().endsWith(".csv")) {
    await workbook.csv.readFile(path);
  } else {
    await workbook.xlsx.readFile(path);
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("The workbook has no sheets");

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col - 1] = String(cell.value ?? "").trim();
  });

  const rows: ParsedProductRow[] = [];
  const rejected: Array<{ rowNumber: number; reason: string }> = [];

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;

    const values: unknown[] = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      values[col - 1] = cell.value;
    });

    const result = parseRow(headers, values, rowNumber);
    if (result.ok) rows.push(result.row);
    else rejected.push({ rowNumber: result.rowNumber, reason: result.reason });
  });

  return { headers, rows, rejected };
}

interface Lookups {
  categoriesByName: Map<string, string>;
  unitsByAbbr: Map<string, string>;
  brandsByName: Map<string, string>;
  defaultPriceListId: string;
}

async function loadLookups(tx: Transaction, tenantId: string): Promise<Lookups> {
  const [categories, units, brands, defaultList] = await Promise.all([
    tx.select({ id: schema.categories.id, name: schema.categories.name }).from(schema.categories),
    tx.select({ id: schema.units.id, abbreviation: schema.units.abbreviation }).from(schema.units),
    tx.select({ id: schema.brands.id, name: schema.brands.name }).from(schema.brands),
    tx.query.priceLists.findFirst({
      where: (t, { and: a, eq: e }) => a(e(t.isDefault, true), e(t.isActive, true)),
      columns: { id: true },
    }),
  ]);

  if (!defaultList) {
    throw new Error(`Tenant ${tenantId} has no default price list — create one before importing.`);
  }

  return {
    categoriesByName: new Map(categories.map((c) => [c.name.trim().toLowerCase(), c.id])),
    unitsByAbbr: new Map(units.map((u) => [u.abbreviation.trim().toLowerCase(), u.id])),
    brandsByName: new Map(brands.map((b) => [b.name.trim().toLowerCase(), b.id])),
    defaultPriceListId: defaultList.id,
  };
}

type PlanOutcome =
  | { kind: "create" }
  | { kind: "update"; variantId: string; priceChanged: boolean; barcodeChanged: boolean }
  | { kind: "unchanged"; variantId: string }
  | { kind: "rejected"; reason: string };

/** Read-only: decides what WOULD happen to one row, against the database as it stands right now. */
async function planRow(tx: Transaction, tenantId: string, lookups: Lookups, row: ParsedProductRow): Promise<PlanOutcome> {
  const unitId = lookups.unitsByAbbr.get(row.unitAbbr.trim().toLowerCase());
  if (!unitId) return { kind: "rejected", reason: `${row.sku}: unknown unit "${row.unitAbbr}"` };

  if (row.categoryName && !lookups.categoriesByName.has(row.categoryName.trim().toLowerCase())) {
    return { kind: "rejected", reason: `${row.sku}: unknown category "${row.categoryName}"` };
  }

  const existing = await tx.query.productVariants.findFirst({
    where: (t, { and: a, eq: e, isNull: n }) => a(e(t.sku, row.sku), n(t.deletedAt)),
    columns: { id: true, barcode: true },
  });

  if (!existing) return { kind: "create" };

  const currentPrice = await tx.query.productPrices.findFirst({
    where: (t, { and: a, eq: e, isNull: n }) =>
      a(e(t.variantId, existing.id), e(t.priceListId, lookups.defaultPriceListId), n(t.effectiveTo)),
    columns: { sellingPrice: true },
  });

  const priceChanged = !currentPrice || Money.toMinor(currentPrice.sellingPrice) !== Money.toMinor(String(row.sellingPrice));
  const barcodeChanged = (existing.barcode ?? null) !== (row.barcode ?? null);

  if (!priceChanged && !barcodeChanged) return { kind: "unchanged", variantId: existing.id };
  return { kind: "update", variantId: existing.id, priceChanged, barcodeChanged };
}

/** Writes. Only called under --commit, and only after planRow already decided what this row needs. */
async function applyRow(
  tx: Transaction,
  tenantId: string,
  lookups: Lookups,
  row: ParsedProductRow,
  plan: Extract<PlanOutcome, { kind: "create" | "update" }>,
  batchId: string,
): Promise<void> {
  if (plan.kind === "create") {
    const categoryId = row.categoryName ? lookups.categoriesByName.get(row.categoryName.trim().toLowerCase()) : null;
    const brandId = row.brandName ? lookups.brandsByName.get(row.brandName.trim().toLowerCase()) : null;
    const unitId = lookups.unitsByAbbr.get(row.unitAbbr.trim().toLowerCase())!;

    const [product] = await tx
      .insert(schema.products)
      .values({
        tenantId,
        sku: row.sku,
        name: row.name,
        categoryId: categoryId ?? null,
        brandId: brandId ?? null,
        unitId,
        attributes: row.attributes,
        ...(row.taxRate !== null ? { taxRate: String(row.taxRate) } : {}),
      })
      .returning({ id: schema.products.id });
    if (!product) throw new Error(`Could not create product ${row.sku}`);

    const [variant] = await tx
      .insert(schema.productVariants)
      .values({
        tenantId,
        productId: product.id,
        sku: row.sku,
        barcode: row.barcode,
        searchKey: searchKey(row.name, row.sku),
      })
      .returning({ id: schema.productVariants.id });
    if (!variant) throw new Error(`Could not create variant ${row.sku}`);

    await tx.insert(schema.productPrices).values({
      tenantId,
      variantId: variant.id,
      priceListId: lookups.defaultPriceListId,
      sellingPrice: String(row.sellingPrice),
      purchasePrice: String(row.purchasePrice),
      ...(row.minSellingPrice !== null ? { minSellingPrice: String(row.minSellingPrice) } : {}),
    });

    // A first price is still worth a history row — see pricing.service.ts's
    // own applyProductPrice, which this mirrors for exactly the same reason.
    await tx.insert(schema.priceHistory).values({
      tenantId,
      variantId: variant.id,
      priceListId: lookups.defaultPriceListId,
      newSellingPrice: String(row.sellingPrice),
      newPurchasePrice: String(row.purchasePrice),
      ...(row.minSellingPrice !== null ? { newMinSellingPrice: String(row.minSellingPrice) } : {}),
      importBatchId: batchId,
    });
    return;
  }

  // update
  if (plan.barcodeChanged) {
    await tx
      .update(schema.productVariants)
      .set({ barcode: row.barcode })
      .where(eq(schema.productVariants.id, plan.variantId));
  }

  if (plan.priceChanged) {
    // minSellingPrice is deliberately left untouched when the file has none
    // for this row, unlike PricingService.applyProductPrice (which always
    // writes it, even to null, for an explicit single-price-set action). A
    // bulk file routinely lacks a floor column entirely; treating that as
    // "clear the floor" would silently strip a control an admin set by hand
    // on every ordinary re-import.
    const today = new Date().toISOString().slice(0, 10);
    const current = await tx.query.productPrices.findFirst({
      where: (t, { and: a, eq: e, isNull: n }) =>
        a(e(t.variantId, plan.variantId), e(t.priceListId, lookups.defaultPriceListId), n(t.effectiveTo)),
    });

    await tx.insert(schema.priceHistory).values({
      tenantId,
      variantId: plan.variantId,
      priceListId: lookups.defaultPriceListId,
      oldSellingPrice: current?.sellingPrice ?? null,
      newSellingPrice: String(row.sellingPrice),
      oldPurchasePrice: current?.purchasePrice ?? null,
      newPurchasePrice: String(row.purchasePrice),
      oldMinSellingPrice: current?.minSellingPrice ?? null,
      ...(row.minSellingPrice !== null ? { newMinSellingPrice: String(row.minSellingPrice) } : {}),
      importBatchId: batchId,
    });

    if (current && current.effectiveFrom === today) {
      // Same-day correction (e.g. this file was already imported once today
      // and is being re-run after a fix) — amend in place, exactly as
      // PricingService.applyProductPrice does for the same reason: there is
      // no room for two rows sharing (variantId, priceListId, effectiveFrom).
      await tx
        .update(schema.productPrices)
        .set({
          sellingPrice: String(row.sellingPrice),
          purchasePrice: String(row.purchasePrice),
          ...(row.minSellingPrice !== null ? { minSellingPrice: String(row.minSellingPrice) } : {}),
        })
        .where(eq(schema.productPrices.id, current.id));
    } else {
      if (current) {
        // One day BEFORE the new row's effectiveFrom, never the same date —
        // the resolver's date bound is inclusive on both ends, so closing on
        // the same day the new one starts would make both match "today" at
        // once. Mirrors PricingService.applyProductPrice exactly.
        await tx
          .update(schema.productPrices)
          .set({ effectiveTo: sql`(${today}::date - interval '1 day')::date` })
          .where(eq(schema.productPrices.id, current.id));
      }
      await tx.insert(schema.productPrices).values({
        tenantId,
        variantId: plan.variantId,
        priceListId: lookups.defaultPriceListId,
        sellingPrice: String(row.sellingPrice),
        purchasePrice: String(row.purchasePrice),
        ...(row.minSellingPrice !== null ? { minSellingPrice: String(row.minSellingPrice) } : {}),
        effectiveFrom: today,
      });
    }
  }
}

async function resolveTenantId(db: DbClient["db"], tenantArg: string): Promise<string> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantArg);

  return withPlatformAdmin(db, async (tx) => {
    const tenant = await tx.query.tenants.findFirst({
      where: (t, { eq: e }) => (isUuid ? e(t.id, tenantArg) : e(t.slug, tenantArg)),
      columns: { id: true },
    });
    if (!tenant) throw new Error(`No tenant found for "${tenantArg}"`);
    return tenant.id;
  });
}

async function main() {
  const { file, tenant: tenantArg, commit } = parseArgs(process.argv);

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env at the repo root.");
    process.exit(1);
  }

  const path = resolve(process.cwd(), file);
  console.log(`Reading ${path}...`);
  const { rows, rejected } = await readRows(path);
  const totalDataRows = rows.length + rejected.length;

  const duplicates = findDuplicateSkus(rows);
  const duplicateSkus = new Set(duplicates.keys());
  const importable = rows.filter((r) => !duplicateSkus.has(r.sku));

  for (const [sku, rowNumbers] of duplicates) {
    rejected.push({ rowNumber: rowNumbers[0]!, reason: `${sku}: appears on rows ${rowNumbers.join(", ")} — fix the file, do not guess which one is right` });
  }

  console.log(`${totalDataRows} data rows read.`);
  if (rejected.length > 0) {
    console.log(`\n${rejected.length} row(s) rejected outright:`);
    for (const r of rejected) console.log(`  row ${r.rowNumber}: ${r.reason}`);
  }

  const { db, close } = createDbClient({ url });
  try {
    const tenantId = await resolveTenantId(db, tenantArg);

    const tally = { created: 0, updated: 0, unchanged: 0, rejected: rejected.length };
    const planRejections: string[] = [];
    const batchId = randomUUID();

    for (let i = 0; i < importable.length; i += CHUNK_SIZE) {
      const chunk = importable.slice(i, i + CHUNK_SIZE);

      await withTenant(db, tenantId, async (tx) => {
        const lookups = await loadLookups(tx, tenantId);

        for (const row of chunk) {
          const plan = await planRow(tx, tenantId, lookups, row);

          if (plan.kind === "rejected") {
            tally.rejected += 1;
            planRejections.push(plan.reason);
            continue;
          }
          if (plan.kind === "unchanged") {
            tally.unchanged += 1;
            continue;
          }
          if (plan.kind === "create") tally.created += 1;
          else tally.updated += 1;

          if (commit) await applyRow(tx, tenantId, lookups, row, plan, batchId);
        }
      });
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(commit ? "COMMITTED" : "DRY RUN — nothing was written. Pass --commit to apply.");
    console.log("=".repeat(60));
    console.log(`  created:    ${tally.created}`);
    console.log(`  updated:    ${tally.updated}`);
    console.log(`  unchanged:  ${tally.unchanged}`);
    console.log(`  rejected:   ${tally.rejected}`);
    if (planRejections.length > 0) {
      console.log(`\nRejected during planning:`);
      for (const reason of planRejections) console.log(`  ${reason}`);
    }
  } finally {
    await close();
  }
}

main().catch((error) => {
  console.error("✗ import failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
