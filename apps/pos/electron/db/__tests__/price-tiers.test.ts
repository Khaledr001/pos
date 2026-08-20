import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../sqlite.js";

/**
 * Quantity-break pricing (Stage 5.2): a variant now carries several
 * variant_prices rows on the same default list, one per minQuantity
 * threshold. This exercises the real SQL — the json_group_array aggregation
 * and the tier-1-first ordering — against real better-sqlite3, not a mock.
 */
let db: Database.Database;

vi.mock("../sqlite.js", async () => {
  const actual = await vi.importActual<typeof import("../sqlite.js")>("../sqlite.js");
  return { ...actual, getDatabase: () => db };
});

const { searchProducts, findByBarcode } = await import("../repositories.js");

function seedVariant(): void {
  db.prepare(
    `INSERT INTO variants (id, product_id, sku, barcode, product_name, variant_name, search_key, unit_abbr, category_name, tax_rate, updated_at)
     VALUES ('v1', 'p1', 'SKU-1', '6291000000017', 'PVC Elbow', 'Default', 'pvc elbow sku-1', 'pcs', 'Plumbing', '5', datetime('now'))`,
  ).run();
}

function seedTier(minQuantity: string, sellingPrice: string, minSellingPrice: string | null = null): void {
  db.prepare(
    `INSERT INTO variant_prices (id, variant_id, price_list_id, selling_price, min_selling_price, min_quantity, is_default, updated_at)
     VALUES (?, 'v1', 'default', ?, ?, ?, 1, datetime('now'))`,
  ).run(`price-${minQuantity}`, sellingPrice, minSellingPrice, minQuantity);
}

describe("quantity-break price tiers", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    migrate(db);
  });

  it("shows the tier-1 price as the base sellingPrice, with a single-entry priceTiers array", () => {
    seedVariant();
    seedTier("1", "10.00", "8.00");

    const found = findByBarcode("6291000000017");
    expect(found?.sellingPrice).toBe("10.00");
    expect(found?.minSellingPrice).toBe("8.00");
    expect(found?.priceTiers).toEqual([{ minQuantity: "1", sellingPrice: "10.00" }]);
  });

  it("still shows the tier-1 price as the base, but lists every tier in priceTiers", () => {
    seedVariant();
    seedTier("1", "10.00", "8.00");
    seedTier("10", "8.50", null);

    const found = findByBarcode("6291000000017");
    // The base display price is always the lowest-threshold tier, regardless
    // of insertion order or a higher tier's own updated_at.
    expect(found?.sellingPrice).toBe("10.00");
    expect(found?.priceTiers).toEqual([
      { minQuantity: "1", sellingPrice: "10.00" },
      { minQuantity: "10", sellingPrice: "8.50" },
    ]);
  });

  it("carries priceTiers through search results too, not just barcode lookup", () => {
    seedVariant();
    seedTier("1", "10.00");
    seedTier("10", "8.50");

    const [result] = searchProducts("elbow");
    expect(result?.priceTiers).toHaveLength(2);
  });

  it("a variant with no price at all gets an empty priceTiers array, not a crash", () => {
    seedVariant();

    const found = findByBarcode("6291000000017");
    expect(found?.priceTiers).toEqual([]);
    expect(found?.sellingPrice).toBe("0");
  });
});
