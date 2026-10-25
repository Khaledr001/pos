import { DEFAULT_STOREFRONT_SETTINGS, DEFAULT_TENANT_SETTINGS, resolveStorefrontSettings, type SiteMode, type StorefrontSettings } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { Reflector } from "@nestjs/core";
import { describe, expect, it } from "vitest";
import { RequestContext, type StorefrontScope } from "../../../common/context/request-context.js";
import { AccountController } from "../account/account.controller.js";
import { ShopperAuthController } from "../account/shopper-auth.controller.js";
import { CartController } from "../cart/cart.controller.js";
import { StorefrontCatalogController } from "../catalog/storefront-catalog.controller.js";
import { CheckoutController } from "../checkout/checkout.controller.js";
import { StorefrontContentController } from "../content/storefront-content.controller.js";
import { FormsController } from "../forms/forms.controller.js";
import { WebOrdersController } from "../orders/web-orders.controller.js";
import { QuotesController } from "../quotes/quotes.controller.js";
import { StockAlertsController } from "../stock-alerts/stock-alerts.controller.js";
import { assertSiteFeature, siteFeatures } from "./site-features.js";
import { REQUIRE_FEATURE_KEY, StorefrontGuard } from "./storefront.guard.js";
import type { ShopperTokens } from "./shopper-tokens.service.js";
import type { StorefrontResolver } from "./storefront-resolver.service.js";

const scope = (settings: StorefrontSettings): StorefrontScope => ({
  id: "sf-1",
  tenantId: "tenant-1",
  name: "Shop",
  siteUrl: "https://shop.test",
  settings,
  tenantName: "T",
  tenantSettings: DEFAULT_TENANT_SETTINGS,
});

const withSite = (mode: SiteMode, overrides: Partial<StorefrontSettings["site"]> = {}): StorefrontSettings => ({
  ...DEFAULT_STOREFRONT_SETTINGS,
  site: { ...DEFAULT_STOREFRONT_SETTINGS.site, mode, ...overrides },
});

const inRequest = <T>(settings: StorefrontSettings, fn: () => T) =>
  RequestContext.run({ requestId: "t", startedAt: 0, tenantId: "tenant-1", storefront: scope(settings) } as never, fn);

const tokens = { verifyAccess: async () => null } as unknown as ShopperTokens;

/** Runs the real guard against a real controller method, the way Nest would. */
async function reach(settings: StorefrontSettings, controller: new (...args: never[]) => object, method: string) {
  const resolver = { resolve: async () => scope(settings) } as unknown as StorefrontResolver;
  const guard = new StorefrontGuard(resolver, tokens, new Reflector());
  const proto = controller.prototype as Record<string, unknown>;
  const context = {
    getHandler: () => proto[method],
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => ({ headers: { host: "shop.test" } }) }),
  } as never;
  return RequestContext.run({ requestId: "t", startedAt: 0 }, () => guard.canActivate(context));
}

const refused = (promise: Promise<unknown>) => expect(promise).rejects.toMatchObject({ code: ERROR_CODES.STORE_FEATURE_DISABLED });

describe("site features", () => {
  it("treats a store saved before sites had a mode as a shop, with every commerce feature on", () => {
    const old = resolveStorefrontSettings({ tagline: "Hello" });
    expect(old.site.mode).toBe("shop");
    inRequest(old, () => {
      expect(siteFeatures()).toMatchObject({ products: true, prices: true, cart: true, checkout: true, accounts: true, tracking: true, stockAlerts: true, search: true });
    });
  });

  it("asserts any number of features and names none of them in the error", () => {
    inRequest(withSite("catalogue"), () => {
      expect(() => assertSiteFeature("products", "search")).not.toThrow();
      try {
        assertSiteFeature("products", "cart");
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).code).toBe(ERROR_CODES.STORE_FEATURE_DISABLED);
        expect((error as AppError).message).toBe("That is not available on this site.");
      }
    });
  });
});

