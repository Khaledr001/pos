import { ERROR_CODES } from "@devsfleet/shared-utils";
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequestContext } from "../../common/context/request-context.js";
import { PlanLimitService } from "../../common/guards/plan-limit.service.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import { StockService } from "../inventory/stock.service.js";
import { PriceResolverService } from "../pricing/price-resolver.service.js";
import { StorageService } from "../storage/storage.service.js";
import { ProductsService } from "./products.service.js";

/**
 * Only the new Stage 5.6 image methods are covered here — ProductsService
 * has no other existing test coverage to extend (create/update/search are
 * large, dependency-heavy methods this stage's own work doesn't touch).
 */
function chain(result: unknown) {
  const promise = Promise.resolve(result) as Promise<unknown> & Record<string, ReturnType<typeof vi.fn>>;
  for (const method of ["values", "set", "where", "from", "orderBy", "returning"]) {
    promise[method] = vi.fn(() => promise);
  }
  return promise;
}

function makeFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    buffer: Buffer.from("fake-image-bytes"),
    mimetype: "image/jpeg",
    size: 1024,
    ...overrides,
  } as Express.Multer.File;
}

describe("ProductsService image methods", () => {
  let service: ProductsService;
  let tx: {
    query: {
      products: { findFirst: ReturnType<typeof vi.fn> };
      productImages: { findFirst: ReturnType<typeof vi.fn> };
    };
    select: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let storageUpload: ReturnType<typeof vi.fn>;

  const withContext = <T>(fn: () => T): T =>
    RequestContext.run(
      { requestId: "test", startedAt: Date.now(), tenantId: "t1", branchId: null },
      fn,
    );

  beforeEach(async () => {
    tx = {
      query: {
        products: { findFirst: vi.fn(async () => ({ id: "p1" })) },
        productImages: { findFirst: vi.fn(async () => undefined) },
      },
      select: vi.fn(() => chain([{ value: 0 }])),
      insert: vi.fn(() => chain([{ id: "img1", url: "https://cdn/img1.jpg" }])),
      update: vi.fn(() => chain(undefined)),
    };
    storageUpload = vi.fn(async () => "https://cdn/img1.jpg");

    const moduleRef = await Test.createTestingModule({
      providers: [
        ProductsService,
        {
          provide: TenantDatabase,
          useValue: {
            run: (fn: (t: unknown) => unknown) => {
              RequestContext.requireTenantId();
              return fn(tx);
            },
          },
        },
        { provide: PlanLimitService, useValue: {} },
        { provide: StockService, useValue: {} },
        { provide: PriceResolverService, useValue: {} },
        { provide: StorageService, useValue: { upload: storageUpload } },
      ],
    }).compile();

    service = moduleRef.get(ProductsService);
  });

  it("refuses an unsupported mime type before touching the database", async () => {
    await expect(
      withContext(() => service.addImage("p1", makeFile({ mimetype: "application/pdf" }), { isPrimary: false })),
    ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });

    expect(tx.query.products.findFirst).not.toHaveBeenCalled();
    expect(storageUpload).not.toHaveBeenCalled();
  });

  it("refuses a file over 5MB", async () => {
    await expect(
      withContext(() => service.addImage("p1", makeFile({ size: 6 * 1024 * 1024 }), { isPrimary: false })),
    ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });
  });

  it("refuses a checksum collision rather than re-uploading or silently linking", async () => {
    tx.query.productImages.findFirst.mockResolvedValue({ id: "existing", productId: "p2" });

    await expect(
      withContext(() => service.addImage("p1", makeFile(), { isPrimary: false })),
    ).rejects.toMatchObject({ code: ERROR_CODES.DUPLICATE_IMAGE });

    expect(storageUpload).not.toHaveBeenCalled();
  });

  it("makes the first image primary even when the caller didn't ask", async () => {
    tx.select.mockReturnValue(chain([{ value: 0 }])); // no images yet

    await withContext(() => service.addImage("p1", makeFile(), { isPrimary: false }));

    expect(tx.insert).toHaveBeenCalled();
    // The insert().values() call should have received isPrimary: true.
    const insertChain = tx.insert.mock.results[0]?.value;
    expect(insertChain.values).toHaveBeenCalledWith(expect.objectContaining({ isPrimary: true }));
  });

  it("does not force primary for a second image unless asked", async () => {
    tx.select.mockReturnValue(chain([{ value: 1 }])); // one image already exists

    await withContext(() => service.addImage("p1", makeFile(), { isPrimary: false }));

    const insertChain = tx.insert.mock.results[0]?.value;
    expect(insertChain.values).toHaveBeenCalledWith(expect.objectContaining({ isPrimary: false }));
  });

  it("refuses to act on an unknown product", async () => {
    tx.query.products.findFirst.mockResolvedValue(undefined);

    await expect(
      withContext(() => service.addImage("missing", makeFile(), { isPrimary: false })),
    ).rejects.toMatchObject({ code: ERROR_CODES.PRODUCT_NOT_FOUND });
  });
});
