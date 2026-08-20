import { ERROR_CODES } from "@devsfleet/shared-utils";
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequestContext } from "../../common/context/request-context.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import { AttributeDefinitionsService } from "./attribute-definitions.service.js";

describe("AttributeDefinitionsService", () => {
  let service: AttributeDefinitionsService;
  let tx: Record<string, ReturnType<typeof vi.fn>>;

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
    tx = {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AttributeDefinitionsService,
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

    service = moduleRef.get(AttributeDefinitionsService);
  });

  describe("create", () => {
    it("stores allowedValues only for a select attribute", async () => {
      const created = { id: "a1" };
      const values = vi.fn(() => ({ returning: vi.fn(async () => [created]) }));
      tx.insert.mockReturnValue({ values });

      await withContext(() =>
        service.create({
          categoryId: "cat-1",
          name: "size",
          label: "Size",
          type: "text",
          allowedValues: ["should", "be", "dropped"],
          sortOrder: 0,
        }),
      );

      expect(values).toHaveBeenCalledWith(expect.objectContaining({ allowedValues: null }));
    });

    it("keeps allowedValues for a select attribute", async () => {
      const created = { id: "a1" };
      const values = vi.fn(() => ({ returning: vi.fn(async () => [created]) }));
      tx.insert.mockReturnValue({ values });

      await withContext(() =>
        service.create({
          categoryId: "cat-1",
          name: "sheen",
          label: "Sheen",
          type: "select",
          allowedValues: ["matte", "gloss"],
          sortOrder: 0,
        }),
      );

      expect(values).toHaveBeenCalledWith(expect.objectContaining({ allowedValues: ["matte", "gloss"] }));
    });
  });

  describe("remove", () => {
    it("refuses to delete a definition still carrying values", async () => {
      tx.select.mockReturnValue({
        from: vi.fn(() => ({ where: vi.fn(async () => [{ value: 3 }]) })),
      });

      await expect(withContext(() => service.remove("a1"))).rejects.toMatchObject({
        code: ERROR_CODES.CONFLICT,
      });
      expect(tx.delete).not.toHaveBeenCalled();
    });

    it("deletes a definition with no recorded values", async () => {
      tx.select.mockReturnValue({
        from: vi.fn(() => ({ where: vi.fn(async () => [{ value: 0 }]) })),
      });
      tx.delete.mockReturnValue({
        where: vi.fn(() => ({ returning: vi.fn(async () => [{ id: "a1" }]) })),
      });

      await expect(withContext(() => service.remove("a1"))).resolves.toBeUndefined();
      expect(tx.delete).toHaveBeenCalled();
    });

    it("raises NOT_FOUND for an id that does not exist", async () => {
      tx.select.mockReturnValue({
        from: vi.fn(() => ({ where: vi.fn(async () => [{ value: 0 }]) })),
      });
      tx.delete.mockReturnValue({
        where: vi.fn(() => ({ returning: vi.fn(async () => []) })),
      });

      await expect(withContext(() => service.remove("missing"))).rejects.toMatchObject({
        code: ERROR_CODES.NOT_FOUND,
      });
    });
  });
});
