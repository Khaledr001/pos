import { HOME_SECTION_TYPES, MAX_PAGE_SECTIONS, type HomeSectionType } from "@devsfleet/shared-types";
import { describe, expect, it } from "vitest";
import { HomeSectionsSchema, mapEmbedUrl, PageSectionsSchema, videoUrl } from "./sections.dto.js";

/** One valid example per section type, so a type added without a schema or an example fails here. */
const EXAMPLES: Record<HomeSectionType, Record<string, unknown>> = {
  hero: { variant: "image", headline: "Hi", imageUrl: "https://cdn.example.com/a.jpg", align: "center", height: "lg", ctaHref: "/pages/about", secondaryHref: "https://example.com" },
  trust_badges: { items: [{ icon: "truck", title: "Fast", text: "Quick" }] },
  categories: { title: "Shop", limit: 24 },
  products: { source: "category", categorySlug: "taps", limit: 8 },
  promo_banner: { headline: "Hi", ctaHref: "/trade" },
  brands: { title: "Brands" },
  banner_strip: {},
  rich_text: { title: "T", body: "**hello**" },
  faq: { items: [{ q: "Q?", a: "A." }] },
  image_text: { title: "T", imageUrl: "/uploads/a.png", imageSide: "left", bullets: ["a", "b"], ctaHref: "/pages/x" },
  features: { columns: 3, items: [{ icon: "wrench", title: "T", text: "x" }] },
  cards: { variant: "person", columns: 4, items: [{ title: "T", imageUrl: "https://cdn.example.com/p.jpg", href: "/pages/a" }] },
  stats: { items: [{ value: "10+", label: "Years" }] },
  gallery: { columns: 2, items: [{ imageUrl: "https://cdn.example.com/g.jpg", alt: "a", caption: "c" }] },
  testimonials: { items: [{ quote: "Great", name: "A", role: "B", avatarUrl: "https://cdn.example.com/a.jpg" }] },
  logos: { items: [{ imageUrl: "https://cdn.example.com/l.png", name: "ACME", href: "https://acme.example" }] },
  steps: { items: [{ title: "One", text: "First" }] },
  cta_banner: { headline: "Go", ctaHref: "/#contact", showWhatsapp: true },
  video: { url: "https://www.youtube.com/watch?v=abc" },
  map: { mode: "embed", embedUrl: "https://www.google.com/maps/embed?pb=!1m18" },
  contact_info: { showBranches: true, showHours: false, showSocial: true },
  form: { formSlug: "contact", layout: "split" },
  spacer: { height: "md", divider: true },
};

const section = (type: HomeSectionType, settings: Record<string, unknown> = EXAMPLES[type], extra: Record<string, unknown> = {}) => ({
  id: `${type}-1`,
  type,
  enabled: true,
  settings,
  ...extra,
});

