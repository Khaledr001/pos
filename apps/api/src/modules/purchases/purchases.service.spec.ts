import { ERROR_CODES } from "@devsfleet/shared-utils";
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequestContext } from "../../common/context/request-context.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import { SerialsService } from "../serials/serials.service.js";
import { StockService } from "../inventory/stock.service.js";
import { PurchasesService } from "./purchases.service.js";

/**
 * Only `lookupSupplierCode` is covered here — the rest of PurchasesService
 * (create/receive/etc.) has no existing test coverage to extend, and
 * exercising it properly would need StockService/SerialsService mocked in
 * far more depth than this stage's own new code requires. This targets just
 * the new Stage 5.4 lookup: does a supplier's own code actually resolve?
 */
describe("PurchasesService.lookupSupplierCode", () => {
  let service: PurchasesService;
  let tx: { query: { productSupplierLinks: { findFirst: ReturnType<typeof vi.fn> } } };

  const withContext = <T>(fn: () => T): T =>
    RequestContext.run(
      {
        requestId: "test",
        startedAt: Date.now(),
        tenantId: "11111111-1111-1111-1111-111111111111",
        branchId: null,
      },
      fn,
    );

  beforeEach(async () => {
    tx = { query: { productSupplierLinks: { findFirst: vi.fn() } } };

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
        { provide: StockService, useValue: {} },
        { provide: SerialsService, useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(PurchasesService);
  });

  it("resolves a supplier's own barcode to the linked variant", async () => {
    const link = { id: "link-1", variantId: "v1", variant: { id: "v1" } };
    tx.query.productSupplierLinks.findFirst.mockResolvedValue(link);

    const result = await withContext(() =>
      service.lookupSupplierCode({ supplierId: "s1", code: "ACME-90-ELB" }),
    );

    expect(result).toEqual(link);
  });

  it("raises NOT_FOUND when the code matches no link for this supplier", async () => {
    tx.query.productSupplierLinks.findFirst.mockResolvedValue(undefined);

    await expect(
      withContext(() => service.lookupSupplierCode({ supplierId: "s1", code: "UNKNOWN" })),
    ).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
  });
});
