import { schema } from "@devsfleet/db";
import { DEFAULT_STOREFRONT_SETTINGS, resolveSiteFeatures, resolveStorefrontSettings, SITE_TEMPLATES, type SiteTemplateId, type StorefrontSettings } from "@devsfleet/shared-types";
import { describe, expect, it } from "vitest";
import { RequestContext } from "../../../common/context/request-context.js";
import type { TenantDatabase } from "../../../database/tenant-database.service.js";
import type { StorefrontResolver } from "../context/storefront-resolver.service.js";
import { SettingsAdminService } from "./settings-admin.service.js";
import { SiteAdminService } from "./site-admin.service.js";
import type { ApplyTemplateDto } from "./site.dto.js";

type FindArg = { where?: (t: unknown, ops: unknown) => unknown };

/** The service names a row by running Drizzle's `where` callback; run it against a recorder to read the slug back. */
function slugFrom(arg?: FindArg): string {
  let slug = "";
  arg?.where?.({ slug: "slug", isActive: "isActive" }, { eq: (column: string, value: string) => { if (column === "slug") slug = value; return value; }, and: (...parts: unknown[]) => parts });
  return slug;
}

interface Seed {
  settings?: Partial<StorefrontSettings>;
  forms?: string[];
  pages?: { slug: string; kind?: string; id?: string }[];
  businessEmail?: string;
  noStorefront?: boolean;
}

/** The service over a fake transaction that records what was inserted and updated, per table. */
function setup(seed: Seed = {}) {
  const forms = new Map<string, Record<string, unknown>>((seed.forms ?? []).map((slug) => [slug, { slug, isActive: true }]));
  const pages = new Map<string, Record<string, unknown>>((seed.pages ?? []).map((p) => [p.slug, { id: p.id ?? `id-${p.slug}`, kind: "page", publishedAt: null, ...p }]));
  const writes = { forms: [] as Record<string, unknown>[], pagesInserted: [] as Record<string, unknown>[], pagesUpdated: [] as Record<string, unknown>[], settings: [] as StorefrontSettings[] };
  let stored: unknown = { checkout: { ...DEFAULT_STOREFRONT_SETTINGS.checkout, deliveryVariantId: "v1" }, ...seed.settings };

  const tx = {
    query: {
      storefronts: { findFirst: async () => (seed.noStorefront ? undefined : { id: "sf-1", name: "Shop", isActive: true, settings: stored }) },
      tenants: { findFirst: async () => ({ planId: "pro", name: "T", settings: { ...(seed.businessEmail ? { email: seed.businessEmail } : {}) } }) },
      storefrontDomains: { findMany: async () => [] },
      storefrontPaymentAccounts: { findFirst: async () => undefined },
      storefrontForms: {
        findMany: async () => [...forms.values()],
        // assertSiteConsistent looks a form up by slug among the active ones.
        findFirst: async (arg?: FindArg) => {
          const found = forms.get(slugFrom(arg));
          return found?.isActive ? found : undefined;
        },
      },
      storefrontPages: { findFirst: async (arg?: FindArg) => pages.get(slugFrom(arg)) },
    },
    insert: (table: unknown) => ({
      values: async (v: Record<string, unknown>) => {
        if (table === schema.storefrontForms) {
          writes.forms.push(v);
          forms.set(String(v.slug), { ...v, isActive: true });
        } else if (table === schema.storefrontPages) {
          writes.pagesInserted.push(v);
          pages.set(String(v.slug), { ...v, id: `id-${String(v.slug)}` });
        }
      },
    }),
    update: (table: unknown) => ({
      set: (v: Record<string, unknown>) => ({
        where: async () => {
          if (table === schema.storefronts) {
            writes.settings.push(v.settings as StorefrontSettings);
            stored = v.settings;
          } else if (table === schema.storefrontPages) writes.pagesUpdated.push(v);
        },
      }),
    }),
  };
  const db = { run: async (fn: (t: unknown) => unknown) => fn(tx) } as unknown as TenantDatabase;
  const resolver = { invalidateTenant: () => undefined } as unknown as StorefrontResolver;
  const config = { get: () => undefined } as never;
  const settingsService = new SettingsAdminService(db, resolver, config);
  const service = new SiteAdminService(db, resolver, settingsService);

  const apply = (template: SiteTemplateId, over: Partial<ApplyTemplateDto> = {}) =>
    RequestContext.run({ requestId: "t", startedAt: 0, tenantId: "tenant-1" } as never, () =>
      service.applyTemplate({ template, applyTheme: false, applyContent: true, createPages: true, createForms: true, overwritePages: false, ...over }),
    );
  return { apply, writes, forms, pages, latest: () => resolveStorefrontSettings(stored) };
}

