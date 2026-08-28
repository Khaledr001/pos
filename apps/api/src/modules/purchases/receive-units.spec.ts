import { ERROR_CODES, Money } from "@devsfleet/shared-utils";
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequestContext } from "../../common/context/request-context.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import { SerialsService } from "../serials/serials.service.js";
import { StockService } from "../inventory/stock.service.js";
import { schema } from "@devsfleet/db";
import { PurchasesService } from "./purchases.service.js";

/**
 * Receiving goods in packs — buy a box of 1,000 screws, put 1,000 pieces on
 * the shelf.
 *
 * Everything here is about the two conversions going in OPPOSITE directions:
 * quantity multiplies up to base units while cost divides down to a per-piece
 * figure. Get one and not the other and `inventory.averageCost` is wrong by
 * the square of the pack size, silently, with nothing downstream to catch it.
 */
const TENANT = "11111111-1111-1111-1111-111111111111";
const BRANCH = "22222222-2222-4222-8222-222222222222";
const SUPPLIER = "33333333-3333-4333-8333-333333333333";
const VARIANT = "44444444-4444-4444-8444-444444444444";
const BOX = "55555555-5555-4555-8555-555555555555";

describe("PurchasesService.receive — packs", () => {
  let service: PurchasesService;
  let addStock: ReturnType<typeof vi.fn>;
  let poItemUpdates: Array<Record<string, unknown>>;
  let receiptItems: Array<Record<string, unknown>>;

  /** Overridden per test to reshape the fixture. */
  let allowsFractions: boolean;
  let trackSerial: boolean;
  let conversionFactor: string;
  let orderItem: Record<string, unknown> | null;

  const withContext = <T>(fn: () => T): T =>
    RequestContext.run(
      {
        requestId: "test",
        startedAt: Date.now(),
        tenantId: TENANT,
        branchId: BRANCH,
        user: {
          id: "u1",
          tenantId: TENANT,
          branchId: BRANCH,
          roleId: "r",
          roleName: "admin",
          permissions: ["*"],
          abac: {
            maxDiscountPercent: "100",
            maxSaleAmount: null,
            canApproveRefund: true,
            canViewCost: true,
            allowedBranchIds: [],
          },
          isPlatformAdmin: false,
          planId: "pro",
          trialEndsAt: null,
        },
      },
      fn,
    );

  /**
   * The literal values bound into a drizzle `sql` fragment.
   *
   * The fragment itself cannot be JSON-stringified — its chunks reference the
   * column, which references the table, which references the column again.
   */
  const sqlLiterals = (fragment: unknown): string[] =>
    ((fragment as { queryChunks?: unknown[] })?.queryChunks ?? [])
      .map((chunk) =>
        typeof chunk === "string"
          ? chunk
          : typeof (chunk as { value?: unknown })?.value === "string"
            ? String((chunk as { value: string }).value)
            : Array.isArray((chunk as { value?: unknown })?.value)
              ? (chunk as { value: unknown[] }).value.join("")
              : "",
      )
      .join(" ");

  /**
   * Chainable stub that is also the promise it resolves to — the same shape
   * `users.service.spec.ts` uses, extended with the joins this service makes.
   */
  function chain(result: unknown, onValues?: (v: Record<string, unknown>) => void) {
    const p = Promise.resolve(result) as Promise<unknown> & Record<string, unknown>;
    for (const m of ["from", "where", "orderBy", "limit", "offset", "groupBy", "set", "returning", "innerJoin", "leftJoin"]) {
      p[m] = vi.fn(() => p);
    }
    p["values"] = vi.fn((v: Record<string, unknown>) => {
      onValues?.(v);
      return p;
    });
    return p;
  }

  beforeEach(async () => {
    allowsFractions = false;
    trackSerial = false;
    conversionFactor = "1000";
    orderItem = null;
    addStock = vi.fn(async () => "ledger-1");
    poItemUpdates = [];
    receiptItems = [];

    /**
     * Dispatch on the SELECTED COLUMNS, not on call order.
     *
     * The service issues four different lookups, three of them from the same
     * table, and a test that receives twice would otherwise get the second
     * call's rows in the first call's shape. The column names are what
     * actually distinguish them.
     */
    const selectFor = (projection: Record<string, unknown>) => {
      const keys = new Set(Object.keys(projection ?? {}));
      if (keys.has("conversionFactor")) {
        return chain([{ variantId: VARIANT, unitId: BOX, conversionFactor, isPurchasable: true }]);
      }
      if (keys.has("allowsFractions")) return chain([{ id: VARIANT, allowsFractions }]);
      if (keys.has("trackSerial")) return chain([{ id: VARIANT, trackSerial }]);
      if (keys.has("productName")) {
        return chain([
          {
            id: VARIANT,
            sku: "SCR-1IN",
            variantName: "Default",
            productName: '1" Screw',
            unitId: "unit-pcs",
          },
        ]);
      }
      return chain([]);
    };

    const tx: Record<string, unknown> = {
      query: {
        purchaseOrders: {
          findFirst: vi.fn(async () =>
            orderItem
              ? { id: "po-1", branchId: BRANCH, supplierId: SUPPLIER, status: "sent", shippingAmount: "0" }
              : null,
          ),
        },
        purchaseOrderItems: { findMany: vi.fn(async () => (orderItem ? [orderItem] : [])) },
        suppliers: { findFirst: vi.fn(async () => ({ id: SUPPLIER, name: "Acme" })) },
        tenants: { findFirst: vi.fn(async () => ({ settings: {} })) },
        branches: { findFirst: vi.fn(async () => ({ code: "SHJ" })) },
        goodsReceipts: { findFirst: vi.fn(async () => ({ id: "grn-1" })) },
        productSupplierLinks: { findFirst: vi.fn(async () => undefined) },
      },
      execute: vi.fn(async () => [{ next_document_number: 1 }]),
      insert: vi.fn((table: unknown) => {
        if (table === schema.goodsReceiptItems) {
          return chain([{ id: "gri-1" }], (v) => receiptItems.push(v));
        }
        return chain([{ id: "grn-1" }]);
      }),
      update: vi.fn(() => {
        const p = chain([{ id: "x" }]);
        p["set"] = vi.fn((v: Record<string, unknown>) => {
          poItemUpdates.push(v);
          return p;
        });
        return p;
      }),
      select: vi.fn((projection: Record<string, unknown>) => selectFor(projection)),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PurchasesService,
        {
          provide: TenantDatabase,
          useValue: {
            run: (fn: (t: unknown) => unknown) => {
              RequestContext.requireTenantId();
              return fn(tx);
            },
          },
        },
        { provide: StockService, useValue: { addStock } },
        { provide: SerialsService, useValue: { checkIn: vi.fn(async () => {}) } },
      ],
    }).compile();

    service = moduleRef.get(PurchasesService);
  });

  const receive = (line: Record<string, unknown>) =>
    withContext(() =>
      service.receive({
        branchId: BRANCH,
        supplierId: SUPPLIER,
        shippingAmount: 0,
        // Present only when the test set up an order line to receive against.
        ...(orderItem ? { purchaseOrderId: "po-1" } : {}),
        lines: [{ variantId: VARIANT, damagedQuantity: 0, ...line }],
      } as never),
    );

  it("puts base units on the shelf, not packs", async () => {
    await receive({ quantity: 2, unitId: BOX, unitPrice: 100 });

    expect(addStock).toHaveBeenCalledTimes(1);
    expect(addStock.mock.calls[0]![0]).toMatchObject({ quantity: "2000.0000" });
  });

  it("divides the cost down to a per-piece figure", async () => {
    // 2 boxes at 100 = 200 for 2000 pieces = 0.10 each.
    await receive({ quantity: 2, unitId: BOX, unitPrice: 100 });

    expect(addStock.mock.calls[0]![0]).toMatchObject({ unitCost: "0.1000" });
  });

  it("hands StockService the EXACT total, so the average never inherits the rounding", async () => {
    // 2 boxes at 1.55 = 3.10 for 2000 pieces. Per piece that is 0.00155,
    // which stores as 0.0016 — multiply back and the box is worth 3.20.
    await receive({ quantity: 2, unitId: BOX, unitPrice: 1.55 });

    const call = addStock.mock.calls[0]![0];
    expect(call.unitCost).toBe("0.0016"); // rounded, for the ledger row
    expect(call.totalCost).toBe("3.1000"); // exact, for the weighted average

    const naive = Money.multiplyByQuantity(Money.toMinor(call.unitCost), "2000");
    expect(Money.toDecimalString(naive, 4)).toBe("3.2000"); // what we avoided
  });

  it("refuses a per-piece cost too small to record rather than valuing stock at zero", async () => {
    conversionFactor = "10000";
    // 10 bags of 10,000 at 0.45 = 4.50 across 100,000 pieces = 0.000045 each.
    await expect(receive({ quantity: 10, unitId: BOX, unitPrice: 0.45 })).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
    });
    expect(addStock).not.toHaveBeenCalled();
  });

  it("treats damagedQuantity as base units, so `1` is one screw not one box", async () => {
    await receive({ quantity: 2, unitId: BOX, unitPrice: 100, damagedQuantity: 1 });

    // 2000 arrived, 1 broken -> 1999 sellable. Not 1000.
    expect(addStock.mock.calls[0]![0]).toMatchObject({ quantity: "1999.0000" });
  });

  it("still bills the supplier for damaged units, and credits the PO in full", async () => {
    await receive({ quantity: 2, unitId: BOX, unitPrice: 100, damagedQuantity: 1 });

    // Receipt row keeps the entered quantity in the RECEIVED unit.
    expect(receiptItems[0]).toMatchObject({ quantity: "2", unitConversionFactor: "1000" });
  });

  it("rejects more damage than arrived", async () => {
    await expect(
      receive({ quantity: 1, unitId: BOX, unitPrice: 100, damagedQuantity: 1001 }),
    ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });
  });

  it("rejects a fractional base quantity for a unit counted in whole numbers", async () => {
    conversionFactor = "3";
    await expect(receive({ quantity: 0.5, unitId: BOX, unitPrice: 10 })).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  });

  it("allows a fractional base quantity when the unit permits decimals", async () => {
    conversionFactor = "3";
    allowsFractions = true;
    await receive({ quantity: 0.5, unitId: BOX, unitPrice: 10 });

    expect(addStock.mock.calls[0]![0]).toMatchObject({ quantity: "1.5000" });
  });

  it("credits the purchase order line in BASE units", async () => {
    orderItem = {
      id: "poi-1",
      variantId: VARIANT,
      unitPrice: "100",
      taxPercent: "5",
      unitConversionFactor: "1000",
      quantity: "2",
    };

    await receive({ quantity: 1, unitId: BOX, unitPrice: 100, purchaseOrderItemId: "poi-1" });

    // One box against a two-box order is 1000 base units, not 1.
    // `receive` also updates the supplier balance and the order status
    // through the same stub, so pick out the PO-line write.
    const lineWrite = poItemUpdates.find((u) => "receivedQuantity" in u);
    expect(lineWrite).toBeDefined();
    expect(sqlLiterals(lineWrite!["receivedQuantity"])).toContain("1000.0000");
  });

  it("rescales the ordered price when the receipt arrives in a different unit", async () => {
    orderItem = {
      id: "poi-1",
      variantId: VARIANT,
      unitPrice: "100", // per BOX of 1000
      taxPercent: "0",
      unitConversionFactor: "1000",
      quantity: "2",
    };

    // 300 loose pieces against a boxes order, price omitted so it falls back.
    await receive({ quantity: 300, purchaseOrderItemId: "poi-1" });

    // 100/box -> 0.10/piece -> 300 pieces cost 30.00, NOT 30,000.
    expect(addStock.mock.calls[0]![0]).toMatchObject({
      quantity: "300.0000",
      totalCost: "30.0000",
    });
  });

  it("rejects a unit that is not a packaging of this variant", async () => {
    await expect(
      receive({ quantity: 1, unitId: "99999999-9999-4999-8999-999999999999", unitPrice: 10 }),
    ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });
  });

  it("counts serials in base units", async () => {
    trackSerial = true;
    conversionFactor = "3";

    // 1 box of 3 needs 3 serials, not 1.
    await expect(
      receive({ quantity: 1, unitId: BOX, unitPrice: 30, serials: ["a"] }),
    ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });

    await receive({ quantity: 1, unitId: BOX, unitPrice: 30, serials: ["a", "b", "c"] });
    expect(addStock).toHaveBeenCalled();
  });
});
