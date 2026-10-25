import { describe, expect, it, vi } from "vitest";
import type { StorefrontScope } from "../../../common/context/request-context.js";
import type { TenantDatabase } from "../../../database/tenant-database.service.js";
import type { StorefrontCatalogService } from "../catalog/storefront-catalog.service.js";
import type { StorefrontResolver } from "../context/storefront-resolver.service.js";
import type { NotificationEnqueueService } from "../notifications/notification-enqueue.service.js";
import { backInStock, StockAlertsService } from "./stock-alerts.service.js";
import { SubscribeStockAlertSchema } from "./dto.js";

describe("backInStock", () => {
  const rows = [{ variantId: "a" }, { variantId: "b" }, { variantId: "c" }];

  it("keeps only variants whose storefront availability is no longer sold out", () => {
    const availability = new Map([
      ["a", { label: "OUT_OF_STOCK" as const }],
      ["b", { label: "LOW_STOCK" as const }],
      ["c", { label: "IN_STOCK" as const }],
    ]);
    expect(backInStock(rows, availability).map((r) => r.variantId)).toEqual(["b", "c"]);
  });

  it("does not fire for a variant the availability lookup did not return", () => {
    expect(backInStock(rows, new Map())).toEqual([]);
  });
});

describe("SubscribeStockAlertSchema", () => {
  const variantId = "11111111-1111-4111-8111-111111111111";

  it("lowercases the email so repeats collide on the unique index", () => {
    expect(SubscribeStockAlertSchema.parse({ variantId, email: "  Buyer@Example.COM " }).email).toBe("buyer@example.com");
  });

  it("treats an empty phone box as no phone", () => {
    expect(SubscribeStockAlertSchema.parse({ variantId, email: "a@b.co", phone: "" }).phone).toBeUndefined();
  });

  it("rejects a malformed phone and a malformed email", () => {
    expect(SubscribeStockAlertSchema.safeParse({ variantId, email: "a@b.co", phone: "12" }).success).toBe(false);
    expect(SubscribeStockAlertSchema.safeParse({ variantId, email: "nope" }).success).toBe(false);
  });
});

describe("StockAlertsService.sweep", () => {
  const TENANT = "11111111-1111-4111-8111-111111111111";
  const pending = (id: string, variantId: string) => ({ id, variantId, minStock: "0", tracked: true });

  function setup(opts: { pending: unknown[]; inStock: string[] }) {
    const order: string[] = [];
    const claimedIds: string[] = [];
    const chain = (rows: unknown[]) => {
      const q: Record<string, unknown> = {};
      for (const m of ["from", "innerJoin", "where"]) q[m] = () => q;
      q.limit = async () => rows;
      return q;
    };
    const tx = {
      select: () => chain(opts.pending),
      update: () => ({
        set: () => ({
          where: () => ({
            returning: async () => {
              order.push("claim");
              const rows = (opts.pending as Array<{ id: string; variantId: string }>).filter((p) => opts.inStock.includes(p.variantId)).map((p) => ({ id: p.id }));
              claimedIds.push(...rows.map((r) => r.id));
              return rows;
            },
          }),
        }),
      }),
    };
    const db = {
      runAsPlatformAdmin: async () => [{ tenantId: TENANT }],
      run: (fn: (t: unknown) => unknown) => fn(tx),
    } as unknown as TenantDatabase;
    const catalog = {
      listingContext: async () => ({}),
      availability: async (_tx: unknown, variants: Array<{ id: string }>) =>
        new Map(variants.map((v) => [v.id, { label: opts.inStock.includes(v.id) ? "IN_STOCK" : "OUT_OF_STOCK" }])),
    } as unknown as StorefrontCatalogService;
    const resolver = { forTenant: async () => ({ tenantId: TENANT, settings: {} }) as unknown as StorefrontScope } as unknown as StorefrontResolver;
    const enqueueStockAlert = vi.fn(async (_tx: unknown, id: string) => void order.push(`enqueue:${id}`));
    const svc = new StockAlertsService(db, catalog, resolver, { enqueueStockAlert } as unknown as NotificationEnqueueService);
    return { svc, enqueueStockAlert, order, claimedIds };
  }

  it("queues a message for each alert it claims, after claiming and in the same transaction", async () => {
    const { svc, enqueueStockAlert, order } = setup({ pending: [pending("s1", "v1"), pending("s2", "v2"), pending("s3", "v3")], inStock: ["v1", "v3"] });
    expect(await svc.sweep()).toBe(2);
    expect(enqueueStockAlert).toHaveBeenCalledTimes(2);
    expect(order).toEqual(["claim", "enqueue:s1", "enqueue:s3"]);
  });

  it("queues nothing while the product is still sold out", async () => {
    const { svc, enqueueStockAlert } = setup({ pending: [pending("s1", "v1")], inStock: [] });
    expect(await svc.sweep()).toBe(0);
    expect(enqueueStockAlert).not.toHaveBeenCalled();
  });
});
