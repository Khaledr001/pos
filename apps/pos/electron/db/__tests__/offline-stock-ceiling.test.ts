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

function draft(variantId: string, quantity: string) {
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
        total: "10.00",
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
});
