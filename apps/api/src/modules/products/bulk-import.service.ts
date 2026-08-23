/**
 * Bulk product import — server-side.
 *
 * Accepts an Excel/CSV buffer, parses it, validates every row, then either
 * reports what WOULD change (dry run) or commits the changes. This is the
 * in-app version of `tools/import/src/import-products.ts`, running inside
 * the NestJS request context rather than as a standalone CLI script.
 *
 * KEY DIFFERENCES FROM THE CLI TOOL:
 *   - Auto-creates categories and brands instead of rejecting unknown ones
 *   - Auto-generates SKUs when the column is blank
 *   - Handles wholesalePrice and currentStock columns
 *   - Returns structured result instead of printing to console
 *   - Uses TenantDatabase (tenant resolved from JWT)
 */
import { eq, schema, sql, type Transaction } from "@devsfleet/db";
import { Money, normalizeBarcode, searchKey, slugify } from "@devsfleet/shared-utils";
import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { RequestContext } from "../../common/context/request-context.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import { StockService } from "../inventory/stock.service.js";
import type { BulkImportOptionsDto, BulkImportResult, BulkImportRowError } from "./bulk-import.dto.js";

// ── Column mapping ──────────────────────────────────────────────────────────

/** Normalise a header: lowercase, strip non-alphanumeric. */
function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The canonical column keys this importer understands, mapped from normalised
 * header text. "Selling Price", "selling_price", "SELLINGPRICE" all resolve
 * to "sellingprice".
 */
const KNOWN_HEADERS = new Set([
  "name",
  "sku",
  "category",
  "unit",
  "brand",
  "barcode",
  "purchaseprice",
  "sellingprice",
  "wholesaleprice",
  "minstock",
  "currentstock",
  "description",
]);

// ── Row parsing ─────────────────────────────────────────────────────────────

interface ParsedRow {
  rowNumber: number;
  name: string;
  sku: string | null;
  categoryName: string | null;
  unitName: string;
  brandName: string | null;
  barcode: string | null;
  purchasePrice: number;
  sellingPrice: number;
  wholesalePrice: number | null;
  minStock: number;
  currentStock: number;
  description: string | null;
}

interface ParseResult {
  rows: ParsedRow[];
  rejected: BulkImportRowError[];
}

function parseExcelBuffer(buffer: Buffer): Promise<ParseResult> {
  return readWorkbook(buffer);
}

async function readWorkbook(buffer: Buffer): Promise<ParseResult> {
  const workbook = new ExcelJS.Workbook();

  // Try xlsx first, fall back to csv
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    // If xlsx fails, try csv
    const text = buffer.toString("utf-8");
    const stream = new (await import("node:stream")).Readable();
    stream.push(text);
    stream.push(null);
    await workbook.csv.read(stream);
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("The workbook has no sheets");

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col - 1] = String(cell.value ?? "").trim();
  });

  const rows: ParsedRow[] = [];
  const rejected: BulkImportRowError[] = [];

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;

    const values: unknown[] = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      values[col - 1] = cell.value;
    });

    const result = parseRow(headers, values, rowNumber);
    if (result.ok) rows.push(result.row);
    else rejected.push({ row: result.rowNumber, reason: result.reason });
  });

  return { rows, rejected };
}

function cellToString(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "object" && "text" in raw) return String(raw.text).trim();
  return String(raw).trim();
}

