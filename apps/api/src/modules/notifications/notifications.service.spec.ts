import { ERROR_CODES } from "@devsfleet/shared-utils";
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequestContext } from "../../common/context/request-context.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import { NotificationsService } from "./notifications.service.js";

/**
 * TenantDatabase is stubbed, same as branches.service.spec.ts — RLS itself is
 * proven once in the integration suite, and the partial-unique-index dedupe
 * that `notify()` relies on is proven by the migration, not re-asserted here
 * against a mocked query builder.
 */
describe("NotificationsService", () => {
  let service: NotificationsService;
  let tx: Record<string, ReturnType<typeof vi.fn>>;

  const withUser = <T>(fn: () => T): T =>
    RequestContext.run(
      {
        requestId: "test",
        startedAt: Date.now(),
        tenantId: "11111111-1111-1111-1111-111111111111",
        branchId: null,
        user: {
          id: "22222222-2222-2222-2222-222222222222",
          tenantId: "11111111-1111-1111-1111-111111111111",
          branchId: null,
          roleId: "role-1",
          roleName: "cashier",
          permissions: [],
          abac: { allowedBranchIds: [] },
          isPlatformAdmin: false,
          planId: "trial",
          trialEndsAt: null,
        },
      },
      fn,
    );

  const insertChain = (returningValue: unknown[]) => {
    const chain = {
      values: vi.fn(() => chain),
      returning: vi.fn(() => Promise.resolve(returningValue)),
      onConflictDoUpdate: vi.fn(() => chain),
    };
    return chain;
  };

  beforeEach(async () => {
    tx = {
      update: vi.fn(),
      delete: vi.fn(),
      insert: vi.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: TenantDatabase,
          useValue: {
            run: (fn: (t: unknown) => unknown) => {
              RequestContext.requireTenantId();
              return fn(tx);
            },
            runAs: (_tenantId: string, fn: (t: unknown) => unknown) => fn(tx),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(NotificationsService);
  });

  describe("markRead", () => {
    it("raises NOT_FOUND rather than returning undefined for someone else's id", async () => {
      const chain = {
        set: vi.fn(() => chain),
        where: vi.fn(() => chain),
        returning: vi.fn(() => Promise.resolve([])),
      };
      tx.update.mockReturnValue(chain);

      await expect(withUser(() => service.markRead("missing"))).rejects.toMatchObject({
        code: ERROR_CODES.NOT_FOUND,
      });
    });

    it("returns the updated row when it belongs to the caller", async () => {
      const row = { id: "n1", isRead: true };
      const chain = {
        set: vi.fn(() => chain),
        where: vi.fn(() => chain),
        returning: vi.fn(() => Promise.resolve([row])),
      };
      tx.update.mockReturnValue(chain);

      const result = await withUser(() => service.markRead("n1"));
      expect(result).toEqual(row);
    });
  });

  describe("notify", () => {
    it("upserts on the dedupe key when a reference is given", async () => {
      const chain = insertChain([{ id: "n1", title: "Low stock" }]);
      tx.insert.mockReturnValue(chain);

      const result = await service.notify({
        tenantId: "11111111-1111-1111-1111-111111111111",
        userId: "22222222-2222-2222-2222-222222222222",
        type: "low_stock",
        title: "Low stock",
        message: "Ducab Cable is at 3, at or below the reorder point of 5 at Dubai.",
        referenceType: "product_variant",
        referenceId: "33333333-3333-3333-3333-333333333333",
      });

      expect(chain.onConflictDoUpdate).toHaveBeenCalled();
      expect(result).toEqual({ id: "n1", title: "Low stock" });
    });

    it("writes a plain insert with no dedupe key when there is no reference", async () => {
      const chain = insertChain([{ id: "n2", title: "System" }]);
      tx.insert.mockReturnValue(chain);

      await service.notify({
        tenantId: "11111111-1111-1111-1111-111111111111",
        userId: "22222222-2222-2222-2222-222222222222",
        type: "system",
        title: "System",
        message: "Your trial ends in 3 days.",
      });

      expect(chain.onConflictDoUpdate).not.toHaveBeenCalled();
    });
  });

  describe("request context", () => {
    it("refuses to list outside a request — every route here is self-scoped to the caller", async () => {
      // Not wrapped in withUser: list() reads the caller's own id before it
      // ever reaches the database, so this fails before requireTenantId even runs.
      await expect(service.list({ page: 1, limit: 25, unreadOnly: false })).rejects.toThrow(
        /No authenticated user in the request context/,
      );
    });
  });
});
