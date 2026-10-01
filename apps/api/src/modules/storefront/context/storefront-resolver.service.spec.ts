import { describe, expect, it } from "vitest";
import type { TenantDatabase } from "../../../database/tenant-database.service.js";
import { StorefrontResolver } from "./storefront-resolver.service.js";

/**
 * Which tenants may sell online. Every "no" here is a shop window that must
 * stay dark: a suspended business, a lapsed trial, a plan without the feature.
 */
describe("StorefrontResolver", () => {
  const row = (overrides: Record<string, unknown> = {}) => ({
    id: "sf-1",
    tenantId: "tenant-1",
    name: "Shop",
    settings: {},
    isActive: true,
    tenantName: "Tenant",
    tenantSettings: {},
    tenantActive: true,
    tenantDeletedAt: null,
    suspendedAt: null,
    planId: "pro",
    trialEndsAt: null,
    domain: "shop.example",
    ...overrides,
  });

  /** A TenantDatabase whose platform-admin query returns `rows`, counting calls. */
  const dbReturning = (rows: unknown[]) => {
    const calls = { count: 0 };
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "from", "innerJoin", "leftJoin", "where", "orderBy", "$dynamic"]) chain[method] = () => chain;
    chain.limit = async () => rows;
    const db = {
      runAsPlatformAdmin: async (fn: (tx: unknown) => Promise<unknown>) => {
        calls.count++;
        return fn(chain);
      },
    } as unknown as TenantDatabase;
    return { db, calls };
  };

  it("resolves an active storefront with defaults filled in", async () => {
    const { db } = dbReturning([row()]);
    const found = await new StorefrontResolver(db).resolve("shop.example");
    expect(found?.tenantId).toBe("tenant-1");
    expect(found?.settings.checkout.cod.enabled).toBe(true);
    expect(found?.tenantSettings.tax.defaultRate).toBe(5);
  });

  it.each([
    ["the storefront is switched off", { isActive: false }],
    ["the tenant is inactive", { tenantActive: false }],
    ["the tenant is deleted", { tenantDeletedAt: new Date() }],
    ["the tenant is suspended", { suspendedAt: new Date() }],
    ["the plan has no online store", { planId: "starter" }],
    ["the plan id is unknown (fails closed to free)", { planId: "platinum" }],
    ["the trial has ended", { planId: "trial", trialEndsAt: new Date(Date.now() - 1000) }],
  ])("stays dark when %s", async (_label, overrides) => {
    const { db } = dbReturning([row(overrides)]);
    expect(await new StorefrontResolver(db).resolve("shop.example")).toBeNull();
  });

  it("serves a live trial", async () => {
    const { db } = dbReturning([row({ planId: "trial", trialEndsAt: new Date(Date.now() + 86_400_000) })]);
    expect(await new StorefrontResolver(db).resolve("shop.example")).not.toBeNull();
  });

  it("caches by normalised host, and drops a tenant's entries on invalidate", async () => {
    const { db, calls } = dbReturning([row()]);
    const resolver = new StorefrontResolver(db);
    await resolver.resolve("Shop.Example:443");
    await resolver.resolve("shop.example");
    expect(calls.count).toBe(1);

    resolver.invalidateTenant("tenant-1");
    await resolver.resolve("shop.example");
    expect(calls.count).toBe(2);
  });

  it("does not query for a missing host", async () => {
    const { db, calls } = dbReturning([row()]);
    expect(await new StorefrontResolver(db).resolve(undefined)).toBeNull();
    expect(calls.count).toBe(0);
  });
});
