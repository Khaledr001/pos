import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../sqlite.js";

/**
 * Same singleton-mocking approach as outbox-attention.test.ts, for the same
 * reason: `commitSale` and `setState`/`getState` all reach the database
 * through the module-level `getDatabase()`, not a parameter.
 */
let db: Database.Database;

vi.mock("../sqlite.js", async () => {
  const actual = await vi.importActual<typeof import("../sqlite.js")>("../sqlite.js");
  return { ...actual, getDatabase: () => db };
});

const { commitSale, setState } = await import("../repositories.js");

function seedInventory(variantId: string, quantity: number, localDelta = 0): void {
  db.prepare(
    `INSERT INTO inventory (id, variant_id, quantity, reserved_qty, local_delta, updated_at)
     VALUES (?, ?, ?, '0', ?, datetime('now'))`,
  ).run(`inv-${variantId}`, variantId, String(quantity), String(localDelta));
}

function draft(variantId: string, quantity: string, unitConversionFactor?: string) {
  return {
    localId: `sale-${Math.random()}`,
    customerId: null,
    cashSessionId: null,
    lines: [
      {
        variantId,
        productName: "Test Product",
        productSku: "SKU-1",
        quantity,
        unitPrice: "10.00",
        discountPercent: "0",
        taxPercent: "5",
        lineSubtotal: "10.00",
        taxAmount: "0.50",
        total: "10.50",
        ...(unitConversionFactor ? { unitId: "unit-box", unitConversionFactor } : {}),
      },
    ],
    subtotal: "10.00",
    taxAmount: "0.50",
    discountAmount: "0",
    total: "10.50",
    payments: [{ method: "cash", amount: "10.50" }],
    occurredAt: new Date(0).toISOString(),
  };
}

describe("offline stock ceiling", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    migrate(db);
  });

  it("allows a sale within available stock", () => {
    seedInventory("v1", 10);
    expect(() => commitSale(draft("v1", "3"))).not.toThrow();
  });

  it("refuses a sale past available stock", () => {
    seedInventory("v1", 2);
    expect(() => commitSale(draft("v1", "3"))).toThrow(/only 2 left/i);
  });

  it("accounts for stock this terminal has already sold offline", () => {
    // 10 synced, 7 already sold locally (local_delta = -7) — 3 genuinely left.
    seedInventory("v1", 10, -7);
    expect(() => commitSale(draft("v1", "3"))).not.toThrow();
    expect(() => commitSale(draft("v1", "1"))).toThrow(/only 0 left/i);
  });

  it("treats a variant with no synced inventory row as zero, not unlimited", () => {
    expect(() => commitSale(draft("never-synced", "1"))).toThrow(/only 0 left/i);
  });

  it("does not write anything when the check fails", () => {
    seedInventory("v1", 1);
    const attempt = draft("v1", "5");
    expect(() => commitSale(attempt)).toThrow();

    const sale = db.prepare(`SELECT 1 FROM local_sales WHERE local_id = ?`).get(attempt.localId);
    expect(sale).toBeUndefined();
    const row = db.prepare(`SELECT local_delta FROM inventory WHERE variant_id = 'v1'`).get() as {
      local_delta: string;
    };
    expect(row.local_delta).toBe("0");
  });

  it("is skipped entirely when the tenant allows negative stock", () => {
    seedInventory("v1", 1);
    setState("allow_negative_stock", "1");
    expect(() => commitSale(draft("v1", "50"))).not.toThrow();
  });

  it("checks the ceiling in BASE units when a line is sold by a packaging", () => {
    // 1 box = 20 pieces. 30 on the shelf -> 1 box fits, a 2nd does not.
    seedInventory("v1", 30);
    expect(() => commitSale(draft("v1", "1", "20"))).not.toThrow();
    expect(() => commitSale(draft("v1", "1", "20"))).toThrow(/only 10 left/i);
  });

  it("decrements local_delta in base units for a packaged sale", () => {
    seedInventory("v1", 30);
    commitSale(draft("v1", "1", "20"));
    const row = db.prepare(`SELECT local_delta FROM inventory WHERE variant_id = 'v1'`).get() as {
      local_delta: string;
    };
    expect(row.local_delta).toBe("-20.0");
  });

  it("stores quantity in the SOLD unit, with unit_id/unit_conversion_factor snapshotted", () => {
    seedInventory("v1", 30);
    const attempt = draft("v1", "1", "20");
    commitSale(attempt);
    const item = db
      .prepare(`SELECT quantity, unit_id AS unitId, unit_conversion_factor AS factor FROM local_sale_items WHERE sale_local_id = ?`)
      .get(attempt.localId) as { quantity: string; unitId: string; factor: string };
    expect(item).toMatchObject({ quantity: "1", unitId: "unit-box", factor: "20" });
  });

  it("defaults unit_conversion_factor to 1 for an ordinary, unpackaged sale", () => {
    seedInventory("v1", 30);
    const attempt = draft("v1", "3");
    commitSale(attempt);
    const item = db
      .prepare(`SELECT unit_id AS unitId, unit_conversion_factor AS factor FROM local_sale_items WHERE sale_local_id = ?`)
      .get(attempt.localId) as { unitId: string | null; factor: string };
    expect(item).toEqual({ unitId: null, factor: "1" });
  });
});
