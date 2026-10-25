import { DEFAULT_HOME_SECTIONS, MAX_HOME_SECTIONS, THEME_PRESETS } from "@devsfleet/shared-types";
import { describe, expect, it } from "vitest";
import { UpdateSettingsSchema } from "./dto.js";
import { HeadlessSchema, HomeSectionsSchema, NavigationSchema, RegionSchema, ThemeSchema } from "./appearance.dto.js";

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) => schema.safeParse(value).success;

describe("ThemeSchema", () => {
  it("accepts every shipped preset as a whole theme", () => {
    for (const [id, preset] of Object.entries(THEME_PRESETS)) {
      expect(ok(ThemeSchema, { preset: id, colors: preset.colors, font: preset.font, radius: preset.radius, layout: preset.layout })).toBe(true);
    }
  });

  it("lower-cases colours and refuses anything but six-digit hex", () => {
    expect(ThemeSchema.parse({ colors: { accent: "#0E6B53" } }).colors?.accent).toBe("#0e6b53");
    for (const bad of ["red", "#fff", "rgb(0,0,0)", "#12345g", "url(x)"]) expect(ok(ThemeSchema, { colors: { ink: bad } })).toBe(false);
  });

  it("refuses unknown fonts, radii and layouts", () => {
    expect(ok(ThemeSchema, { font: "comic-sans" })).toBe(false);
    expect(ok(ThemeSchema, { radius: "blobby" })).toBe(false);
    expect(ok(ThemeSchema, { layout: { header: "mega" } })).toBe(false);
  });

  it("allows http(s) and site-relative images, not script or protocol-relative", () => {
    expect(ok(ThemeSchema, { faviconUrl: "/uploads/fav.png", shareImageUrl: "https://cdn.x/og.png" })).toBe(true);
    for (const bad of ["javascript:alert(1)", "//evil.com/x.png", "data:image/png;base64,AA"]) {
      expect(ok(ThemeSchema, { faviconUrl: bad })).toBe(false);
    }
  });

  it("needs text for an enabled announcement and https social links", () => {
    expect(ok(ThemeSchema, { announcement: { enabled: true, text: "" } })).toBe(false);
    expect(ok(ThemeSchema, { announcement: { enabled: true, text: "Free delivery", href: "/pages/delivery" } })).toBe(true);
    expect(ok(ThemeSchema, { announcement: { text: "x".repeat(201) } })).toBe(false);
    expect(ok(ThemeSchema, { social: { instagram: "https://instagram.com/shop" } })).toBe(true);
    expect(ok(ThemeSchema, { social: { instagram: "http://instagram.com/shop" } })).toBe(false);
    expect(ok(ThemeSchema, { social: { myspace: "https://x.y" } })).toBe(false);
  });
});

describe("HomeSectionsSchema", () => {
  it("accepts the default home page", () => {
    expect(ok(HomeSectionsSchema, DEFAULT_HOME_SECTIONS)).toBe(true);
  });

  it("refuses duplicate ids, an unknown type, and too many sections", () => {
    const a = { id: "a", type: "brands", enabled: true, settings: {} };
    expect(ok(HomeSectionsSchema, [a, { ...a }])).toBe(false);
    expect(ok(HomeSectionsSchema, [{ ...a, type: "custom_html" }])).toBe(false);
    const many = Array.from({ length: MAX_HOME_SECTIONS + 1 }, (_, i) => ({ ...a, id: `s${i}` }));
    expect(ok(HomeSectionsSchema, many)).toBe(false);
  });

  it("checks each type's own settings", () => {
    const s = (type: string, settings: unknown) => [{ id: "x", type, enabled: true, settings }];
    expect(ok(HomeSectionsSchema, s("products", { source: "best_sellers", limit: 12 }))).toBe(true);
    expect(ok(HomeSectionsSchema, s("products", { limit: 13 }))).toBe(false);
    expect(ok(HomeSectionsSchema, s("products", { source: "random" }))).toBe(false);
    expect(ok(HomeSectionsSchema, s("categories", { limit: 0 }))).toBe(false);
    expect(ok(HomeSectionsSchema, s("hero", { ctaHref: "javascript:alert(1)" }))).toBe(false);
    expect(ok(HomeSectionsSchema, s("hero", { ctaHref: "/category/tools", variant: "split" }))).toBe(true);
    expect(ok(HomeSectionsSchema, s("promo_banner", { ctaHref: "//evil.com" }))).toBe(false);
    expect(ok(HomeSectionsSchema, s("trust_badges", { items: [{ icon: "truck", title: "Fast", text: "" }] }))).toBe(true);
    expect(ok(HomeSectionsSchema, s("trust_badges", { items: [{ icon: "skull", title: "x", text: "" }] }))).toBe(false);
    expect(ok(HomeSectionsSchema, s("faq", { items: Array.from({ length: 21 }, () => ({ q: "q", a: "a" })) }))).toBe(false);
    expect(ok(HomeSectionsSchema, s("rich_text", { body: "x".repeat(5001) }))).toBe(false);
    expect(ok(HomeSectionsSchema, s("banner_strip", { extra: 1 }))).toBe(false);
    expect(ok(HomeSectionsSchema, s("hero", { unknownKey: 1 }))).toBe(false);
  });
});

