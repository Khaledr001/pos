import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../sqlite.js";

/**
 * Same singleton-mocking approach as outbox-attention.test.ts and
 * offline-stock-ceiling.test.ts, for the same reason: `repositories.ts`
 * reaches the database through the module-level `getDatabase()` singleton.
 */
let db: Database.Database;

vi.mock("../sqlite.js", async () => {
  const actual = await vi.importActual<typeof import("../sqlite.js")>("../sqlite.js");
  return { ...actual, getDatabase: () => db };
});

const { commitSale, commitReturn, settleOutboxItem, clearSettledDeltas } = await import(
  "../repositories.js"
);

function seedInventory(variantId: string, quantity: number, localDelta = 0): void {
  db.prepare(
    `INSERT INTO inventory (id, variant_id, quantity, reserved_qty, local_delta, updated_at)
     VALUES (?, ?, ?, '0', ?, datetime('now'))`,
  ).run(`inv-${variantId}`, variantId, String(quantity), String(localDelta));
}

function saleDraft() {
  return {
    localId: "sale-1",
    customerId: "cust-1",
    cashSessionId: null,
    lines: [
      {
        variantId: "v1",
        productName: "Test Product",
        productSku: "SKU-1",
        quantity: "4",
        unitPrice: "10.00",
        discountPercent: "0",
        taxPercent: "5",
        total: "40.00",
      },
    ],
    subtotal: "40.00",
    taxAmount: "2.00",
    discountAmount: "0",
    total: "42.00",
    payments: [{ method: "cash", amount: "42.00" }],
    occurredAt: new Date(0).toISOString(),
  };
}

function returnDraft(overrides: Partial<ReturnType<typeof baseReturnDraft>> = {}) {
  return { ...baseReturnDraft(), ...overrides };
}

interface TestReturnLine {
  originalLineIndex: number;
  variantId: string;
  productName: string;
  productSku: string;
  quantity: string;
  unitPrice: string;
  disposition: "restock" | "scrap";
}

function baseReturnDraft() {
  return {
    localId: "return-1",
    originalSaleLocalId: "sale-1",
    customerId: "cust-1",
    cashSessionId: null,
    lines: [
      {
        originalLineIndex: 0,
        variantId: "v1",
        productName: "Test Product",
        productSku: "SKU-1",
        quantity: "2",
        unitPrice: "10.00",
        disposition: "restock",
      },
    ] as TestReturnLine[],
    subtotal: "20.00",
    taxAmount: "1.00",
    discountAmount: "0",
    total: "21.00",
    refunds: [{ method: "cash", amount: "21.00" }],
    reason: "Customer changed mind",
    occurredAt: new Date(1000).toISOString(),
  };
}