function parseRow(
  headers: string[],
  values: unknown[],
  rowNumber: number,
): { ok: true; row: ParsedRow } | { ok: false; rowNumber: number; reason: string } {
  const cells = headers.map((header, i) => ({
    key: normalizeHeader(header),
    original: header.trim(),
    raw: values[i],
  }));
  const byKey = new Map(cells.filter((c) => c.key).map((c) => [c.key, c]));

  const get = (key: string): string => cellToString(byKey.get(key)?.raw);

  const name = get("name");
  if (!name) return { ok: false, rowNumber, reason: "Missing name" };

  const unitName = get("unit");
  if (!unitName) return { ok: false, rowNumber, reason: `${name}: missing unit` };

  const sellingPriceRaw = get("sellingprice");
  const sellingPrice = Number(sellingPriceRaw);
  if (!sellingPriceRaw || !Number.isFinite(sellingPrice) || sellingPrice <= 0) {
    return { ok: false, rowNumber, reason: `${name}: selling price must be a positive number` };
  }

  const purchasePriceRaw = get("purchaseprice");
  const purchasePrice = purchasePriceRaw ? Number(purchasePriceRaw) : 0;
  if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
    return { ok: false, rowNumber, reason: `${name}: purchase price must be >= 0` };
  }

  let wholesalePrice: number | null = null;
  const wholesalePriceRaw = get("wholesaleprice");
  if (wholesalePriceRaw) {
    wholesalePrice = Number(wholesalePriceRaw);
    if (!Number.isFinite(wholesalePrice) || wholesalePrice < 0) {
      return { ok: false, rowNumber, reason: `${name}: wholesale price must be >= 0` };
    }
  }

  const minStockRaw = get("minstock");
  const minStock = minStockRaw ? Number(minStockRaw) : 0;
  if (!Number.isFinite(minStock) || minStock < 0) {
    return { ok: false, rowNumber, reason: `${name}: min stock must be >= 0` };
  }

  const currentStockRaw = get("currentstock");
  const currentStock = currentStockRaw ? Number(currentStockRaw) : 0;
  if (!Number.isFinite(currentStock) || currentStock < 0) {
    return { ok: false, rowNumber, reason: `${name}: current stock must be >= 0` };
  }

  const sku = get("sku") || null;
  const barcodeRaw = get("barcode");
  const barcode = barcodeRaw ? normalizeBarcode(barcodeRaw) : null;

  return {
    ok: true,
    row: {
      rowNumber,
      name,
      sku,
      categoryName: get("category") || null,
      unitName,
      brandName: get("brand") || null,
      barcode,
      purchasePrice,
      sellingPrice,
      wholesalePrice,
      minStock,
      currentStock,
      description: get("description") || null,
    },
  };
}

/** Every SKU that appears more than once, with the row numbers. */
function findDuplicateSkus(rows: ParsedRow[]): Map<string, number[]> {
  const bySku = new Map<string, number[]>();
  for (const row of rows) {
    if (!row.sku) continue;
    const existing = bySku.get(row.sku);
    if (existing) existing.push(row.rowNumber);
    else bySku.set(row.sku, [row.rowNumber]);
  }

  const duplicates = new Map<string, number[]>();
  for (const [sku, rowNumbers] of bySku) {
    if (rowNumbers.length > 1) duplicates.set(sku, rowNumbers);
  }
  return duplicates;
}

// ── Lookups ─────────────────────────────────────────────────────────────────

interface Lookups {
  categoriesByName: Map<string, string>;
  unitsByName: Map<string, string>;
  unitsByAbbr: Map<string, string>;
  brandsByName: Map<string, string>;
  defaultPriceListId: string;
}

async function loadLookups(tx: Transaction): Promise<Lookups> {
  const [categories, units, brands, defaultList] = await Promise.all([
    tx.select({ id: schema.categories.id, name: schema.categories.name }).from(schema.categories),
    tx.select({ id: schema.units.id, name: schema.units.name, abbreviation: schema.units.abbreviation }).from(schema.units),
    tx.select({ id: schema.brands.id, name: schema.brands.name }).from(schema.brands),
    tx.query.priceLists.findFirst({
      where: (t, { and: a, eq: e }) => a(e(t.isDefault, true), e(t.isActive, true)),
      columns: { id: true },
    }),
  ]);

  if (!defaultList) {
    throw new Error("No default price list exists. Create one before importing.");
  }

  return {
    categoriesByName: new Map(categories.map((c) => [c.name.trim().toLowerCase(), c.id])),
    unitsByName: new Map(units.map((u) => [u.name.trim().toLowerCase(), u.id])),
    unitsByAbbr: new Map(units.map((u) => [u.abbreviation.trim().toLowerCase(), u.id])),
    brandsByName: new Map(brands.map((b) => [b.name.trim().toLowerCase(), b.id])),
    defaultPriceListId: defaultList.id,
  };
}

// ── Service ─────────────────────────────────────────────────────────────────

const CHUNK_SIZE = 500;

@Injectable()
export class BulkImportService {
  private readonly logger = new Logger(BulkImportService.name);

  constructor(
    private readonly db: TenantDatabase,
    private readonly stock: StockService,
  ) {}