describe("NavigationSchema", () => {
  it("accepts site paths and https links only", () => {
    expect(ok(NavigationSchema, { header: [{ label: "Blog", href: "/blog" }, { label: "Ext", href: "https://x.com/a" }] })).toBe(true);
    for (const href of ["javascript:alert(1)", "http://x.com", "//evil.com", "blog", "/ok bad"]) {
      expect(ok(NavigationSchema, { header: [{ label: "x", href }] })).toBe(false);
    }
  });

  it("caps links and columns", () => {
    const link = { label: "x", href: "/x" };
    expect(ok(NavigationSchema, { header: Array.from({ length: 13 }, () => link) })).toBe(false);
    expect(ok(NavigationSchema, { footerColumns: Array.from({ length: 5 }, () => ({ title: "t", links: [link] })) })).toBe(false);
  });
});

describe("RegionSchema", () => {
  const zones = [{ code: "RIYADH", name: "Riyadh" }];
  const region = { country: "sa", callingCode: "966", zoneLabel: "Region", zones, taxLabel: "VAT", taxIdLabel: "VAT No.", formatLocale: "en-SA" };

  it("accepts a full region and upper-cases the country", () => {
    expect(RegionSchema.parse(region).country).toBe("SA");
  });

  it("refuses bad codes, duplicates, empty zone lists and bad locales", () => {
    expect(ok(RegionSchema, { ...region, callingCode: "+966" })).toBe(false);
    expect(ok(RegionSchema, { ...region, country: "SAU" })).toBe(false);
    expect(ok(RegionSchema, { ...region, zones: [] })).toBe(false);
    expect(ok(RegionSchema, { ...region, zones: [...zones, ...zones] })).toBe(false);
    expect(ok(RegionSchema, { ...region, zones: [{ code: "has space", name: "x" }] })).toBe(false);
    expect(ok(RegionSchema, { ...region, zones: Array.from({ length: 61 }, (_, i) => ({ code: `Z${i}`, name: "z" })) })).toBe(false);
    expect(ok(RegionSchema, { ...region, formatLocale: "not a locale" })).toBe(false);
  });
});

describe("HeadlessSchema", () => {
  it("accepts exact https origins and local development", () => {
    expect(ok(HeadlessSchema, { enabled: true, allowedOrigins: ["https://shop.example.com", "http://localhost:5173"] })).toBe(true);
  });

  it("refuses wildcards, paths, plain http and duplicates", () => {
    for (const bad of ["*", "https://*.example.com", "https://x.com/path", "http://x.com", "https://x.com/", "example.com"]) {
      expect(ok(HeadlessSchema, { allowedOrigins: [bad] })).toBe(false);
    }
    expect(ok(HeadlessSchema, { allowedOrigins: ["https://a.com", "https://a.com"] })).toBe(false);
    expect(ok(HeadlessSchema, { allowedOrigins: Array.from({ length: 11 }, (_, i) => `https://a${i}.com`) })).toBe(false);
  });
});

describe("UpdateSettingsSchema", () => {
  it("still takes a PATCH that names only one block", () => {
    expect(ok(UpdateSettingsSchema, { theme: { font: "inter" } })).toBe(true);
    expect(ok(UpdateSettingsSchema, {})).toBe(true);
  });

  it("takes any zone code for a delivery rate (the service checks it against the region)", () => {
    const rate = { emirate: "RIYADH", baseFee: "10", baseWeightKg: 5, perKgFee: "1", freeOver: null, maxWeightKg: 30, etaDays: 2, active: true };
    expect(ok(UpdateSettingsSchema, { shipping: { rates: [rate] } })).toBe(true);
    expect(ok(UpdateSettingsSchema, { shipping: { rates: [{ ...rate, emirate: "not valid" }] } })).toBe(false);
  });
});


describe("ThemeSchema — site layout options", () => {
  it("accepts the brochure header, the minimal footer, a wide container and a non-sticky header", () => {
    expect(ThemeSchema.safeParse({ layout: { header: "simple", footer: "minimal", container: "wide", stickyHeader: false } }).success).toBe(true);
  });

  it("rejects layouts the build does not ship", () => {
    expect(ThemeSchema.safeParse({ layout: { header: "mega" } }).success).toBe(false);
    expect(ThemeSchema.safeParse({ layout: { footer: "tall" } }).success).toBe(false);
    expect(ThemeSchema.safeParse({ layout: { container: "full" } }).success).toBe(false);
    expect(ThemeSchema.safeParse({ layout: { stickyHeader: "yes" } }).success).toBe(false);
  });
});
