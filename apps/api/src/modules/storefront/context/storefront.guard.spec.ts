import { DEFAULT_STOREFRONT_SETTINGS, DEFAULT_TENANT_SETTINGS } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { Reflector } from "@nestjs/core";
import { describe, expect, it } from "vitest";
import { RequestContext, type StorefrontScope } from "../../../common/context/request-context.js";
import type { ShopperTokens } from "./shopper-tokens.service.js";
import { RequireShopper, StorefrontGuard } from "./storefront.guard.js";
import { normalizeHost, type StorefrontResolver } from "./storefront-resolver.service.js";

/**
 * The storefront's equivalent of JwtAuthGuard: the only place an anonymous
 * request acquires a tenant. Getting it wrong is a cross-tenant leak, so the
 * cases that matter are the ones where something does NOT happen.
 */
describe("StorefrontGuard", () => {
  const shopA: StorefrontScope = {
    id: "sf-a",
    tenantId: "tenant-a",
    name: "Shop A",
    siteUrl: "https://shop-a.example",
    settings: DEFAULT_STOREFRONT_SETTINGS,
    tenantName: "A",
    tenantSettings: DEFAULT_TENANT_SETTINGS,
  };

  const resolver = {
    resolve: async (host: string | undefined) => (normalizeHost(host) === "shop-a.example" ? shopA : null),
  } as unknown as StorefrontResolver;

  /** Tokens: "a" verifies as a shopper of tenant A, "b" as one of tenant B, anything else fails. */
  const tokens = {
    verifyAccess: async (token: string) =>
      token === "a"
        ? { accountId: "acct-a", customerId: "cust-a", tenantId: "tenant-a" }
        : token === "b"
          ? { accountId: "acct-b", customerId: "cust-b", tenantId: "tenant-b" }
          : null,
  } as unknown as ShopperTokens;

  const guard = new StorefrontGuard(resolver, tokens, new Reflector());

  const contextFor = (headers: Record<string, string>, requireShopper = false) => {
    class Decorated {
      handler() {}
    }
    if (requireShopper) RequireShopper()(Decorated);
    return {
      getHandler: () => Decorated.prototype.handler,
      getClass: () => Decorated,
      switchToHttp: () => ({ getRequest: () => ({ headers }) }),
    } as never;
  };

  const run = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ requestId: "test", startedAt: Date.now() }, async () => {
      const result = await fn();
      return { result, store: RequestContext.get()! };
    });

  it("scopes the request to the tenant the host resolves to", async () => {
    const { store } = await run(() => guard.canActivate(contextFor({ host: "Shop-A.example:443" })));
    expect(store.tenantId).toBe("tenant-a");
    expect(store.storefront?.id).toBe("sf-a");
  });

  it("refuses a host no storefront answers on, without a tenant", async () => {
    await expect(run(() => guard.canActivate(contextFor({ host: "unknown.example" })))).rejects.toMatchObject({
      code: ERROR_CODES.STOREFRONT_NOT_FOUND,
    });
  });

  it("prefers the storefront's forwarded host over the API's own", async () => {
    const { store } = await run(() =>
      guard.canActivate(contextFor({ host: "api.internal:3001", "x-storefront-host": "shop-a.example" })),
    );
    expect(store.tenantId).toBe("tenant-a");
  });

  it("attaches a shopper whose token belongs to this tenant", async () => {
    const { store } = await run(() => guard.canActivate(contextFor({ host: "shop-a.example", cookie: "sf_at=a" })));
    expect(store.shopper).toEqual({ accountId: "acct-a", customerId: "cust-a" });
  });

  it("ignores a valid shopper token issued by ANOTHER tenant's shop", async () => {
    const { store } = await run(() => guard.canActivate(contextFor({ host: "shop-a.example", cookie: "sf_at=b" })));
    expect(store.shopper).toBeUndefined();
    expect(store.tenantId).toBe("tenant-a");
  });

  it("treats a bad token as a guest on an open route", async () => {
    const { result, store } = await run(() =>
      guard.canActivate(contextFor({ host: "shop-a.example", cookie: "other=1; sf_at=forged" })),
    );
    expect(result).toBe(true);
    expect(store.shopper).toBeUndefined();
  });

  it("refuses a guest on a route that needs a shopper", async () => {
    const attempt = run(() => guard.canActivate(contextFor({ host: "shop-a.example", cookie: "sf_at=b" }, true)));
    await expect(attempt).rejects.toBeInstanceOf(AppError);
    await expect(attempt).rejects.toMatchObject({ code: ERROR_CODES.SHOPPER_AUTH_REQUIRED });
  });
});

describe("normalizeHost", () => {
  it.each([
    ["Shop.Example.AE", "shop.example.ae"],
    ["shop.example.ae:8443", "shop.example.ae"],
    ["shop.example.ae.", "shop.example.ae"],
    ["shop.example.ae, proxy.internal", "shop.example.ae"],
    ["[::1]:3000", "[::1]"],
  ])("%s -> %s", (raw, expected) => {
    expect(normalizeHost(raw)).toBe(expected);
  });

  it("rejects an empty host", () => {
    expect(normalizeHost("")).toBeNull();
    expect(normalizeHost(undefined)).toBeNull();
  });
});
