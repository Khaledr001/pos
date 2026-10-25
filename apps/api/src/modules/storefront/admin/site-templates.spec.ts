import {
  COMMERCE_SECTION_TYPES,
  HOME_SECTION_TYPES,
  resolveSiteFeatures,
  resolveSite,
  SITE_MODES,
  SITE_TEMPLATE_IDS,
  SITE_TEMPLATE_ORDER,
  SITE_TEMPLATES,
  THEME_PRESET_IDS,
  type HomeSection,
  type SiteTemplate,
} from "@devsfleet/shared-types";
import { describe, expect, it } from "vitest";
import { NavigationSchema, ThemeSchema } from "./appearance.dto.js";
import { FormSchema } from "./forms.dto.js";
import { HomeSectionsSchema, PageSectionsSchema } from "./sections.dto.js";
import { SiteSchema } from "./site.dto.js";

/**
 * The guard against shipping a template the API itself would reject: a template
 * is applied by copying it into settings, pages and forms that were not run
 * through these schemas on the way in, so they are run through them here.
 */
const templates = Object.values(SITE_TEMPLATES);

const sectionList = (t: SiteTemplate): { where: string; sections: HomeSection[] }[] => [
  { where: "home", sections: t.homeSections },
  ...t.pages.map((p) => ({ where: `page ${p.slug}`, sections: p.sections })),
];

describe("site templates", () => {
  it("has exactly one template per id, in the picker order", () => {
    expect(Object.keys(SITE_TEMPLATES).sort()).toEqual([...SITE_TEMPLATE_IDS].sort());
    expect([...SITE_TEMPLATE_ORDER].sort()).toEqual([...SITE_TEMPLATE_IDS].sort());
    for (const [id, template] of Object.entries(SITE_TEMPLATES)) expect(template.id).toBe(id);
  });

  it("covers all three modes", () => {
    expect(new Set(templates.map((t) => t.mode))).toEqual(new Set(SITE_MODES));
  });

  for (const template of templates) {
    describe(template.id, () => {
      it("has a label, a blurb and a known theme preset", () => {
        expect(template.label.length).toBeGreaterThan(2);
        expect(template.blurb.length).toBeGreaterThan(10);
        expect(template.bestFor.length).toBeGreaterThan(10);
        expect(THEME_PRESET_IDS).toContain(template.themePreset);
      });

      it("passes the section schema on the home page and on every page", () => {
        for (const { where, sections } of sectionList(template)) {
          const schema = where === "home" ? HomeSectionsSchema : PageSectionsSchema;
          const result = schema.safeParse(sections);
          expect(result.success, `${template.id} ${where}: ${JSON.stringify(result.error?.issues)}`).toBe(true);
        }
      });

      it("passes the site, theme layout and navigation schemas", () => {
        const site = SiteSchema.safeParse(template.site);
        expect(site.success, JSON.stringify(site.error?.issues)).toBe(true);
        const theme = ThemeSchema.safeParse({ layout: template.layout });
        expect(theme.success, JSON.stringify(theme.error?.issues)).toBe(true);
        const nav = NavigationSchema.safeParse(template.navigation);
        expect(nav.success, JSON.stringify(nav.error?.issues)).toBe(true);
      });

      it("passes the form schema, with unique form addresses", () => {
        for (const form of template.forms) {
          const result = FormSchema.safeParse(form);
          expect(result.success, `${form.slug}: ${JSON.stringify(result.error?.issues)}`).toBe(true);
        }
        const slugs = template.forms.map((f) => f.slug);
        expect(new Set(slugs).size).toBe(slugs.length);
      });

      it("keeps its mode consistent with its site block", () => {
        expect(template.site.mode).toBe(template.mode);
        expect(template.site.template).toBe(template.id);
      });

      it("only embeds forms the template creates", () => {
        const formSlugs = new Set(template.forms.map((f) => f.slug));
        for (const { sections } of sectionList(template)) {
          for (const s of sections) if (s.type === "form") expect(formSlugs.has(s.settings.formSlug ?? ""), s.settings.formSlug).toBe(true);
        }
        if (template.mode === "catalogue") {
          expect(template.site.enquiry?.form).toBe(true);
          expect(formSlugs.has(template.site.enquiry!.formSlug!)).toBe(true);
        }
      });

      it("links only to pages it creates (or to the built-in storefront routes)", () => {
        const pages = new Set(template.pages.map((p) => `/pages/${p.slug}`));
        const links: string[] = [
          ...template.navigation.header.map((l) => l.href),
          ...template.navigation.footerColumns.flatMap((c) => c.links.map((l) => l.href)),
          ...template.navigation.legal.map((l) => l.href),
          ...(template.site.headerCta ? [template.site.headerCta.href] : []),
          ...sectionList(template).flatMap(({ sections }) =>
            sections.flatMap((s) => {
              const st = s.settings as Record<string, unknown>;
              const own = [st.ctaHref, st.secondaryHref].filter((v): v is string => typeof v === "string");
              const items = Array.isArray(st.items) ? (st.items as { href?: string }[]).map((i) => i.href).filter((v): v is string => !!v) : [];
              return [...own, ...items];
            }),
          ),
        ];
        const builtIn = new Set(["/", "/departments", "/search?q=", "/trade", "/branches", "/blog", "/track"]);
        for (const href of links) {
          if (href.startsWith("https://")) continue;
          const path = href.split("#")[0] || "/";
          expect(pages.has(path) || builtIn.has(path), `${template.id}: ${href}`).toBe(true);
        }
      });

      it("only jumps to anchors that exist on the home page", () => {
        const anchors = new Set(template.homeSections.map((s) => s.style?.anchor).filter(Boolean));
        for (const link of [...template.navigation.header, ...(template.site.headerCta ? [template.site.headerCta] : [])]) {
          const hash = link.href.startsWith("/#") ? link.href.slice(2) : null;
          if (hash) expect(anchors.has(hash), `${template.id}: ${link.href}`).toBe(true);
        }
      });

      it("has unique section ids on every page", () => {
        for (const { where, sections } of sectionList(template)) {
          expect(new Set(sections.map((s) => s.id)).size, `${template.id} ${where}`).toBe(sections.length);
        }
      });

      it("uses only section types the registry knows", () => {
        for (const { sections } of sectionList(template)) for (const s of sections) expect(HOME_SECTION_TYPES).toContain(s.type);
      });

      it("does not leave product sections on a site with no products", () => {
        const features = resolveSiteFeatures(resolveSite(template.site));
        if (features.products) return;
        for (const { where, sections } of sectionList(template)) {
          for (const s of sections) expect(COMMERCE_SECTION_TYPES, `${template.id} ${where}: ${s.type}`).not.toContain(s.type);
        }
      });
    });
  }

  it("makes each non-shop template enable the right features", () => {
    const features = (id: keyof typeof SITE_TEMPLATES) => resolveSiteFeatures(resolveSite(SITE_TEMPLATES[id].site));
    expect(features("shop")).toMatchObject({ products: true, cart: true, checkout: true, prices: true });
    expect(features("catalogue")).toMatchObject({ products: true, cart: false, checkout: false, enquiries: true });
    expect(features("corporate")).toMatchObject({ products: false, cart: false, checkout: false });
    expect(features("landing")).toMatchObject({ products: false, cart: false, checkout: false });
  });
});
