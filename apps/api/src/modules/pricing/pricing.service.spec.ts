import { schema } from "@devsfleet/db";
import { ERROR_CODES } from "@devsfleet/shared-utils";
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequestContext } from "../../common/context/request-context.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import { PricingService } from "./pricing.service.js";

/**
 * A chainable stub that is ALSO the promise it eventually resolves to — every
 * builder method (`values`, `set`, `where`, `returning`, ...) returns the same
 * object, so `await tx.insert(x).values(y).returning()` and
 * `await tx.update(x).set(y).where(z)` both just resolve to `result`,
 * whichever chain length the code under test happens to use.
 */
function chain(result: unknown) {
  const promise = Promise.resolve(result) as Promise<unknown> & Record<string, ReturnType<typeof vi.fn>>;
  for (const method of ["values", "set", "where", "from", "orderBy", "limit", "offset", "returning"]) {
    promise[method] = vi.fn(() => promise);
  }
  return promise;
}

describe("PricingService", () => {
  let service: PricingService;
  let tx: {
    query: {
      productPrices: { findFirst: ReturnType<typeof vi.fn> };
      customerPrices: { findFirst: ReturnType<typeof vi.fn> };
      priceLists: { findFirst: ReturnType<typeof vi.fn> };
    };
    insert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
  };

  const withContext = <T>(fn: () => T): T =>
    RequestContext.run(
      {
        requestId: "test",
        startedAt: Date.now(),
        tenantId: "11111111-1111-1111-1111-111111111111",
        branchId: null,
        user: { id: "user-1", tenantId: "11111111-1111-1111-1111-111111111111" } as never,
      },
      fn,
    );

  beforeEach(async () => {
    tx = {
      query: {
        productPrices: { findFirst: vi.fn() },
        customerPrices: { findFirst: vi.fn() },
        priceLists: { findFirst: vi.fn() },
      },
      insert: vi.fn(),
      update: vi.fn(),
      select: vi.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PricingService,
        {
          provide: TenantDatabase,
          useValue: {
            run: (fn: (t: unknown) => unknown) => {
              RequestContext.requireTenantId();
              return fn(tx);
            },
          },
        },
      ],
    }).compile();

    service = moduleRef.get(PricingService);
  });

  describe("setProductPrice", () => {
    it("inserts a history row and a fresh price row when none existed before", async () => {
      tx.query.productPrices.findFirst.mockResolvedValue(undefined);
      const created = { id: "pp-1", sellingPrice: "10.00", effectiveFrom: "2026-01-01" };
      tx.insert.mockImplementation((table: unknown) =>
        table === schema.priceHistory ? chain(undefined) : chain([created]),
      );

      const result = await withContext(() =>
        service.setProductPrice({
          variantId: "v1",
          priceListId: "pl1",
          sellingPrice: 10,
          effectiveFrom: "2026-01-01",
        }),
      );

      expect(result).toEqual(created);
      expect(tx.insert).toHaveBeenCalledWith(schema.priceHistory);
      expect(tx.insert).toHaveBeenCalledWith(schema.productPrices);
      // No prior row to close, so no update call at all.
      expect(tx.update).not.toHaveBeenCalled();
    });

    it("corrects the existing row in place for a same-day re-price, without a new row", async () => {
      const current = {
        id: "pp-1",
        sellingPrice: "10.00",
        purchasePrice: null,
        minSellingPrice: null,
        effectiveFrom: "2026-01-01",
      };
      tx.query.productPrices.findFirst.mockResolvedValue(current);
      const updated = { ...current, sellingPrice: "12.00" };
      tx.insert.mockImplementation(() => chain(undefined));
      tx.update.mockImplementation(() => chain([updated]));

      const result = await withContext(() =>
        service.setProductPrice({
          variantId: "v1",
          priceListId: "pl1",
          sellingPrice: 12,
          effectiveFrom: "2026-01-01",
        }),
      );

      expect(result).toEqual(updated);
      // Exactly one update: correcting the row. A new tier would need a
      // second update (closing effectiveTo) plus an insert.
      expect(tx.update).toHaveBeenCalledTimes(1);
      expect(tx.insert).toHaveBeenCalledTimes(1); // history only
    });

    it("closes the current row and inserts a new one when the new price starts later", async () => {
      const current = {
        id: "pp-1",
        sellingPrice: "10.00",
        purchasePrice: null,
        minSellingPrice: null,
        effectiveFrom: "2026-01-01",
      };
      tx.query.productPrices.findFirst.mockResolvedValue(current);
      const created = { id: "pp-2", sellingPrice: "15.00", effectiveFrom: "2026-02-01" };
      tx.insert.mockImplementation((table: unknown) =>
        table === schema.priceHistory ? chain(undefined) : chain([created]),
      );
      tx.update.mockImplementation(() => chain(undefined));

      const result = await withContext(() =>
        service.setProductPrice({
          variantId: "v1",
          priceListId: "pl1",
          sellingPrice: 15,
          effectiveFrom: "2026-02-01",
        }),
      );

      expect(result).toEqual(created);
      expect(tx.update).toHaveBeenCalledTimes(1); // closes the old row
      expect(tx.insert).toHaveBeenCalledTimes(2); // history + new row
    });

    it("refuses a price that would start before the current one already did", async () => {
      tx.query.productPrices.findFirst.mockResolvedValue({
        id: "pp-1",
        sellingPrice: "10.00",
        purchasePrice: null,
        minSellingPrice: null,
        effectiveFrom: "2026-02-01",
      });

      await expect(
        withContext(() =>
          service.setProductPrice({
            variantId: "v1",
            priceListId: "pl1",
            sellingPrice: 12,
            effectiveFrom: "2026-01-01",
          }),
        ),
      ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });

      expect(tx.insert).not.toHaveBeenCalled();
      expect(tx.update).not.toHaveBeenCalled();
    });

    it("is a no-op when nothing about the price actually changed", async () => {
      const current = {
        id: "pp-1",
        sellingPrice: "10.00",
        purchasePrice: null,
        minSellingPrice: null,
        effectiveFrom: "2026-01-01",
      };
      tx.query.productPrices.findFirst.mockResolvedValue(current);

      const result = await withContext(() =>
        service.setProductPrice({
          variantId: "v1",
          priceListId: "pl1",
          sellingPrice: 10,
          effectiveFrom: "2026-01-01",
        }),
      );

      expect(result).toEqual(current);
      expect(tx.insert).not.toHaveBeenCalled();
      expect(tx.update).not.toHaveBeenCalled();
    });
  });

  describe("bulkSetProductPrices", () => {
    it("applies every item inside the same run() call", async () => {
      tx.query.productPrices.findFirst.mockResolvedValue(undefined);
      tx.insert.mockImplementation((table: unknown) =>
        table === schema.priceHistory ? chain(undefined) : chain([{ id: "pp-x" }]),
      );

      const results = await withContext(() =>
        service.bulkSetProductPrices({
          items: [
            { variantId: "v1", priceListId: "pl1", sellingPrice: 10 },
            { variantId: "v2", priceListId: "pl1", sellingPrice: 20 },
          ],
        }),
      );

      expect(results).toHaveLength(2);
      expect(tx.query.productPrices.findFirst).toHaveBeenCalledTimes(2);
    });
  });

  describe("createPriceList", () => {
    it("forces the tenant's very first price list to be the default", async () => {
      tx.select.mockImplementation(() => chain([{ value: 0 }]));
      tx.update.mockImplementation(() => chain(undefined));
      const created = { id: "pl1", isDefault: true };
      const insertChain = chain([created]);
      tx.insert.mockImplementation(() => insertChain);

      const result = await withContext(() =>
        service.createPriceList({ name: "Retail", type: "retail", currency: "AED", isDefault: false }),
      );

      expect(result).toEqual(created);
      // isDefault: false was requested, but this is the tenant's first list.
      expect(insertChain.values).toHaveBeenCalledWith(expect.objectContaining({ isDefault: true }));
    });
  });

  describe("updatePriceList", () => {
    it("refuses to deactivate the current default list", async () => {
      tx.query.priceLists.findFirst.mockResolvedValue({ isDefault: true });

      await expect(
        withContext(() => service.updatePriceList("pl1", { isActive: false })),
      ).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });

      expect(tx.update).not.toHaveBeenCalled();
    });
  });
});