  async import(buffer: Buffer, options: BulkImportOptionsDto): Promise<BulkImportResult> {
    const { rows, rejected } = await parseExcelBuffer(buffer);

    const errors: BulkImportRowError[] = [...rejected];

    // Flag duplicate SKUs
    const duplicates = findDuplicateSkus(rows);
    const duplicateSkus = new Set(duplicates.keys());
    const importable = rows.filter((r) => !r.sku || !duplicateSkus.has(r.sku));
    for (const [sku, rowNumbers] of duplicates) {
      errors.push({
        row: rowNumbers[0]!,
        reason: `SKU "${sku}" appears on rows ${rowNumbers.join(", ")} — fix the file`,
      });
    }

    const tally = { created: 0, updated: 0, unchanged: 0, rejected: errors.length };
    const autoCreated = { categories: [] as string[], brands: [] as string[] };
    const batchId = randomUUID();

    for (let i = 0; i < importable.length; i += CHUNK_SIZE) {
      const chunk = importable.slice(i, i + CHUNK_SIZE);

      await this.db.run(async (tx) => {
        const lookups = await loadLookups(tx);
        const tenantId = RequestContext.requireTenantId();

        // ── Auto-create missing categories & brands ──────────────────
        for (const row of chunk) {
          if (row.categoryName) {
            const key = row.categoryName.trim().toLowerCase();
            if (!lookups.categoriesByName.has(key)) {
              if (!options.dryRun) {
                const slug = slugify(row.categoryName);
                const [created] = await tx
                  .insert(schema.categories)
                  .values({ tenantId, name: row.categoryName.trim(), slug, path: slug, depth: 0 })
                  .returning({ id: schema.categories.id });
                if (created) lookups.categoriesByName.set(key, created.id);
              } else {
                // In dry-run, use a placeholder so later rows with the same
                // category don't register as "needs creation" twice.
                lookups.categoriesByName.set(key, "dry-run-placeholder");
              }
              if (!autoCreated.categories.includes(row.categoryName.trim())) {
                autoCreated.categories.push(row.categoryName.trim());
              }
            }
          }

          if (row.brandName) {
            const key = row.brandName.trim().toLowerCase();
            if (!lookups.brandsByName.has(key)) {
              if (!options.dryRun) {
                const slug = slugify(row.brandName);
                const [created] = await tx
                  .insert(schema.brands)
                  .values({ tenantId, name: row.brandName.trim(), slug })
                  .returning({ id: schema.brands.id });
                if (created) lookups.brandsByName.set(key, created.id);
              } else {
                lookups.brandsByName.set(key, "dry-run-placeholder");
              }
              if (!autoCreated.brands.includes(row.brandName.trim())) {
                autoCreated.brands.push(row.brandName.trim());
              }
            }
          }
        }

        // ── Process each row ─────────────────────────────────────────
        for (const row of chunk) {
          // Resolve unit — try both name and abbreviation
          const unitKey = row.unitName.trim().toLowerCase();
          const unitId = lookups.unitsByName.get(unitKey) ?? lookups.unitsByAbbr.get(unitKey);
          if (!unitId) {
            tally.rejected += 1;
            errors.push({ row: row.rowNumber, reason: `Unknown unit "${row.unitName}"` });
            continue;
          }

          const categoryId = row.categoryName
            ? lookups.categoriesByName.get(row.categoryName.trim().toLowerCase()) ?? null
            : null;
          const brandId = row.brandName
            ? lookups.brandsByName.get(row.brandName.trim().toLowerCase()) ?? null
            : null;

          // ── Check if product exists by SKU ──────────────────────────
          let existingVariant: { id: string; barcode: string | null } | undefined;
          if (row.sku) {
            existingVariant = await tx.query.productVariants.findFirst({
              where: (t, { and: a, eq: e, isNull: n }) => a(e(t.sku, row.sku!), n(t.deletedAt)),
              columns: { id: true, barcode: true },
            }) ?? undefined;
          }

          if (existingVariant) {
            // ── UPDATE path ──────────────────────────────────────────
            const currentPrice = await tx.query.productPrices.findFirst({
              where: (t, { and: a, eq: e, isNull: n }) =>
                a(e(t.variantId, existingVariant!.id), e(t.priceListId, lookups.defaultPriceListId), n(t.effectiveTo)),
              columns: { id: true, sellingPrice: true, purchasePrice: true, effectiveFrom: true },
            });

            const priceChanged = !currentPrice
              || Money.toMinor(currentPrice.sellingPrice) !== Money.toMinor(String(row.sellingPrice))
              || Money.toMinor(currentPrice.purchasePrice ?? "0") !== Money.toMinor(String(row.purchasePrice));
            const barcodeChanged = (existingVariant.barcode ?? null) !== (row.barcode ?? null);

            if (!priceChanged && !barcodeChanged) {
              tally.unchanged += 1;
              continue;
            }

            tally.updated += 1;

            if (!options.dryRun) {
              if (barcodeChanged) {
                await tx
                  .update(schema.productVariants)
                  .set({ barcode: row.barcode })
                  .where(eq(schema.productVariants.id, existingVariant.id));
              }

              if (priceChanged) {
                const today = new Date().toISOString().slice(0, 10);

                await tx.insert(schema.priceHistory).values({
                  tenantId,
                  variantId: existingVariant.id,
                  priceListId: lookups.defaultPriceListId,
                  oldSellingPrice: currentPrice?.sellingPrice ?? null,
                  newSellingPrice: String(row.sellingPrice),
                  oldPurchasePrice: currentPrice?.purchasePrice ?? null,
                  newPurchasePrice: String(row.purchasePrice),
                  ...(row.wholesalePrice !== null ? { newMinSellingPrice: String(row.wholesalePrice) } : {}),
                  importBatchId: batchId,
                });

                if (currentPrice && currentPrice.effectiveFrom === today) {
                  await tx
                    .update(schema.productPrices)
                    .set({
                      sellingPrice: String(row.sellingPrice),
                      purchasePrice: String(row.purchasePrice),
                      ...(row.wholesalePrice !== null ? { minSellingPrice: String(row.wholesalePrice) } : {}),
                    })
                    .where(eq(schema.productPrices.id, currentPrice.id));
                } else {
                  if (currentPrice) {
                    await tx
                      .update(schema.productPrices)
                      .set({ effectiveTo: sql`(${today}::date - interval '1 day')::date` })
                      .where(eq(schema.productPrices.id, currentPrice.id));
                  }
                  await tx.insert(schema.productPrices).values({
                    tenantId,
                    variantId: existingVariant.id,
                    priceListId: lookups.defaultPriceListId,
                    sellingPrice: String(row.sellingPrice),
                    purchasePrice: String(row.purchasePrice),
                    ...(row.wholesalePrice !== null ? { minSellingPrice: String(row.wholesalePrice) } : {}),
                    effectiveFrom: today,
                  });
                }
              }
            }
          } else {
            // ── CREATE path ──────────────────────────────────────────
            tally.created += 1;

            if (!options.dryRun) {
              // Auto-generate SKU if not provided
              let sku = row.sku;
              if (!sku) {
                const category = categoryId && categoryId !== "dry-run-placeholder"
                  ? await tx.query.categories.findFirst({
                      where: (t, { eq: e }) => e(t.id, categoryId),
                      columns: { skuPrefix: true },
                    })
                  : null;

                const prefix = category?.skuPrefix ?? "SKU";
                const [seqRow] = await tx.execute<{ next_document_number: number }>(
                  sql`SELECT next_document_number(${tenantId}::uuid, ${`sku:${prefix}`})`,
                );
                const sequence = Number(
                  (seqRow as { next_document_number?: number })?.next_document_number ?? 1,
                );
                sku = `${prefix}-${String(sequence).padStart(6, "0")}`;
              }

              const [product] = await tx
                .insert(schema.products)
                .values({
                  tenantId,
                  sku,
                  name: row.name,
                  description: row.description,
                  categoryId: categoryId && categoryId !== "dry-run-placeholder" ? categoryId : null,
                  brandId: brandId && brandId !== "dry-run-placeholder" ? brandId : null,
                  unitId,
                })
                .returning({ id: schema.products.id });
              if (!product) {
                tally.created -= 1;
                tally.rejected += 1;
                errors.push({ row: row.rowNumber, reason: `Could not create product "${row.name}"` });
                continue;
              }

              const [variant] = await tx
                .insert(schema.productVariants)
                .values({
                  tenantId,
                  productId: product.id,
                  sku,
                  barcode: row.barcode,
                  searchKey: searchKey(row.name, sku),
                  minStock: String(row.minStock),
                })
                .returning({ id: schema.productVariants.id });
              if (!variant) continue;

              await tx.insert(schema.productPrices).values({
                tenantId,
                variantId: variant.id,
                priceListId: lookups.defaultPriceListId,
                sellingPrice: String(row.sellingPrice),
                purchasePrice: String(row.purchasePrice),
                ...(row.wholesalePrice !== null ? { minSellingPrice: String(row.wholesalePrice) } : {}),
              });

              await tx.insert(schema.priceHistory).values({
                tenantId,
                variantId: variant.id,
                priceListId: lookups.defaultPriceListId,
                newSellingPrice: String(row.sellingPrice),
                newPurchasePrice: String(row.purchasePrice),
                ...(row.wholesalePrice !== null ? { newMinSellingPrice: String(row.wholesalePrice) } : {}),
                importBatchId: batchId,
              });

              // Opening stock
              if (row.currentStock > 0 && options.branchId) {
                await this.stock.addStock({
                  tx,
                  variantId: variant.id,
                  branchId: options.branchId,
                  quantity: String(row.currentStock),
                  referenceType: "opening_stock",
                  referenceId: product.id,
                  notes: "Opening stock from bulk import",
                  unitCost: String(row.purchasePrice),
                });
              }
            }
          }
        }
      });
    }

    this.logger.log(
      `Bulk import ${options.dryRun ? "(dry run)" : "COMMITTED"}: ` +
        `${tally.created} created, ${tally.updated} updated, ` +
        `${tally.unchanged} unchanged, ${tally.rejected} rejected`,
    );

    return {
      ...tally,
      autoCreated,
      errors,
      dryRun: options.dryRun,
    };
  }