describe("section schemas", () => {
  it("has a valid example for every section type", () => {
    expect(Object.keys(EXAMPLES).sort()).toEqual([...HOME_SECTION_TYPES].sort());
    for (const type of HOME_SECTION_TYPES) {
      const result = PageSectionsSchema.safeParse([section(type)]);
      expect(result.success, `${type}: ${JSON.stringify(result.error?.issues)}`).toBe(true);
    }
  });

  it("accepts the same sections on the home page and on a custom page", () => {
    const all = HOME_SECTION_TYPES.map((t) => section(t));
    expect(HomeSectionsSchema.safeParse(all).success).toBe(true);
    expect(PageSectionsSchema.safeParse(all).success).toBe(true);
  });

  it("rejects an unknown setting, so a typo is not stored silently", () => {
    for (const type of HOME_SECTION_TYPES) {
      expect(PageSectionsSchema.safeParse([section(type, { ...EXAMPLES[type], nope: 1 })]).success, type).toBe(false);
    }
  });

  it("rejects an unknown section type", () => {
    expect(PageSectionsSchema.safeParse([{ id: "x", type: "script", enabled: true, settings: {} }]).success).toBe(false);
  });

  describe("links and images", () => {
    it("refuses script and protocol-relative links wherever a link is taken", () => {
      for (const bad of ["javascript:alert(1)", "//evil.test", "data:text/html,x", "http://insecure.test", "ftp://x.test/y"]) {
        expect(PageSectionsSchema.safeParse([section("hero", { ctaHref: bad })]).success, bad).toBe(false);
        expect(PageSectionsSchema.safeParse([section("cards", { items: [{ title: "T", href: bad }] })]).success, bad).toBe(false);
        expect(PageSectionsSchema.safeParse([section("logos", { items: [{ imageUrl: "/uploads/a.png", name: "n", href: bad }] })]).success, bad).toBe(false);
      }
    });

    it("accepts site paths with anchors, and https links", () => {
      expect(PageSectionsSchema.safeParse([section("cta_banner", { ctaHref: "/#contact", secondaryHref: "https://example.com/x" })]).success).toBe(true);
    });

    it("takes only https, local-dev and uploaded images", () => {
      const ok = ["https://cdn.example.com/a.jpg", "/uploads/tenant/a.png", "http://localhost:3001/uploads/a.png"];
      const bad = ["http://cdn.example.com/a.jpg", "javascript:alert(1)", "data:image/png;base64,AAAA", "//cdn.example.com/a.jpg", "/etc/passwd", "ftp://x/a.jpg"];
      for (const url of ok) expect(PageSectionsSchema.safeParse([section("image_text", { imageUrl: url })]).success, url).toBe(true);
      for (const url of bad) expect(PageSectionsSchema.safeParse([section("image_text", { imageUrl: url })]).success, url).toBe(false);
    });
  });

  describe("embeds", () => {
    it("accepts YouTube and Vimeo only, by parsed hostname", () => {
      for (const url of ["https://www.youtube.com/watch?v=a", "https://youtu.be/a", "https://vimeo.com/123", "https://player.vimeo.com/video/123", "https://www.youtube-nocookie.com/embed/a"]) {
        expect(videoUrl.safeParse(url).success, url).toBe(true);
      }
      for (const url of ["https://youtube.com.evil.test/watch", "https://evil.test/youtube.com", "http://www.youtube.com/watch?v=a", "javascript:alert(1)", "https://notyoutube.com/a", "https://user@evil.test@youtube.com.evil.test/"]) {
        expect(videoUrl.safeParse(url).success, url).toBe(false);
      }
    });

    it("accepts only a map provider's embed URL", () => {
      for (const url of ["https://www.google.com/maps/embed?pb=1", "https://maps.google.com/maps?q=x&output=embed", "https://www.openstreetmap.org/export/embed.html?bbox=1"]) {
        expect(mapEmbedUrl.safeParse(url).success, url).toBe(true);
      }
      for (const url of ["https://www.google.com/search?q=x", "https://evil.test/maps/embed", "https://www.google.com.evil.test/maps/embed", "http://www.google.com/maps/embed", "javascript:alert(1)"]) {
        expect(mapEmbedUrl.safeParse(url).success, url).toBe(false);
      }
    });

    it("needs the embed link when the map is in embed mode, and a category when a product row shows one", () => {
      expect(PageSectionsSchema.safeParse([section("map", { mode: "embed" })]).success).toBe(false);
      expect(PageSectionsSchema.safeParse([section("map", { mode: "branches" })]).success).toBe(true);
      expect(PageSectionsSchema.safeParse([section("products", { source: "category" })]).success).toBe(false);
      expect(PageSectionsSchema.safeParse([section("products", { source: "best_sellers" })]).success).toBe(true);
    });
  });

  describe("limits", () => {
    const many = (n: number, make: (i: number) => unknown) => Array.from({ length: n }, (_, i) => make(i));
    it("caps every list", () => {
      const card = (i: number) => ({ title: `T${i}` });
      expect(PageSectionsSchema.safeParse([section("cards", { items: many(24, card) })]).success).toBe(true);
      expect(PageSectionsSchema.safeParse([section("cards", { items: many(25, card) })]).success).toBe(false);
      expect(PageSectionsSchema.safeParse([section("gallery", { items: many(25, () => ({ imageUrl: "/uploads/a.png" })) })]).success).toBe(false);
      expect(PageSectionsSchema.safeParse([section("logos", { items: many(25, () => ({ imageUrl: "/uploads/a.png", name: "n" })) })]).success).toBe(false);
      expect(PageSectionsSchema.safeParse([section("features", { items: many(13, () => ({ icon: "star", title: "t", text: "x" })) })]).success).toBe(false);
      expect(PageSectionsSchema.safeParse([section("stats", { items: many(7, () => ({ value: "1", label: "l" })) })]).success).toBe(false);
      expect(PageSectionsSchema.safeParse([section("testimonials", { items: many(13, () => ({ quote: "q", name: "n" })) })]).success).toBe(false);
      expect(PageSectionsSchema.safeParse([section("steps", { items: many(9, () => ({ title: "t", text: "x" })) })]).success).toBe(false);
      expect(PageSectionsSchema.safeParse([section("faq", { items: many(21, () => ({ q: "q", a: "a" })) })]).success).toBe(false);
      expect(PageSectionsSchema.safeParse([section("products", { limit: 13 })]).success).toBe(false);
      expect(PageSectionsSchema.safeParse([section("rich_text", { body: "x".repeat(5001) })]).success).toBe(false);
    });

    it("caps the number of sections on a page", () => {
      const sections = (n: number) => many(n, (i) => ({ id: `s${i}`, type: "spacer", enabled: true, settings: {} }));
      expect(PageSectionsSchema.safeParse(sections(MAX_PAGE_SECTIONS)).success).toBe(true);
      expect(PageSectionsSchema.safeParse(sections(MAX_PAGE_SECTIONS + 1)).success).toBe(false);
    });

    it("only takes the icons the platform ships", () => {
      expect(PageSectionsSchema.safeParse([section("features", { items: [{ icon: "<script>", title: "t", text: "x" }] })]).success).toBe(false);
    });
  });

  describe("style", () => {
    it("accepts the style options", () => {
      const style = { background: "dark", paddingY: "lg", width: "full", align: "center", anchor: "how-it-works", hideOnMobile: true };
      expect(PageSectionsSchema.safeParse([section("spacer", {}, { style })]).success).toBe(true);
    });

    it("rejects an unknown style key or value, and a bad anchor", () => {
      expect(PageSectionsSchema.safeParse([section("spacer", {}, { style: { background: "neon" } })]).success).toBe(false);
      expect(PageSectionsSchema.safeParse([section("spacer", {}, { style: { color: "red" } })]).success).toBe(false);
      for (const anchor of ["Has Space", "1starts-digit", "UPPER", "a".repeat(41), "x\"onmouseover=1"]) {
        expect(PageSectionsSchema.safeParse([section("spacer", {}, { style: { anchor } })]).success, anchor).toBe(false);
      }
    });

    it("needs unique ids and unique anchors", () => {
      const a = { id: "same", type: "spacer", enabled: true, settings: {} };
      expect(PageSectionsSchema.safeParse([a, a]).success).toBe(false);
      const x = (id: string) => ({ id, type: "spacer", enabled: true, settings: {}, style: { anchor: "top" } });
      expect(PageSectionsSchema.safeParse([x("a"), x("b")]).success).toBe(false);
    });
  });
});
