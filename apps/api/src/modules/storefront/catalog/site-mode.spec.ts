import { DEFAULT_STOREFRONT_SETTINGS, DEFAULT_TENANT_SETTINGS, type SiteSettings, type StorefrontSettings } from "@devsfleet/shared-types";
import { ERROR_CODES } from "@devsfleet/shared-utils";
import { describe, expect, it } from "vitest";
import { RequestContext } from "../../../common/context/request-context.js";
import type { TenantDatabase } from "../../../database/tenant-database.service.js";
import type { StorefrontPricing } from "../pricing/storefront-pricing.service.js";
import type { ListProductsDto } from "./dto.js";
import { StorefrontCatalogService } from "./storefront-catalog.service.js";

const settings = (site: Partial<SiteSettings>): StorefrontSettings => ({
  ...DEFAULT_STOREFRONT_SETTINGS,
  site: { ...DEFAULT_STOREFRONT_SETTINGS.site, ...site },
});

const inShop = <T>(s: StorefrontSettings, fn: () => T) =>
  RequestContext.run(
    {
      requestId: "t",
      startedAt: 0,
      tenantId: "tenant-1",
      storefront: { id: "sf", tenantId: "tenant-1", name: "Shop", siteUrl: "https://shop.test", settings: s, tenantName: "T", tenantSettings: DEFAULT_TENANT_SETTINGS },
    } as never,
    fn,
  );

/** A database that must never be touched: the point of these cases is that the answer comes first. */
const noDb = { run: async () => { throw new Error("the database should not be reached"); } } as unknown as TenantDatabase;

const catalogue = (showPrices: boolean) => settings({ mode: "catalogue", showPrices });
const baseQuery: ListProductsDto = { page: 1, pageSize: 24 };

describe("catalogue price hiding", () => {
  it("answers the prices endpoint with nothing, without reading a price", async () => {
    const service = new StorefrontCatalogService(noDb, {} as StorefrontPricing);
    expect(await inShop(catalogue(false), () => service.prices(["SKU-1", "SKU-2"]))).toEqual({});
  });

  it("refuses a text search on a site that turned search off", async () => {
    const service = new StorefrontCatalogService(noDb, {} as StorefrontPricing);
    const off = settings({ mode: "catalogue", features: { search: false, account: false } });
    await expect(inShop(off, () => service.listProducts({ ...baseQuery, q: "tap" }))).rejects.toMatchObject({ code: ERROR_CODES.STORE_FEATURE_DISABLED });
  });

  /** One published product with a net "from" price, through the real card builder. */
  async function cardsFor(s: StorefrontSettings) {
    const tx = {
      query: { branches: { findMany: async () => [] } },
      execute: async () => [
        {
          id: "p1",
          slug: "mixer-tap",
          name: "Mixer tap",
          brand_slug: null,
          brand_name: null,
          image_url: null,
          image_alt: null,
          base_uom: "pc",
          variant_count: 1,
          pickup_only: false,
          tax_rate: "5",
          net_from: "100.0000",
          in_stock: true,
        },
      ],
    };
    const pricing = { defaultListId: async () => "list-1" } as unknown as StorefrontPricing;
    const service = new StorefrontCatalogService({} as TenantDatabase, pricing);
    return inShop(s, () => service.productCards(tx as never, ["p1"]));
  }

  it("shows a card's price when prices are on", async () => {
    const [card] = await cardsFor(catalogue(true));
    expect(card!.fromPrice).not.toBeNull();
    expect(card!.fromPrice!.amount).toBe("105.00");
  });

  it("sends a card with no price when they are hidden, and nothing price-shaped anywhere in it", async () => {
    const [card] = await cardsFor(catalogue(false));
    expect(card!.fromPrice).toBeNull();
    const json = JSON.stringify(card);
    expect(json).not.toMatch(/105|100\.0|fils|amount/);
  });

  it("hides prices for a shop too if its owner is in catalogue mode only — a shop always shows them", async () => {
    const [card] = await cardsFor(settings({ mode: "shop", showPrices: false }));
    expect(card!.fromPrice).not.toBeNull();
  });
});
