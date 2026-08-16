import { ERROR_CODES } from "@devsfleet/shared-utils";
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequestContext } from "../../common/context/request-context.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import { BranchesService } from "./branches.service.js";

/**
 * REFERENCE MODULE — unit test
 *
 * TenantDatabase is stubbed so `run()` hands the callback a fake transaction.
 * That keeps these tests fast and dependency-free; the fact that RLS actually
 * isolates tenants is proven once, in the integration suite, rather than
 * re-asserted in every service test.
 *
 * `RequestContext.run` wraps each case because the service reads the tenant
 * from AsyncLocalStorage — the same way it does in production.
 */
describe("BranchesService", () => {
  let service: BranchesService;
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
      query: { branches: { findFirst: vi.fn() } } as never,
      insert: vi.fn(),
      update: vi.fn(),
      select: vi.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        BranchesService,
        {
          provide: TenantDatabase,
          useValue: {
            run: (fn: (t: unknown) => unknown) => {
              // Mirrors the real thing: refuse to run without a tenant.
              RequestContext.requireTenantId();
              return fn(tx);
            },
          },
        },
      ],
    }).compile();

    service = moduleRef.get(BranchesService);
  });

  describe("findById", () => {
    it("returns the branch when it exists", async () => {
      const branch = { id: "b1", name: "Dubai", code: "DXB" };
      (tx.query as never as { branches: { findFirst: ReturnType<typeof vi.fn> } }).branches.findFirst.mockResolvedValue(
        branch,
      );

      const result = await withContext(() => service.findById("b1"));
      expect(result).toEqual(branch);
    });

    it("raises NOT_FOUND rather than returning undefined", async () => {
      (tx.query as never as { branches: { findFirst: ReturnType<typeof vi.fn> } }).branches.findFirst.mockResolvedValue(
        undefined,
      );

      await expect(withContext(() => service.findById("missing"))).rejects.toMatchObject({
        code: ERROR_CODES.NOT_FOUND,
      });
    });
  });

  describe("update", () => {
    it("short-circuits an empty patch without touching the database", async () => {
      const branch = { id: "b1", name: "Dubai" };
      (tx.query as never as { branches: { findFirst: ReturnType<typeof vi.fn> } }).branches.findFirst.mockResolvedValue(
        branch,
      );

      const result = await withContext(() => service.update("b1", {}));

      expect(result).toEqual(branch);
      expect(tx.update).not.toHaveBeenCalled();
    });
  });

  describe("tenant context", () => {
    it("refuses to query when no tenant is in scope", async () => {
      // Not wrapped in withContext — this is the failure mode the guard exists for.
      await expect(service.findById("b1")).rejects.toThrow(/No tenant in the request context/);
    });
  });
});
