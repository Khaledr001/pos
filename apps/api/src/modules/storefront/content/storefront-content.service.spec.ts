import { DEFAULT_STOREFRONT_SETTINGS, DEFAULT_TENANT_SETTINGS, resolveSiteFeatures, type HomeSection, type SiteSettings, type StorefrontSettings } from "@devsfleet/shared-types";
import { describe, expect, it } from "vitest";
import { RequestContext } from "../../../common/context/request-context.js";
import type { TenantDatabase } from "../../../database/tenant-database.service.js";
import type { StorefrontCatalogService } from "../catalog/storefront-catalog.service.js";
import { StorefrontContentService, visibleSections } from "./storefront-content.service.js";

const sections: HomeSection[] = [
  { id: "hero", type: "hero", enabled: true, settings: {} },
  { id: "cats", type: "categories", enabled: true, settings: {} },
  { id: "best", type: "products", enabled: true, settings: {} },
  { id: "off", type: "rich_text", enabled: false, settings: {} },
  { id: "text", type: "rich_text", enabled: true, settings: { body: "hi" } },
  { id: "unknown", type: "hologram", enabled: true, settings: {} } as unknown as HomeSection,
  { id: "form", type: "form", enabled: true, settings: { formSlug: "contact" } },
];

const features = (site: Partial<SiteSettings>) => resolveSiteFeatures({ ...DEFAULT_STOREFRONT_SETTINGS.site, ...site });

describe("visibleSections", () => {
  it("drops disabled sections and types this build does not know", () => {
    expect(visibleSections(sections, features({ mode: "shop" })).map((s) => s.id)).toEqual(["hero", "cats", "best", "text", "form"]);
  });

  it("drops the sections that need products on a site that has none, even if they were left in the list", () => {
    expect(visibleSections(sections, features({ mode: "showcase" })).map((s) => s.id)).toEqual(["hero", "text", "form"]);
  });

  it("keeps product sections on a catalogue site", () => {
    expect(visibleSections(sections, features({ mode: "catalogue" })).map((s) => s.id)).toContain("best");
  });

  it("copes with a page that has no sections", () => {
    expect(visibleSections(null, features({ mode: "shop" }))).toEqual([]);
  });
});

function setup(site: Partial<SiteSettings>, page?: Record<string, unknown>) {
  const calls: string[] = [];
  const settings: StorefrontSettings = { ...DEFAULT_STOREFRONT_SETTINGS, homeSections: sections, site: { ...DEFAULT_STOREFRONT_SETTINGS.site, ...site } };
  const tx = {
    query: {
      storefrontBanners: { findMany: async () => (calls.push("banners"), []) },
      brands: { findMany: async () => (calls.push("brands"), []) },
      storefrontPages: { findFirst: async () => page },
    },
    execute: async () => {
      calls.push("sql");
      return [];
    },
  };
  const catalog = {
    categoryTreeIn: async () => (calls.push("categories"), []),
    cardsWhere: async () => (calls.push("cards"), []),
  } as unknown as StorefrontCatalogService;
  const db = { run: async (fn: (t: unknown) => unknown) => fn(tx) } as unknown as TenantDatabase;
  const service = new StorefrontContentService(db, catalog);
  const scope = { id: "sf", tenantId: "t", name: "Shop", siteUrl: "https://shop.test", settings, tenantName: "T", tenantSettings: DEFAULT_TENANT_SETTINGS };
  const inShop = <T>(fn: () => T) => RequestContext.run({ requestId: "t", startedAt: 0, tenantId: "t", storefront: scope } as never, fn);
  return { service, calls, inShop };
}

describe("StorefrontContentService.home", () => {
  it("runs no catalogue queries for a site with no products, and drops the product sections", async () => {
    const { service, calls, inShop } = setup({ mode: "showcase" });
    const home = await inShop(() => service.home());
    expect(calls).toEqual(["banners"]);
    expect(home.categories).toEqual([]);
    expect(home.bestSellers).toEqual([]);
    expect(home.sections.map((s) => s.id)).toEqual(["hero", "text", "form"]);
  });

  it("runs the catalogue queries for a shop and a catalogue site", async () => {
    for (const mode of ["shop", "catalogue"] as const) {
      const { service, calls, inShop } = setup({ mode });
      await inShop(() => service.home());
      expect(calls).toEqual(expect.arrayContaining(["categories", "brands", "cards"]));
    }
  });
});

describe("StorefrontContentService.page", () => {
  const row = { id: "p1", slug: "about", title: "About", body: "", kind: "page", excerpt: null, coverImageUrl: null, isPublished: true, publishedAt: null, seoTitle: null, seoDescription: null, createdAt: new Date(), updatedAt: new Date(), layout: "full" };

  it("returns a section page's visible sections and its layout", async () => {
    const { service, inShop } = setup({ mode: "showcase" }, { ...row, sections });
    const page = await inShop(() => service.page("about"));
    expect(page.layout).toBe("full");
    expect(page.sections?.map((s) => s.id)).toEqual(["hero", "text", "form"]);
  });

  it("returns null sections for a plain text page, so the storefront renders its body", async () => {
    const { service, inShop } = setup({ mode: "shop" }, { ...row, sections: null, layout: "standard", body: "# Hello" });
    const page = await inShop(() => service.page("about"));
    expect(page.sections).toBeNull();
    expect(page.body).toBe("# Hello");
  });
});

describe("StorefrontContentService.store", () => {
  it("returns the site block and the features derived from it", () => {
    const { service, inShop } = setup({ mode: "catalogue", showPrices: false });
    const store = inShop(() => service.store());
    expect(store.site.mode).toBe("catalogue");
    expect(store.features).toMatchObject({ products: true, prices: false, cart: false, enquiries: true });
  });
});
