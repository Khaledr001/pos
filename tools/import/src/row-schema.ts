import { normalizeBarcode } from "@devsfleet/shared-utils";

/**
 * The canonical column headers this importer understands, matched
 * case-insensitively with punctuation/spacing stripped — "Selling Price",
 * "selling_price" and "SELLINGPRICE" all resolve to the same field. Until a
 * real supplier price list has been profiled (`profile.ts`) and its columns
 * renamed to match these, there is nothing more specific to map against —
 * see this package's README and the header comment on import-products.ts.
 *
 * One row = one product with exactly one variant ("Default"). A flat
 * distributor price list is virtually never grouped by product family, and
 * assuming otherwise would need row-grouping logic the source data doesn't
 * actually encode.
 */
export const KNOWN_HEADERS = new Set([
  "sku",
  "name",
  "category",
  "brand",
  "unit",
  "barcode",
  "sellingprice",
  "purchaseprice",
  "minsellingprice",
  "taxrate",
]);

export interface ParsedProductRow {
  rowNumber: number;
  sku: string;
  name: string;
  /** Matched by name against this tenant's existing categories. Null = uncategorised. */
  categoryName: string | null;
  /** Matched by name against this tenant's existing brands. Null = unbranded. */
  brandName: string | null;
  /** Matched by abbreviation against this tenant's existing units. */
  unitAbbr: string;
  barcode: string | null;
  sellingPrice: number;
  purchasePrice: number;
  minSellingPrice: number | null;
  taxRate: number | null;
  /**
   * Every column this importer does not recognise, keyed by its ORIGINAL
   * header text (not normalized) so it stays readable in the JSONB bag —
   * "Thread Size" stays "Thread Size", not "threadsize".
   */
  attributes: Record<string, string>;
}

export type RowResult =
  | { ok: true; row: ParsedProductRow }
  | { ok: false; rowNumber: number; reason: string };

/** Lowercase, punctuation and whitespace stripped. The matching key, never shown to a human. */
export function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

interface Cell {
  key: string;
  original: string;
  raw: unknown;
}

/**
 * Validate and normalise one spreadsheet row. Pure — no database, no I/O —
 * so a malformed row is a data problem reported back to whoever produced the
 * file, not a crash partway through a 5,000-row import.
 */
export function parseRow(headers: string[], values: unknown[], rowNumber: number): RowResult {
  const cells: Cell[] = headers.map((header, i) => ({
    key: normalizeHeader(header),
    original: header.trim(),
    raw: values[i],
  }));
  const byKey = new Map(cells.filter((c) => c.key).map((c) => [c.key, c]));

  const get = (key: string): string => {
    const raw = byKey.get(key)?.raw;
    if (raw === null || raw === undefined) return "";
    // ExcelJS hands back a rich-text object for some cells rather than a plain string.
    if (typeof raw === "object" && "text" in raw) return String(raw.text).trim();
    return String(raw).trim();
  };

  const sku = get("sku");
  if (!sku) return { ok: false, rowNumber, reason: "Missing sku" };

  const name = get("name");
  if (!name) return { ok: false, rowNumber, reason: `${sku}: missing name` };

  const unitAbbr = get("unit");
  if (!unitAbbr) return { ok: false, rowNumber, reason: `${sku}: missing unit` };

  const sellingPriceRaw = get("sellingprice");
  const sellingPrice = Number(sellingPriceRaw);
  if (!sellingPriceRaw || !Number.isFinite(sellingPrice) || sellingPrice <= 0) {
    return { ok: false, rowNumber, reason: `${sku}: sellingPrice must be a positive number` };
  }

  const purchasePriceRaw = get("purchaseprice");
  const purchasePrice = purchasePriceRaw ? Number(purchasePriceRaw) : 0;
  if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
    return { ok: false, rowNumber, reason: `${sku}: purchasePrice must be a non-negative number` };
  }

  let minSellingPrice: number | null = null;
  const minSellingPriceRaw = get("minsellingprice");
  if (minSellingPriceRaw) {
    minSellingPrice = Number(minSellingPriceRaw);
    if (!Number.isFinite(minSellingPrice) || minSellingPrice < 0) {
      return { ok: false, rowNumber, reason: `${sku}: minSellingPrice must be a non-negative number` };
    }
  }

  let taxRate: number | null = null;
  const taxRateRaw = get("taxrate");
  if (taxRateRaw) {
    taxRate = Number(taxRateRaw);
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
      return { ok: false, rowNumber, reason: `${sku}: taxRate must be between 0 and 100` };
    }
  }

  const barcodeRaw = get("barcode");
  const barcode = barcodeRaw ? normalizeBarcode(barcodeRaw) : null;

  const attributes: Record<string, string> = {};
  for (const cell of cells) {
    if (!cell.key || KNOWN_HEADERS.has(cell.key)) continue;
    if (cell.raw === null || cell.raw === undefined || cell.raw === "") continue;
    const value =
      typeof cell.raw === "object" && "text" in cell.raw ? String(cell.raw.text) : String(cell.raw);
    const trimmed = value.trim();
    if (trimmed) attributes[cell.original] = trimmed;
  }

  return {
    ok: true,
    row: {
      rowNumber,
      sku,
      name,
      categoryName: get("category") || null,
      brandName: get("brand") || null,
      unitAbbr,
      barcode,
      sellingPrice,
      purchasePrice,
      minSellingPrice,
      taxRate,
      attributes,
    },
  };
}

/** Every SKU that appears more than once, with the row numbers it appeared on. Requirement 5. */
export function findDuplicateSkus(rows: ParsedProductRow[]): Map<string, number[]> {
  const bySku = new Map<string, number[]>();
  for (const row of rows) {
    const rowNumbers = bySku.get(row.sku);
    if (rowNumbers) rowNumbers.push(row.rowNumber);
    else bySku.set(row.sku, [row.rowNumber]);
  }

  const duplicates = new Map<string, number[]>();
  for (const [sku, rowNumbers] of bySku) {
    if (rowNumbers.length > 1) duplicates.set(sku, rowNumbers);
  }
  return duplicates;
}