  /**
   * Generate a template workbook with correct headers and a "Valid Values"
   * reference sheet populated from the tenant's actual lookups.
   */
  async generateTemplate(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();

    // Products sheet
    const productsSheet = workbook.addWorksheet("Products");
    productsSheet.columns = [
      { header: "Name*", key: "name", width: 30 },
      { header: "SKU", key: "sku", width: 15 },
      { header: "Category*", key: "category", width: 20 },
      { header: "Unit*", key: "unit", width: 12 },
      { header: "Brand", key: "brand", width: 18 },
      { header: "Barcode", key: "barcode", width: 18 },
      { header: "Purchase Price", key: "purchasePrice", width: 15 },
      { header: "Selling Price*", key: "sellingPrice", width: 15 },
      { header: "Wholesale Price", key: "wholesalePrice", width: 15 },
      { header: "Min Stock", key: "minStock", width: 12 },
      { header: "Current Stock", key: "currentStock", width: 14 },
      { header: "Description", key: "description", width: 30 },
    ];

    // Style header row
    const headerRow = productsSheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF4472C4" },
    };
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };

    // Valid Values sheet — populated from tenant's data
    const validSheet = workbook.addWorksheet("Valid Values");
    validSheet.columns = [
      { header: "Valid Categories", key: "categories", width: 20 },
      { header: "Valid Brands", key: "brands", width: 20 },
      { header: "Valid Units", key: "units", width: 20 },
    ];

    const validHeaderRow = validSheet.getRow(1);
    validHeaderRow.font = { bold: true };

    await this.db.run(async (tx) => {
      const [categories, brands, units] = await Promise.all([
        tx.select({ name: schema.categories.name }).from(schema.categories),
        tx.select({ name: schema.brands.name }).from(schema.brands),
        tx
          .select({ name: schema.units.name, abbreviation: schema.units.abbreviation })
          .from(schema.units),
      ]);

      const maxRows = Math.max(categories.length, brands.length, units.length);
      for (let i = 0; i < maxRows; i++) {
        const row = validSheet.getRow(i + 2);
        if (categories[i]) row.getCell(1).value = categories[i]!.name;
        if (brands[i]) row.getCell(2).value = brands[i]!.name;
        if (units[i]) row.getCell(3).value = `${units[i]!.name} (${units[i]!.abbreviation})`;
      }
    });

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }
}
