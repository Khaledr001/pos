import { ERROR_CODES } from "@devsfleet/shared-utils";
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequestContext } from "../../common/context/request-context.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import { ProductsService } from "../products/products.service.js";
import { ImageFetcher } from "./image-fetcher.js";
import { ProductImageCandidatesService } from "./product-image-candidates.service.js";

const TENANT = "11111111-1111-1111-1111-111111111111";
const PRODUCT = "22222222-2222-2222-2222-222222222222";
const OTHER_PRODUCT = "33333333-3333-3333-3333-333333333333";
const CANDIDATE = "44444444-4444-4444-4444-444444444444";

/** A thenable that also answers the chained builder methods drizzle exposes. */
function chain(result: unknown) {
  const promise = Promise.resolve(result) as Promise<unknown> & Record<string, ReturnType<typeof vi.fn>>;
  for (const method of ["values", "set", "where", "from", "returning", "onConflictDoNothing"]) {
    promise[method] = vi.fn(() => promise);
  }
  return promise;
}

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(50, 7)]);
const CHECKSUM = createHash("sha256").update(JPEG).digest("hex");

const candidateRow = {
  id: CANDIDATE,
  productId: PRODUCT,
  imageUrl: "https://cdn.example.com/a.jpg",
  sourcePageUrl: "https://shop.example.com/p/1",
  sourceDomain: "shop.example.com",
  status: "pending",
  thumbnailUrl: null, title: null, width: null, height: null, matchScore: 80, query: null,
};

