import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../sqlite.js";

/**
 * `repositories.ts` reaches the database through the module-level
 * `getDatabase()` singleton rather than accepting one as a parameter — unlike
 * `local-auth.ts`, which took a parameter specifically for this reason. Rather
 * than widen that module's public signatures for a test, this points the
 * singleton at an isolated in-memory database via `vi.mock`.
 */
let db: Database.Database;

vi.mock("../sqlite.js", async () => {
  const actual = await vi.importActual<typeof import("../sqlite.js")>("../sqlite.js");
  return { ...actual, getDatabase: () => db };
});

const {
  outboxAttentionItems,
  retryOutboxItem,
  discardOutboxItem,
  acknowledgeWarning,
  settleOutboxItem,
} = await import("../repositories.js");

function enqueue(localId: string, entity = "sale"): void {
  db.prepare(
    `INSERT INTO outbox (local_id, entity, sequence, occurred_at, payload)
     VALUES (?, ?, 1, datetime('now'), '{}')`,
  ).run(localId, entity);
}

describe("outbox attention list", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    migrate(db);
  });

  it("lists a rejected item and lets it be retried", () => {
    enqueue("s1");
    settleOutboxItem({ localId: "s1", outcome: "rejected", message: "Over the credit limit" });

    const items = outboxAttentionItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ localId: "s1", kind: "rejected", reason: "Over the credit limit" });

    retryOutboxItem("s1");
    expect(outboxAttentionItems()).toHaveLength(0);
    const row = db.prepare(`SELECT status, last_error FROM outbox WHERE local_id = 's1'`).get() as {
      status: string;
      last_error: string | null;
    };
    expect(row.status).toBe("pending");
    expect(row.last_error).toBeNull();
  });

  it("lists an applied-with-warning item as a warning, not a rejection", () => {
    enqueue("s2");
    settleOutboxItem({
      localId: "s2",
      outcome: "applied_with_warning",
      serverId: "server-1",
      documentNumber: "INV-1",
      message: "Cash session not found — unreconciled",
    });

    const items = outboxAttentionItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "warning", reason: "Cash session not found — unreconciled" });

    // Already synced — the row must not still be sitting in the push queue.
    const row = db.prepare(`SELECT status FROM outbox WHERE local_id = 's2'`).get() as { status: string };
    expect(row.status).toBe("synced");
  });

  it("stops re-pushing an applied_with_warning sale forever", () => {
    // The regression this exists for: before the fix, this outcome fell
    // through to the generic branch, which never sets status = 'synced'.
    enqueue("s3");
    settleOutboxItem({ localId: "s3", outcome: "applied_with_warning", message: "note" });
    const row = db.prepare(`SELECT status FROM outbox WHERE local_id = 's3'`).get() as { status: string };
    expect(row.status).not.toBe("pending");
  });

  it("discarding removes it from the list without deleting the row", () => {
    enqueue("s4");
    settleOutboxItem({ localId: "s4", outcome: "rejected", message: "Bad data" });

    discardOutboxItem("s4");
    expect(outboxAttentionItems()).toHaveLength(0);

    const row = db.prepare(`SELECT status FROM outbox WHERE local_id = 's4'`).get() as { status: string };
    expect(row.status).toBe("discarded");
  });

  it("acknowledging a warning clears it without touching a rejection", () => {
    enqueue("s5");
    enqueue("s6");
    settleOutboxItem({ localId: "s5", outcome: "applied_with_warning", message: "note" });
    settleOutboxItem({ localId: "s6", outcome: "rejected", message: "reason" });

    acknowledgeWarning("s5");
    const remaining = outboxAttentionItems();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.localId).toBe("s6");
  });

  it("retry only affects a REJECTED row — a pending or synced one is untouched", () => {
    enqueue("s7");
    // Never settled: still pending.
    retryOutboxItem("s7");
    const row = db.prepare(`SELECT status FROM outbox WHERE local_id = 's7'`).get() as { status: string };
    expect(row.status).toBe("pending");
  });

  it("stamps local_quotations.synced_at on a synced quotation", () => {
    db.prepare(
      `INSERT INTO local_quotations (local_id, customer_id, subtotal, tax_amount, discount_amount, total, occurred_at)
       VALUES ('q1', 'c1', '10', '0.5', '0', '10.5', datetime('now'))`,
    ).run();
    enqueue("q1", "quotation");

    settleOutboxItem({ localId: "q1", outcome: "applied", serverId: "srv-q1", documentNumber: "QUO-1", entity: "quotation" });

    const row = db.prepare(`SELECT synced_at, server_id, quotation_number FROM local_quotations WHERE local_id = 'q1'`).get() as {
      synced_at: string | null;
      server_id: string | null;
      quotation_number: string | null;
    };
    expect(row.synced_at).not.toBeNull();
    expect(row.server_id).toBe("srv-q1");
    expect(row.quotation_number).toBe("QUO-1");
  });

  it("stamps local_customer_payments.synced_at on a synced payment", () => {
    db.prepare(
      `INSERT INTO local_customer_payments (local_id, customer_id, amount, method, occurred_at)
       VALUES ('p1', 'c1', '50', 'cash', datetime('now'))`,
    ).run();
    enqueue("p1", "customer_payment");

    settleOutboxItem({ localId: "p1", outcome: "applied", entity: "customer_payment" });

    const row = db.prepare(`SELECT synced_at FROM local_customer_payments WHERE local_id = 'p1'`).get() as {
      synced_at: string | null;
    };
    expect(row.synced_at).not.toBeNull();
  });
});