describe("the guard enforces the site's mode on every commerce route", () => {
  const commerce: [string, new (...args: never[]) => object, string][] = [
    ["cart", CartController, "get"],
    ["checkout quote", CheckoutController, "quote"],
    ["checkout place", CheckoutController, "place"],
    ["shopper login", ShopperAuthController, "login"],
    ["account", AccountController, "updateProfile"],
    ["quotes", QuotesController, "list"],
    ["order tracking", WebOrdersController, "track"],
    ["stock alert subscribe", StockAlertsController, "subscribe"],
  ];

  it.each(commerce)("a catalogue site refuses %s", async (_name, controller, method) => {
    expect(typeof (controller.prototype as Record<string, unknown>)[method]).toBe("function");
    await refused(reach(withSite("catalogue"), controller, method));
  });

  it.each(commerce)("a company site refuses %s", async (_name, controller, method) => {
    await refused(reach(withSite("showcase"), controller, method));
  });

  it("a shop allows them (a shopper-only route would then ask for a sign-in, a different error)", async () => {
    for (const [, controller, method] of commerce.filter(([n]) => !["account", "quotes"].includes(n))) {
      await expect(reach(withSite("shop"), controller, method)).resolves.toBe(true);
    }
    await expect(reach(withSite("shop"), AccountController, "updateProfile")).rejects.toMatchObject({ code: ERROR_CODES.SHOPPER_AUTH_REQUIRED });
  });

  it("refuses before it asks who the shopper is: a signed-out visitor to a disabled route gets the neutral 404", async () => {
    await refused(reach(withSite("catalogue"), AccountController, "updateProfile"));
  });

  it("keeps the catalogue open on a catalogue site and shut on a company site", async () => {
    for (const method of ["categories", "category", "brands", "brand", "products", "product", "prices"]) {
      await expect(reach(withSite("catalogue"), StorefrontCatalogController, method)).resolves.toBe(true);
      await refused(reach(withSite("showcase"), StorefrontCatalogController, method));
    }
  });

  it("gates suggest on search as well as products", async () => {
    await expect(reach(withSite("catalogue"), StorefrontCatalogController, "suggest")).resolves.toBe(true);
    await refused(reach(withSite("catalogue", { features: { search: false, account: false } }), StorefrontCatalogController, "suggest"));
    await expect(reach(withSite("shop", { features: { search: false, account: true } }), StorefrontCatalogController, "products")).resolves.toBe(true);
  });

  it("turns accounts off in a shop that disabled them", async () => {
    await refused(reach(withSite("shop", { features: { search: true, account: false } }), ShopperAuthController, "login"));
  });

  it("always serves content and forms, whatever the mode", async () => {
    for (const mode of ["shop", "catalogue", "showcase"] as const) {
      for (const method of ["home", "store", "branches", "page", "blog"]) {
        await expect(reach(withSite(mode), StorefrontContentController, method)).resolves.toBe(true);
      }
      await expect(reach(withSite(mode), FormsController, "get")).resolves.toBe(true);
      await expect(reach(withSite(mode), FormsController, "submit")).resolves.toBe(true);
    }
  });

  it("keeps unsubscribe links working after a shop changes mode", async () => {
    for (const method of ["unsubscribe", "unsubscribePage", "confirmUnsubscribe"]) {
      await expect(reach(withSite("showcase"), StockAlertsController, method)).resolves.toBe(true);
    }
  });
});

describe("which routes declare which feature", () => {
  const reflector = new Reflector();
  const needed = (controller: new (...args: never[]) => object, method: string) =>
    reflector.getAllAndMerge<string[]>(REQUIRE_FEATURE_KEY, [(controller.prototype as Record<string, never>)[method], controller]) ?? [];

  it.each([
    [CartController, "get", ["cart"]],
    [CheckoutController, "place", ["checkout"]],
    [ShopperAuthController, "register", ["accounts"]],
    [AccountController, "updateProfile", ["accounts"]],
    [QuotesController, "create", ["accounts"]],
    [WebOrdersController, "track", ["tracking"]],
    [StockAlertsController, "subscribe", ["stockAlerts"]],
    [StorefrontCatalogController, "product", ["products"]],
    [StorefrontCatalogController, "suggest", ["products", "search"]],
    [StockAlertsController, "unsubscribe", []],
    [StorefrontContentController, "home", []],
    [FormsController, "submit", []],
  ] as [new (...args: never[]) => object, string, string[]][])("%s.%s needs %j", (controller, method, expected) => {
    expect([...needed(controller, method)].sort()).toEqual([...expected].sort());
  });
});