describe("offline returns", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    migrate(db);
    seedInventory("v1", 10);
    commitSale(saleDraft());
  });

  it("writes local_returns and local_return_items, and enqueues a return outbox item", () => {
    commitReturn(returnDraft());

    const row = db
      .prepare(`SELECT * FROM local_returns WHERE local_id = 'return-1'`)
      .get() as Record<string, unknown>;
    expect(row.original_sale_local_id).toBe("sale-1");
    expect(row.total).toBe("21.00");
    expect(row.synced_at).toBeNull();

    const items = db
      .prepare(`SELECT * FROM local_return_items WHERE return_local_id = 'return-1'`)
      .all() as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ original_line_index: 0, variant_id: "v1", disposition: "restock" });

    const outbox = db
      .prepare(`SELECT entity, payload FROM outbox WHERE local_id = 'return-1'`)
      .get() as { entity: string; payload: string };
    expect(outbox.entity).toBe("return");
    const payload = JSON.parse(outbox.payload);
    expect(payload.originalSaleId).toBe("sale-1");
    expect(payload.lines).toEqual([
      { lineIndex: 0, variantId: "v1", quantity: 2, disposition: "restock" },
    ]);
    expect(payload.refunds).toEqual([{ method: "cash", amount: 21 }]);
  });

  it("credits local_delta back for a restocked line, so the unit is sellable again offline", () => {
    // Sale of 4 dropped local_delta to -4; a restock of 2 should bring it to -2.
    commitReturn(returnDraft());
    const row = db.prepare(`SELECT local_delta FROM inventory WHERE variant_id = 'v1'`).get() as {
      local_delta: string;
    };
    expect(row.local_delta).toBe("-2.0");
  });

  it("does not move stock for a scrapped line", () => {
    commitReturn(
      returnDraft({
        lines: [
          {
            originalLineIndex: 0,
            variantId: "v1",
            productName: "Test Product",
            productSku: "SKU-1",
            quantity: "1",
            unitPrice: "10.00",
            disposition: "scrap",
          },
        ],
      }),
    );
    const row = db.prepare(`SELECT local_delta FROM inventory WHERE variant_id = 'v1'`).get() as {
      local_delta: string;
    };
    // Sale of 4 dropped local_delta to -4; scrap does not move it at all.
    expect(row.local_delta).toBe("-4.0");
  });

  it("settling a return stamps local_returns, not local_sales", () => {
    commitReturn(returnDraft());
    settleOutboxItem({
      localId: "return-1",
      outcome: "applied",
      entity: "return",
      serverId: "srv-return-1",
      documentNumber: "INV-2026-000099",
    });

    const row = db
      .prepare(`SELECT server_id, return_number, synced_at FROM local_returns WHERE local_id = 'return-1'`)
      .get() as { server_id: string; return_number: string; synced_at: string | null };
    expect(row.server_id).toBe("srv-return-1");
    expect(row.return_number).toBe("INV-2026-000099");
    expect(row.synced_at).not.toBeNull();

    // The original sale's own row must be untouched by a RETURN's settlement.
    const sale = db
      .prepare(`SELECT server_id FROM local_sales WHERE local_id = 'sale-1'`)
      .get() as { server_id: string | null };
    expect(sale.server_id).toBeNull();
  });

  it("clearSettledDeltas releases a restocked delta once the return has synced", () => {
    commitReturn(returnDraft());
    expect(
      (db.prepare(`SELECT local_delta FROM inventory WHERE variant_id = 'v1'`).get() as { local_delta: string })
        .local_delta,
    ).toBe("-2.0");

    // Not yet synced — clearing must leave the offline adjustment in place.
    clearSettledDeltas();
    expect(
      (db.prepare(`SELECT local_delta FROM inventory WHERE variant_id = 'v1'`).get() as { local_delta: string })
        .local_delta,
    ).toBe("-2.0");

    settleOutboxItem({ localId: "return-1", outcome: "applied", entity: "return", serverId: "srv-1" });
    clearSettledDeltas();
    expect(
      (db.prepare(`SELECT local_delta FROM inventory WHERE variant_id = 'v1'`).get() as { local_delta: string })
        .local_delta,
    ).toBe("0");
  });

  it("a return can split one original line into a restocked row and a scrapped row", () => {
    commitReturn(
      returnDraft({
        localId: "return-2",
        lines: [
          {
            originalLineIndex: 0,
            variantId: "v1",
            productName: "Test Product",
            productSku: "SKU-1",
            quantity: "1",
            unitPrice: "10.00",
            disposition: "restock",
          },
          {
            originalLineIndex: 0,
            variantId: "v1",
            productName: "Test Product",
            productSku: "SKU-1",
            quantity: "1",
            unitPrice: "10.00",
            disposition: "scrap",
          },
        ],
      }),
    );

    const items = db
      .prepare(`SELECT sort_order, disposition FROM local_return_items WHERE return_local_id = 'return-2' ORDER BY sort_order`)
      .all() as Array<{ sort_order: number; disposition: string }>;
    expect(items).toEqual([
      { sort_order: 0, disposition: "restock" },
      { sort_order: 1, disposition: "scrap" },
    ]);

    // Only the restocked unit moves stock: sale of 4 (-4) + one restocked (+1) = -3.
    const row = db.prepare(`SELECT local_delta FROM inventory WHERE variant_id = 'v1'`).get() as {
      local_delta: string;
    };
    expect(row.local_delta).toBe("-3.0");
  });
});
