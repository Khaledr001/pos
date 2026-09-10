import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../sqlite.js";

/**
 * What the terminal has to know before it can void a sale.
 *
 * A void is the one counter action that is NOT offline-capable: it addresses
 * a sale by its SERVER id and the server applies it atomically. So the two
 * things the UI gates on — does this sale have a server id yet, and has it
 * already been voided — both have to survive a round trip through the local
 * mirror, and neither did until `serverId` and `status` were selected.
 *
 * Same singleton-mocking approach as returns.test.ts, for the same reason:
 * `repositories.ts` reaches the database through `getDatabase()`.
 */
let db: Database.Database;

vi.mock("../sqlite.js", async () => {
  const actual = await vi.importActual<typeof import("../sqlite.js")>("../sqlite.js");
  return { ...actual, getDatabase: () => db };
});

const { commitSale, findSale, recentSales, markSaleVoided, settleOutboxItem } = await import(
  "../repositories.js"
);

interface LocalSale {
  localId: string;
  serverId: string | null;
  saleNumber: string | null;
  status: string;
  synced: boolean;
}

function saleDraft(localId: string) {
  return {
    localId,
    customerId: null,
    cashSessionId: null,
    lines: [
      {
        variantId: "v1",
        productName: "High Pressure Nipple Socket",
        productSku: "NIP-SOC-25",
        quantity: "2",
        unitPrice: "27.50",
        discountPercent: "0",
        taxPercent: "5",
        lineSubtotal: "55.00",
        taxAmount: "2.75",
        total: "57.75",
      },
    ],
    subtotal: "55.00",
    taxAmount: "2.75",
    discountAmount: "0",
    total: "57.75",
    payments: [{ method: "cash", amount: "57.75" }],
    occurredAt: new Date(0).toISOString(),
  };
}

/** `commitSale` refuses to sell stock the terminal does not believe it has. */
function seedInventory(variantId: string, quantity: number): void {
  db.prepare(
    `INSERT INTO inventory (id, variant_id, quantity, reserved_qty, local_delta, updated_at)
     VALUES (?, ?, ?, '0', '0', datetime('now'))`,
  ).run(`inv-${variantId}`, variantId, String(quantity));
}

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
  seedInventory("v1", 100);
});

describe("a locally-mirrored sale, as the void UI reads it", () => {
  it("has no server id until it syncs, which is what blocks the void", () => {
    commitSale(saleDraft("sale-1"));

    const sale = findSale("sale-1") as LocalSale;
    expect(sale.serverId).toBeNull();
    expect(sale.synced).toBe(false);
  });

  it("carries the server id once the push is settled", () => {
    commitSale(saleDraft("sale-1"));
    settleOutboxItem({
      localId: "sale-1",
      outcome: "applied",
      serverId: "11111111-2222-3333-4444-555555555555",
      documentNumber: "INV-SHJ-2026-000001",
    });

    const sale = findSale("sale-1") as LocalSale;
    expect(sale.serverId).toBe("11111111-2222-3333-4444-555555555555");
    expect(sale.saleNumber).toBe("INV-SHJ-2026-000001");
  });

  it("is findable by its sale number, carrying the same server id", () => {
    commitSale(saleDraft("sale-1"));
    settleOutboxItem({
      localId: "sale-1",
      outcome: "applied",
      serverId: "srv-1",
      documentNumber: "INV-SHJ-2026-000001",
    });

    const sale = findSale("INV-SHJ-2026-000001") as LocalSale;
    expect(sale.localId).toBe("sale-1");
    expect(sale.serverId).toBe("srv-1");
  });

  it("reports a status, so an already-voided sale cannot be voided twice", () => {
    commitSale(saleDraft("sale-1"));
    expect((findSale("sale-1") as LocalSale).status).toBe("completed");

    markSaleVoided("sale-1");
    expect((findSale("sale-1") as LocalSale).status).toBe("voided");
  });

  it("shows the void in the recent list too — that is where cashiers pick from", () => {
    commitSale(saleDraft("sale-1"));
    commitSale(saleDraft("sale-2"));
    markSaleVoided("sale-2");

    const byId = new Map((recentSales(10) as LocalSale[]).map((s) => [s.localId, s]));
    expect(byId.get("sale-1")?.status).toBe("completed");
    expect(byId.get("sale-2")?.status).toBe("voided");
  });

  it("leaves other sales alone", () => {
    commitSale(saleDraft("sale-1"));
    commitSale(saleDraft("sale-2"));
    markSaleVoided("sale-1");

    expect((findSale("sale-2") as LocalSale).status).toBe("completed");
  });
});