describe("SiteAdminService.applyTemplate", () => {
  it("starts a company site: mode, layout, navigation, home sections, pages and forms", async () => {
    const { apply, writes, latest } = setup({ businessEmail: "owner@acme.test" });
    const result = await apply("corporate");
    const t = SITE_TEMPLATES.corporate;

    expect(latest().site).toMatchObject({ template: "corporate", mode: "showcase" });
    expect(resolveSiteFeatures(latest().site)).toMatchObject({ products: false, cart: false });
    expect(latest().theme.layout).toMatchObject({ header: "simple", footer: "dark" });
    expect(latest().navigation.header.map((l) => l.label)).toEqual(t.navigation.header.map((l) => l.label));
    expect(latest().homeSections.map((s) => s.id)).toEqual(t.homeSections.map((s) => s.id));

    expect(result.applied.pagesCreated.sort()).toEqual(t.pages.map((p) => p.slug).sort());
    expect(writes.pagesInserted.every((p) => p.isPublished === true && p.kind === "page" && p.body === "")).toBe(true);
    expect(writes.pagesInserted.find((p) => p.slug === "about")).toMatchObject({ layout: "full", tenantId: "tenant-1" });
    expect(result.applied.formsCreated).toEqual(["contact"]);
    // Someone has to hear about the first enquiry.
    expect(writes.forms[0]!.notifyEmails).toEqual(["owner@acme.test"]);
  });

  it("starts a catalogue: creates the enquiry form first, so the mode check passes", async () => {
    const { apply, latest } = setup();
    const result = await apply("catalogue");
    expect(result.applied.formsCreated.sort()).toEqual(["contact", "product-enquiry"]);
    expect(latest().site).toMatchObject({ mode: "catalogue", enquiry: { form: true, formSlug: "product-enquiry" } });
    expect(latest().site.headerCta?.href).toBe("/pages/contact");
  });

  it("refuses a catalogue whose enquiry form was not created and does not exist", async () => {
    const { apply, writes } = setup();
    await expect(apply("catalogue", { createForms: false })).rejects.toThrow(/enquiry form/);
    expect(writes.settings).toHaveLength(0);
  });

  it("accepts a catalogue with createForms off when the form already exists", async () => {
    const { apply, latest } = setup({ forms: ["product-enquiry"] });
    await apply("catalogue", { createForms: false });
    expect(latest().site.mode).toBe("catalogue");
  });

  it("goes back to a shop and drops the header button", async () => {
    const { apply, latest } = setup({ settings: { site: { ...DEFAULT_STOREFRONT_SETTINGS.site, mode: "showcase", headerCta: { label: "Hi", href: "/pages/contact" } } } });
    await apply("shop");
    expect(latest().site).toMatchObject({ mode: "shop", template: "shop", headerCta: null });
    expect(resolveSiteFeatures(latest().site).cart).toBe(true);
  });

  it("is not blocked by what the tenant already has: a mode that turns features off just applies", async () => {
    const { apply, latest } = setup({ settings: { homeSections: [{ id: "x", type: "products", enabled: true, settings: {} }] } });
    await apply("landing");
    expect(latest().site.mode).toBe("showcase");
  });

  it("keeps the tenant's own pages and forms by default", async () => {
    const { apply, writes, pages } = setup({ forms: ["contact"], pages: [{ slug: "about" }, { slug: "contact" }] });
    const result = await apply("corporate");
    expect(result.applied.formsCreated).toEqual([]);
    expect(result.applied.pagesSkipped.sort()).toEqual(["about", "contact"]);
    expect(result.applied.pagesCreated.sort()).toEqual(["projects", "services"]);
    expect(writes.pagesUpdated).toHaveLength(0);
    expect(pages.has("services")).toBe(true);
  });

  it("replaces a page with the same address only when asked, and never a blog post", async () => {
    const { apply, writes } = setup({ pages: [{ slug: "about", id: "about-id" }, { slug: "services", kind: "blog" }] });
    const result = await apply("corporate", { overwritePages: true });
    expect(result.applied.pagesOverwritten).toEqual(["about"]);
    expect(result.applied.pagesSkipped).toEqual(["services"]);
    expect(writes.pagesUpdated).toHaveLength(1);
    expect(writes.pagesUpdated[0]).toMatchObject({ layout: "full", isPublished: true, body: "" });
  });

  it("creates nothing it was not asked to create", async () => {
    const { apply, writes } = setup();
    const result = await apply("corporate", { createPages: false, createForms: false });
    expect(writes.pagesInserted).toHaveLength(0);
    expect(writes.forms).toHaveLength(0);
    expect(result.applied).toEqual({ formsCreated: [], pagesCreated: [], pagesOverwritten: [], pagesSkipped: [] });
  });

  it("with applyContent off, leaves the mode, navigation and home page alone and only adds pages and forms", async () => {
    const { apply, writes, latest } = setup({ settings: { tagline: "Mine" } });
    await apply("corporate", { applyContent: false });
    expect(writes.settings).toHaveLength(0);
    expect(latest().site.mode).toBe("shop");
    expect(writes.pagesInserted.length).toBeGreaterThan(0);
  });

  it("takes the preset's colours and type only when the theme is asked for, and never the brand assets", async () => {
    const brand = { ...DEFAULT_STOREFRONT_SETTINGS.theme, faviconUrl: "https://x.test/f.png", social: { x: "https://x.com/me" }, announcement: { enabled: true, text: "Sale", href: null } };
    const without = setup({ settings: { theme: brand } });
    await without.apply("landing");
    expect(without.latest().theme.colors).toEqual(DEFAULT_STOREFRONT_SETTINGS.theme.colors);

    const withTheme = setup({ settings: { theme: brand } });
    await withTheme.apply("landing", { applyTheme: true });
    const theme = withTheme.latest().theme;
    expect(theme.preset).toBe("midnight");
    expect(theme.colors.accent).toBe("#e11d48");
    expect(theme.faviconUrl).toBe("https://x.test/f.png");
    expect(theme.social).toEqual({ x: "https://x.com/me" });
    expect(theme.announcement.text).toBe("Sale");
  });

  it("does not let two applies share state: the stored sections are copies of the template's", async () => {
    const { apply, latest } = setup();
    await apply("corporate");
    latest().homeSections[0]!.enabled = false;
    expect(SITE_TEMPLATES.corporate.homeSections[0]!.enabled).toBe(true);
  });

  it("needs a storefront to exist", async () => {
    await expect(setup({ noStorefront: true }).apply("shop")).rejects.toMatchObject({ code: "STOREFRONT_NOT_FOUND" });
  });
});