describe("ProductImageCandidatesService", () => {
  let service: ProductImageCandidatesService;
  let tx: {
    query: Record<string, { findFirst: ReturnType<typeof vi.fn> }>;
    select: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let fetcher: { fetch: ReturnType<typeof vi.fn> };
  let products: { addImage: ReturnType<typeof vi.fn> };

  const inContext = <T>(fn: () => T): T =>
    RequestContext.run({ requestId: "t", startedAt: Date.now(), tenantId: TENANT, branchId: null }, fn);

  beforeEach(() => {
    tx = {
      query: {
        productImageCandidates: { findFirst: vi.fn() },
        products: { findFirst: vi.fn() },
        productImages: { findFirst: vi.fn() },
      },
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
    };
    fetcher = { fetch: vi.fn() };
    products = { addImage: vi.fn() };
    service = new ProductImageCandidatesService(
      { run: (fn: (t: unknown) => unknown) => fn(tx) } as unknown as TenantDatabase,
      products as unknown as ProductsService,
      fetcher as unknown as ImageFetcher,
    );
  });

  describe("bulkCreate", () => {
    const input = (productId: string, imageUrl: string) => ({
      productId, imageUrl, sourcePageUrl: "https://www.Shop.example.com/p/1?x=1", matchScore: 70,
    });

    it("derives the source domain server-side and inserts with ON CONFLICT DO NOTHING", async () => {
      tx.select.mockReturnValue(chain([{ id: PRODUCT }]));
      const insert = chain([{ id: "a" }, { id: "b" }]);
      tx.insert.mockReturnValue(insert);

      const result = await inContext(() =>
        service.bulkCreate({ candidates: [input(PRODUCT, "https://c.example.com/1.jpg"), input(PRODUCT, "https://c.example.com/2.jpg")] }),
      );

      expect(result).toEqual({ received: 2, inserted: 2, skipped: 0, unknownProducts: [] });
      expect(insert.onConflictDoNothing).toHaveBeenCalledTimes(1);
      const rows = insert.values.mock.calls[0]?.[0] as Array<{ sourceDomain: string; tenantId: string }>;
      expect(rows.map((r) => r.sourceDomain)).toEqual(["shop.example.com", "shop.example.com"]);
      expect(rows.every((r) => r.tenantId === TENANT)).toBe(true);
    });

    it("is idempotent: a re-run where everything already exists reports skipped, not inserted", async () => {
      tx.select.mockReturnValue(chain([{ id: PRODUCT }]));
      tx.insert.mockReturnValue(chain([]));
      const result = await inContext(() =>
        service.bulkCreate({ candidates: [input(PRODUCT, "https://c.example.com/1.jpg")] }),
      );
      expect(result).toMatchObject({ inserted: 0, skipped: 1 });
    });

    it("collapses duplicates within one request and reports unknown (or foreign-tenant) products without inserting them", async () => {
      tx.select.mockReturnValue(chain([{ id: PRODUCT }]));
      const insert = chain([{ id: "a" }]);
      tx.insert.mockReturnValue(insert);

      const result = await inContext(() =>
        service.bulkCreate({
          candidates: [
            input(PRODUCT, "https://c.example.com/1.jpg"),
            input(PRODUCT, "https://c.example.com/1.jpg"),
            input(OTHER_PRODUCT, "https://c.example.com/9.jpg"),
          ],
        }),
      );
      expect(result.unknownProducts).toEqual([OTHER_PRODUCT]);
      expect((insert.values.mock.calls[0]?.[0] as unknown[]).length).toBe(1);
      expect(result.inserted).toBe(1);
    });
  });

  describe("approve", () => {
    function stubLoad(status = "pending") {
      tx.query.productImageCandidates!.findFirst.mockResolvedValue({ ...candidateRow, status });
      tx.query.products!.findFirst.mockResolvedValue({ name: "Modi Shower Head" });
    }

    it("downloads via the guarded fetcher, uploads through ProductsService, records attribution, marks approved", async () => {
      stubLoad();
      fetcher.fetch.mockResolvedValue({ buffer: JPEG, mimeType: "image/jpeg" });
      tx.query.productImages!.findFirst.mockResolvedValue(undefined); // no dup, no primary
      const image = { id: "img1", productId: PRODUCT };
      products.addImage.mockResolvedValue(image);
      tx.update.mockReturnValue(chain([{ ...candidateRow, status: "approved" }]));

      const result = await inContext(() => service.approve(CANDIDATE));

      expect(fetcher.fetch).toHaveBeenCalledWith(candidateRow.imageUrl, expect.any(Number));
      const [productId, file, dto] = products.addImage.mock.calls[0] as [string, { buffer: Buffer; mimetype: string; size: number }, Record<string, unknown>];
      expect(productId).toBe(PRODUCT);
      expect(file.buffer.equals(JPEG)).toBe(true);
      expect(file.mimetype).toBe("image/jpeg");
      expect(dto).toMatchObject({
        isPrimary: true,
        source: "shop.example.com",
        sourceUrl: "https://shop.example.com/p/1",
        altText: "Modi Shower Head",
      });
      expect(result.image).toBe(image);
      expect(result.candidate.status).toBe("approved");
    });

    it("does not make the new image primary when the product already has one", async () => {
      stubLoad();
      fetcher.fetch.mockResolvedValue({ buffer: JPEG, mimeType: "image/jpeg" });
      tx.query.productImages!.findFirst
        .mockResolvedValueOnce(undefined) // checksum lookup
        .mockResolvedValueOnce({ id: "existing-primary" }); // primary lookup
      products.addImage.mockResolvedValue({ id: "img2" });
      tx.update.mockReturnValue(chain([{ ...candidateRow, status: "approved" }]));

      await inContext(() => service.approve(CANDIDATE));
      expect(products.addImage.mock.calls[0]?.[2]).toMatchObject({ isPrimary: false });
    });

    it("refuses an image already attached to a DIFFERENT product (checksum dedup) without uploading", async () => {
      stubLoad();
      fetcher.fetch.mockResolvedValue({ buffer: JPEG, mimeType: "image/jpeg" });
      tx.query.productImages!.findFirst.mockResolvedValue({ id: "x", productId: OTHER_PRODUCT, checksum: CHECKSUM });

      await expect(inContext(() => service.approve(CANDIDATE))).rejects.toMatchObject({ code: ERROR_CODES.DUPLICATE_IMAGE });
      expect(products.addImage).not.toHaveBeenCalled();
    });

    it("heals a half-finished earlier approval: image already on THIS product -> just mark the candidate approved", async () => {
      stubLoad();
      fetcher.fetch.mockResolvedValue({ buffer: JPEG, mimeType: "image/jpeg" });
      const existing = { id: "x", productId: PRODUCT, checksum: CHECKSUM };
      tx.query.productImages!.findFirst.mockResolvedValue(existing);
      tx.update.mockReturnValue(chain([{ ...candidateRow, status: "approved" }]));

      const result = await inContext(() => service.approve(CANDIDATE));
      expect(products.addImage).not.toHaveBeenCalled();
      expect(result.image).toBe(existing);
    });

    it("propagates a fetch failure and leaves the candidate untouched", async () => {
      stubLoad();
      const { AppError } = await import("@devsfleet/shared-utils");
      fetcher.fetch.mockRejectedValue(new AppError(ERROR_CODES.IMAGE_URL_BLOCKED, "private"));

      await expect(inContext(() => service.approve(CANDIDATE))).rejects.toMatchObject({ code: ERROR_CODES.IMAGE_URL_BLOCKED });
      expect(tx.update).not.toHaveBeenCalled();
      expect(products.addImage).not.toHaveBeenCalled();
    });

    it("404s an unknown candidate and 409s an already-approved one, before any network call", async () => {
      tx.query.productImageCandidates!.findFirst.mockResolvedValue(undefined);
      await expect(inContext(() => service.approve(CANDIDATE))).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });

      stubLoad("approved");
      await expect(inContext(() => service.approve(CANDIDATE))).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
      expect(fetcher.fetch).not.toHaveBeenCalled();
    });
  });

  describe("reject", () => {
    it("rejectAll reports how many pending candidates it closed", async () => {
      tx.update.mockReturnValue(chain([{ id: "a" }, { id: "b" }, { id: "c" }]));
      await expect(inContext(() => service.rejectAll(PRODUCT))).resolves.toEqual({ rejected: 3 });
    });

    it("reject 404s when there is nothing to reject (unknown or already approved)", async () => {
      tx.update.mockReturnValue(chain([]));
      await expect(inContext(() => service.reject(CANDIDATE))).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
    });
  });
});
