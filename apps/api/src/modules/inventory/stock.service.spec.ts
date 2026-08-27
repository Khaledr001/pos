import { schema } from "@devsfleet/db";
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequestContext } from "../../common/context/request-context.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import { StockService } from "./stock.service.js";

/**
 * Covers the low-stock crossing check added to `post()` — see
 * checkLowStockCrossing. The dedupe and fan-out that turn a recorded event
 * into notification rows are NotificationsService's and
 * LowStockNotificationListener's concern and are tested there; this only
 * proves `post()` records the right event on the right movements.
 *
 * `RequestContext.get()?.events` has to be read from INSIDE the
 * `RequestContext.run()` callback, not after awaiting it from the test body —
 * AsyncLocalStorage binds a continuation to whatever store was active when it
 * was scheduled, and the test's own top-level `await` was not scheduled from
 * inside the store's dynamic extent.
 */
describe("StockService — low-stock crossing", () => {
  const TENANT_ID = "11111111-1111-1111-1111-111111111111";
  const VARIANT_ID = "22222222-2222-2222-2222-222222222222";
  const BRANCH_ID = "33333333-3333-3333-3333-333333333333";

  let service: StockService;

  const withTenant = <T>(fn: () => T): T =>
    RequestContext.run({ requestId: "t", startedAt: Date.now(), tenantId: TENANT_ID, branchId: null }, fn);

  function buildTx(opts: { quantityAfter: string; reservedQuantity?: string; minStock: string }) {
    const inventoryChain = {
      values: vi.fn(() => inventoryChain),
      onConflictDoUpdate: vi.fn(() => inventoryChain),
      returning: vi.fn(() =>
        Promise.resolve([
          {
            quantity: opts.quantityAfter,
            averageCost: null,
            reservedQuantity: opts.reservedQuantity ?? "0",
          },
        ]),
      ),
    };
    const ledgerChain = {
      values: vi.fn(() => ledgerChain),
      returning: vi.fn(() => Promise.resolve([{ id: "ledger-1" }])),
    };

    return {
      query: {
        productVariants: { findFirst: vi.fn().mockResolvedValue({ minStock: opts.minStock }) },
      },
      insert: vi.fn((table: unknown) => (table === schema.inventory ? inventoryChain : ledgerChain)),
    };
  }

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [StockService, { provide: TenantDatabase, useValue: {} }],
    }).compile();
    service = moduleRef.get(StockService);
  });

  it("records a crossing when a deduction drops available to or below minStock", async () => {
    // Was 6, deduct 3 -> now 3. availableBefore (6) > minStock (5) >= availableAfter (3): crossed.
    const tx = buildTx({ quantityAfter: "3", minStock: "5" });

    const events = await withTenant(async () => {
      await service.deductStock({
        tx: tx as never,
        variantId: VARIANT_ID,
        branchId: BRANCH_ID,
        quantity: "3",
        referenceType: "sale",
        referenceId: "sale-1",
      });
      return RequestContext.get()?.events ?? [];
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      name: "inventory.low_stock_threshold_crossed",
      tenantId: TENANT_ID,
      payload: { variantId: VARIANT_ID, branchId: BRANCH_ID, available: "3.0000", minStock: "5" },
    });
  });

  it("does not record when available was already at or below the line", async () => {
    // Was 4 (already <= 5), deduct 1 -> now 3. Never crossed FROM above.
    const tx = buildTx({ quantityAfter: "3", minStock: "5" });

    const events = await withTenant(async () => {
      await service.deductStock({
        tx: tx as never,
        variantId: VARIANT_ID,
        branchId: BRANCH_ID,
        quantity: "1",
        referenceType: "sale",
        referenceId: "sale-2",
      });
      return RequestContext.get()?.events ?? [];
    });

    expect(events).toHaveLength(0);
  });

  it("does not record when available stays comfortably above the line", async () => {
    const tx = buildTx({ quantityAfter: "20", minStock: "5" });

    const events = await withTenant(async () => {
      await service.deductStock({
        tx: tx as never,
        variantId: VARIANT_ID,
        branchId: BRANCH_ID,
        quantity: "1",
        referenceType: "sale",
        referenceId: "sale-3",
      });
      return RequestContext.get()?.events ?? [];
    });

    expect(events).toHaveLength(0);
  });

  it("never reads minStock for inbound stock — a receipt cannot newly cross into low", async () => {
    const tx = buildTx({ quantityAfter: "1", minStock: "5" });

    const events = await withTenant(async () => {
      await service.addStock({
        tx: tx as never,
        variantId: VARIANT_ID,
        branchId: BRANCH_ID,
        quantity: "1",
        referenceType: "purchase_receipt",
        referenceId: "po-1",
      });
      return RequestContext.get()?.events ?? [];
    });

    expect(tx.query.productVariants.findFirst).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
  });

  it("honours suppressEvents even on a crossing deduction", async () => {
    const tx = buildTx({ quantityAfter: "3", minStock: "5" });

    const events = await withTenant(async () => {
      await service.deductStock({
        tx: tx as never,
        variantId: VARIANT_ID,
        branchId: BRANCH_ID,
        quantity: "3",
        referenceType: "stock_count",
        referenceId: "count-1",
        suppressEvents: true,
      });
      return RequestContext.get()?.events ?? [];
    });

    expect(tx.query.productVariants.findFirst).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
  });

  it("does not record for a variant with no reorder point set", async () => {
    const tx = buildTx({ quantityAfter: "0", minStock: "0" });

    const events = await withTenant(async () => {
      await service.deductStock({
        tx: tx as never,
        variantId: VARIANT_ID,
        branchId: BRANCH_ID,
        quantity: "5",
        referenceType: "sale",
        referenceId: "sale-4",
      });
      return RequestContext.get()?.events ?? [];
    });

    expect(events).toHaveLength(0);
  });
});
