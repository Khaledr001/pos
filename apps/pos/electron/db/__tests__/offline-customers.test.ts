import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../sqlite.js";

/**
 * Creating a customer at the till, offline.
 *
 * The gap this covers: the sale screen has always offered a "new customer"
 * form, but no bridge method existed behind it, so it failed on every
 * terminal — online included. `customers` is a pulled mirror table with the
 * server's id as its key, so a locally-created row has to live under a
 * terminal-minted id and then be RE-KEYED when the push lands. Getting that
 * rewrite wrong either duplicates the customer on the next pull or orphans
 * every document raised for them, both silently.
 */
let db: Database.Database;

vi.mock("../sqlite.js", async () => {
  const actual = await vi.importActual<typeof import("../sqlite.js")>("../sqlite.js");
  return { ...actual, getDatabase: () => db };
});

const { createCustomer, searchCustomers, settleOutboxItem, commitSale } = await import(
  "../repositories.js"
);

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(db);
});

describe("createCustomer", () => {
  it("writes the customer locally so search finds it at once", () => {
    const created = createCustomer({ name: "Al Noor Contracting", phone: "0501234567" });

    const found = searchCustomers("Al Noor") as Array<Record<string, unknown>>;
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      id: created.id,
      name: "Al Noor Contracting",
      phone: "0501234567",
    });
  });

  it("returns a row shaped for the cart to attach directly", () => {
    const created = createCustomer({ name: "Walk In", creditLimit: "500" });

    // The cart attaches this object rather than searching again, so every
    // field it reads has to be present — a missing creditLimit would read as
    // undefined and break the credit check on the very next line.
    expect(created).toMatchObject({
      name: "Walk In",
      creditLimit: "500",
      creditBalance: "0",
      creditOnHold: 0,
      priceListId: null,
    });
    expect(typeof created.id).toBe("string");
  });

  it("defaults credit to zero — credit is granted deliberately, never by omission", () => {
    const created = createCustomer({ name: "No Credit" });
    expect(created.creditLimit).toBe("0");
  });

  it("enqueues exactly one customer outbox item carrying the details", () => {
    createCustomer({ name: "Gulf Traders", company: "Gulf Traders LLC", trn: "100234567800003" });

    const rows = db
      .prepare(`SELECT entity, payload FROM outbox WHERE entity = 'customer'`)
      .all() as Array<{ entity: string; payload: string }>;

    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.payload)).toMatchObject({
      name: "Gulf Traders",
      company: "Gulf Traders LLC",
      trn: "100234567800003",
      creditLimit: 0,
    });
  });

  it("omits blank optional fields rather than pushing empty strings", () => {
    createCustomer({ name: "Sparse", phone: "  ", company: "" });

    const row = db.prepare(`SELECT payload FROM outbox WHERE entity = 'customer'`).get() as {
      payload: string;
    };
    const payload = JSON.parse(row.payload) as Record<string, unknown>;

    expect(payload).not.toHaveProperty("phone");
    expect(payload).not.toHaveProperty("company");
  });
});

describe("settleOutboxItem — re-keying a locally-created customer", () => {
  const SERVER_ID = "99999999-9999-9999-9999-999999999999";

  it("rewrites the placeholder id to the server's, so the next pull does not duplicate them", () => {
    const created = createCustomer({ name: "Re-keyed Co" });

    settleOutboxItem({
      localId: created.id as string,
      outcome: "applied",
      entity: "customer",
      serverId: SERVER_ID,
    });

    const rows = db.prepare(`SELECT id FROM customers`).all() as Array<{ id: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(SERVER_ID);
  });

  it("carries every document raised for them across to the new id", () => {
    const created = createCustomer({ name: "Had A Sale" });
    const localId = created.id as string;

    db.prepare(
      `INSERT INTO inventory (id, variant_id, quantity, reserved_qty, local_delta, updated_at)
       VALUES ('inv-v1', 'v1', '10', '0', '0', datetime('now'))`,
    ).run();

    commitSale({
      localId: "sale-1",
      customerId: localId,
      cashSessionId: null,
      lines: [
        {
          variantId: "v1",
          productName: "Test",
          productSku: "SKU-1",
          quantity: "1",
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
    });

    settleOutboxItem({
      localId,
      outcome: "applied",
      entity: "customer",
      serverId: SERVER_ID,
    });

    // The sale must follow the customer. Left behind, a reprinted receipt
    // joins on a dead id and shows no name at all — with no error anywhere.
    const sale = db
      .prepare(`SELECT customer_id FROM local_sales WHERE local_id = 'sale-1'`)
      .get() as { customer_id: string };
    expect(sale.customer_id).toBe(SERVER_ID);
  });

  it("leaves everything alone when the server returned no id", () => {
    const created = createCustomer({ name: "No Server Id" });

    settleOutboxItem({
      localId: created.id as string,
      outcome: "applied",
      entity: "customer",
    });

    const row = db.prepare(`SELECT id FROM customers`).get() as { id: string };
    expect(row.id).toBe(created.id);
  });

  it("does not touch another customer's row", () => {
    const kept = createCustomer({ name: "Untouched" });
    const moved = createCustomer({ name: "Moved" });

    settleOutboxItem({
      localId: moved.id as string,
      outcome: "applied",
      entity: "customer",
      serverId: SERVER_ID,
    });

    const ids = (db.prepare(`SELECT id FROM customers ORDER BY name`).all() as Array<{ id: string }>)
      .map((r) => r.id);
    expect(ids).toEqual([SERVER_ID, kept.id]); // "Moved" sorts before "Untouched"
  });
});
