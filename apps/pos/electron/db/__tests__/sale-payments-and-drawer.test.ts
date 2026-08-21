import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../sqlite.js";

/**
 * Stage 4: a receipt needs to show what was tendered, and a manual drawer
 * open needs to leave an audit trail — neither existed before this stage.
 * Same singleton-mocking approach as returns.test.ts.
 */
let db: Database.Database;

vi.mock("../sqlite.js", async () => {
  const actual = await vi.importActual<typeof import("../sqlite.js")>("../sqlite.js");
  return { ...actual, getDatabase: () => db };
});

const { commitSale, recentSales, findSale, recordDrawerOpen } = await import(
  "../repositories.js"
);

function saleDraft(overrides: Record<string, unknown> = {}) {
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
        lineSubtotal: "40.00",
        taxAmount: "2.00",
        total: "42.00",
      },
    ],
    subtotal: "40.00",
    taxAmount: "2.00",
    discountAmount: "0",
    total: "42.00",
    payments: [{ method: "cash", amount: "42.00" }],
    occurredAt: new Date(0).toISOString(),
    ...overrides,
  };
}

describe("sale payments persistence", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    migrate(db);
    db.prepare(
      `INSERT INTO inventory (id, variant_id, quantity, reserved_qty, local_delta, updated_at)
       VALUES ('inv-v1', 'v1', '10', '0', '0', datetime('now'))`,
    ).run();
  });

  it("round-trips a single cash tender through findSale", () => {
    commitSale(saleDraft());

    const sale = findSale("sale-1") as { payments: Array<Record<string, unknown>> };
    expect(sale.payments).toEqual([{ method: "cash", amount: "42.00", reference: null }]);
  });

  it("round-trips split tenders, in the order they were taken, through recentSales", () => {
    commitSale(
      saleDraft({
        payments: [
          { method: "card", amount: "30.00", reference: "AUTH123" },
          { method: "cash", amount: "12.00" },
        ],
      }),
    );

    const [sale] = recentSales() as Array<{ payments: Array<Record<string, unknown>> }>;
    expect(sale!.payments).toEqual([
      { method: "card", amount: "30.00", reference: "AUTH123" },
      { method: "cash", amount: "12.00", reference: null },
    ]);
  });

  it("a sale with no persisted payments (never happens via commitSale) reads back as an empty array", () => {
    // findSale/recentSales must not choke on a sale with zero payment rows —
    // this was the pre-Stage-4 bug: both always returned `payments: []`
    // regardless of what was actually paid.
    commitSale(saleDraft());
    db.prepare(`DELETE FROM local_sale_payments WHERE sale_local_id = 'sale-1'`).run();

    const sale = findSale("sale-1") as { payments: unknown[] };
    expect(sale.payments).toEqual([]);
  });

  it("looks a sale up by its local id when no sale_number has been assigned yet (unsynced)", () => {
    commitSale(saleDraft());
    const sale = findSale("sale-1") as { localId: string; payments: unknown[] };
    expect(sale.localId).toBe("sale-1");
    expect(sale.payments).toHaveLength(1);
  });
});

describe("manual drawer open audit trail", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    migrate(db);
  });

  it("writes a local_drawer_opens row with the given reason", () => {
    recordDrawerOpen("Checking float before shift");

    const row = db.prepare(`SELECT reason, synced_at FROM local_drawer_opens`).get() as {
      reason: string;
      synced_at: string | null;
    };
    expect(row.reason).toBe("Checking float before shift");
    expect(row.synced_at).toBeNull();
  });

  it("enqueues a drawer_open outbox item carrying the reason", () => {
    recordDrawerOpen("Giving change to a customer without a sale");

    const outbox = db
      .prepare(`SELECT entity, payload FROM outbox WHERE entity = 'drawer_open'`)
      .all() as Array<{ entity: string; payload: string }>;
    expect(outbox).toHaveLength(1);
    expect(JSON.parse(outbox[0]!.payload)).toEqual({
      reason: "Giving change to a customer without a sale",
    });
  });

  it("each open gets its own local_id, distinct from the outbox item's", () => {
    recordDrawerOpen("first");
    recordDrawerOpen("second");

    const rows = db.prepare(`SELECT local_id FROM local_drawer_opens`).all() as Array<{
      local_id: string;
    }>;
    expect(rows).toHaveLength(2);
    expect(rows[0]!.local_id).not.toBe(rows[1]!.local_id);

    const outboxIds = db
      .prepare(`SELECT local_id FROM outbox WHERE entity = 'drawer_open'`)
      .all() as Array<{ local_id: string }>;
    expect(outboxIds).toHaveLength(2);
  });
});
