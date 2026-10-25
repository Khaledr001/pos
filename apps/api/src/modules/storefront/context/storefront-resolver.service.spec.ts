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

  describe("headless access", () => {
    const headless = (overrides: Record<string, unknown> = {}) =>
      row({ settings: { headless: { enabled: true, allowedOrigins: ["https://app.example.com"] } }, ...overrides });

    it("allows a listed origin on a live shop whose plan has API access", async () => {
      const { db } = dbReturning([headless()]);
      expect(await new StorefrontResolver(db).headlessAllows("Shop.Example", "https://app.example.com")).toBe(true);
    });

    it.each([
      ["the origin is not listed", headless(), "https://other.example.com"],
      ["headless is off", headless({ settings: { headless: { enabled: false, allowedOrigins: ["https://app.example.com"] } } }), "https://app.example.com"],
      ["the plan has no API access", headless({ planId: "trial", trialEndsAt: new Date(Date.now() + 86_400_000) }), "https://app.example.com"],
      ["the shop is suspended", headless({ suspendedAt: new Date() }), "https://app.example.com"],
    ])("refuses when %s", async (_label, found, origin) => {
      const { db } = dbReturning([found]);
      expect(await new StorefrontResolver(db).headlessAllows("shop.example", origin)).toBe(false);
    });

    it("refuses with no host, without querying", async () => {
      const { db, calls } = dbReturning([headless()]);
      expect(await new StorefrontResolver(db).headlessAllows(undefined, "https://app.example.com")).toBe(false);
      expect(calls.count).toBe(0);
    });

    it("answers a preflight for an origin any live shop lists, cached, and forgets on invalidate", async () => {
      const { db, calls } = dbReturning([headless()]);
      const resolver = new StorefrontResolver(db);
      expect(await resolver.originAllowedAnywhere("https://app.example.com")).toBe(true);
      expect(await resolver.originAllowedAnywhere("https://app.example.com")).toBe(true);
      expect(calls.count).toBe(1);
      resolver.invalidateTenant("tenant-1");
      await resolver.originAllowedAnywhere("https://app.example.com");
      expect(calls.count).toBe(2);
    });

    it("refuses a preflight when the matching shop is dark", async () => {
      const { db } = dbReturning([headless({ isActive: false })]);
      expect(await new StorefrontResolver(db).originAllowedAnywhere("https://app.example.com")).toBe(false);
    });
  });
});
