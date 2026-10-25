import {
  BADGE_ICONS,
  FONT_PAIR_IDS,
  FOOTER_LAYOUTS,
  HEADER_LAYOUTS,
  HEX_COLOR,
  HOME_SECTION_TYPES,
  MAX_FOOTER_COLUMNS,
  MAX_HEADLESS_ORIGINS,
  MAX_HOME_SECTIONS,
  MAX_NAV_LINKS,
  NAV_HREF,
  PRODUCT_CARD_LAYOUTS,
  RADIUS_STYLES,
  SOCIAL_NETWORKS,
  THEME_PRESET_IDS,
  ZONE_CODE,
} from "@devsfleet/shared-types";
import { z } from "zod";

/**
 * Shape rules for the storefront's appearance, home sections, navigation,
 * region and headless settings. Cross-field rules that need the stored
 * settings or the plan (zones vs delivery rates, headless vs plan) live in
 * SettingsAdminService, not here.
 */

const text = (max: number) => z.string().trim().max(max);
const label = (max: number) => z.string().trim().min(1).max(max);

/** A path on the shop or an https URL. Nothing that could run script. */
const href = z.string().trim().max(500).regex(NAV_HREF, "Use a path like /pages/about or an https:// link");

/** An image already uploaded to the platform, or any http(s) URL. */
const imageUrl = z
  .string()
  .trim()
  .max(500)
  .regex(/^(https?:\/\/[^\s]+|\/(?![/\\])[^\s]*)$/, "Use an http(s) URL or an uploaded file's path");

const hex = z.string().trim().regex(HEX_COLOR, "Use a six-digit hex colour like #0e6b53").transform((v) => v.toLowerCase());

const https = z.string().trim().max(300).regex(/^https:\/\/[^\s]+$/, "Use a full https:// link");

// ── theme ────────────────────────────────────────────────────────────────

export const ThemeSchema = z
  .object({
    preset: z.enum(THEME_PRESET_IDS),
    colors: z.object({ ink: hex, accent: hex, highlight: hex, background: hex, surface: hex }).partial(),
    font: z.enum(FONT_PAIR_IDS),
    radius: z.enum(RADIUS_STYLES),
    layout: z
      .object({
        header: z.enum(HEADER_LAYOUTS),
        productCard: z.enum(PRODUCT_CARD_LAYOUTS),
        footer: z.enum(FOOTER_LAYOUTS),
      })
      .partial(),
    faviconUrl: imageUrl.nullable(),
    shareImageUrl: imageUrl.nullable(),
    announcement: z
      .object({ enabled: z.boolean(), text: text(200), href: href.nullable() })
      .partial()
      .refine((a) => !a.enabled || (a.text ?? "").length > 0, { message: "An announcement needs some text", path: ["text"] }),
    /** Replaced wholesale: to remove a network, leave it out. */
    social: z.object(Object.fromEntries(SOCIAL_NETWORKS.map((n) => [n, https.optional()]))).strict(),
  })
  .partial();
export type ThemeDto = z.infer<typeof ThemeSchema>;

// ── home sections ────────────────────────────────────────────────────────

const sectionBase = { id: z.string().trim().min(1).max(40).regex(/^[a-z0-9_-]+$/i, "Letters, digits, - and _ only"), enabled: z.boolean() };
const limit = z.coerce.number().int().min(1).max(12);

const TrustBadgeSchema = z.object({ icon: z.enum(BADGE_ICONS), title: label(60), text: text(200) });
const FaqItemSchema = z.object({ q: label(200), a: label(1000) });

const HomeSectionSchemaUnion = z.discriminatedUnion("type", [
  z.object({
    ...sectionBase,
    type: z.literal("hero"),
    settings: z
      .object({
        headline: text(120),
        subheadline: text(300),
        ctaLabel: text(40),
        ctaHref: href,
        variant: z.enum(["banner", "split", "minimal"]),
      })
      .partial()
      .strict(),
  }),
  z.object({
    ...sectionBase,
    type: z.literal("trust_badges"),
    settings: z.object({ items: z.array(TrustBadgeSchema).max(6) }).partial().strict(),
  }),
  z.object({
    ...sectionBase,
    type: z.literal("categories"),
    settings: z.object({ title: text(80), limit }).partial().strict(),
  }),
  z.object({
    ...sectionBase,
    type: z.literal("products"),
    settings: z.object({ title: text(80), source: z.enum(["best_sellers", "new_arrivals"]), limit }).partial().strict(),
  }),
  z.object({
    ...sectionBase,
    type: z.literal("promo_banner"),
    settings: z.object({ headline: text(120), text: text(300), ctaLabel: text(40), ctaHref: href }).partial().strict(),
  }),
  z.object({
    ...sectionBase,
    type: z.literal("brands"),
    settings: z.object({ title: text(80) }).partial().strict(),
  }),
  z.object({ ...sectionBase, type: z.literal("banner_strip"), settings: z.object({}).strict() }),
  z.object({
    ...sectionBase,
    type: z.literal("rich_text"),
    settings: z.object({ title: text(120), body: text(5000) }).partial().strict(),
  }),
  z.object({
    ...sectionBase,
    type: z.literal("faq"),
    settings: z.object({ title: text(80), items: z.array(FaqItemSchema).max(20) }).partial().strict(),
  }),
]);

// Fails loudly if a type is added to the shared list without a schema here.
const _everyTypeHasASchema: (typeof HOME_SECTION_TYPES)[number] extends z.infer<typeof HomeSectionSchemaUnion>["type"] ? true : never = true;
void _everyTypeHasASchema;

export const HomeSectionsSchema = z
  .array(HomeSectionSchemaUnion)
  .max(MAX_HOME_SECTIONS)
  .refine((sections) => new Set(sections.map((s) => s.id)).size === sections.length, { message: "Section ids must be unique" });

// ── navigation ───────────────────────────────────────────────────────────

const NavLinkSchema = z.object({ label: label(60), href });
const navLinks = z.array(NavLinkSchema).max(MAX_NAV_LINKS);

export const NavigationSchema = z
  .object({
    header: navLinks,
    footerColumns: z.array(z.object({ title: label(60), links: navLinks })).max(MAX_FOOTER_COLUMNS),
    legal: navLinks,
    footerNote: text(300),
  })
  .partial();
export type NavigationDto = z.infer<typeof NavigationSchema>;

// ── region ───────────────────────────────────────────────────────────────

const localeTag = z
  .string()
  .trim()
  .max(35)
  .refine((tag) => {
    try {
      return Intl.getCanonicalLocales(tag).length === 1;
    } catch {
      return false;
    }
  }, "Use a locale like en-AE");

export const RegionSchema = z
  .object({
    country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Use a two-letter country code"),
    callingCode: z.string().trim().regex(/^\d{1,4}$/, "Digits only, no +"),
    zoneLabel: label(40),
    zones: z
      .array(z.object({ code: z.string().trim().toUpperCase().regex(ZONE_CODE, "Upper-case letters, digits and _ only (max 20)"), name: label(80) }))
      .min(1)
      .max(60)
      .refine((zones) => new Set(zones.map((z) => z.code)).size === zones.length, { message: "Zone codes must be unique" }),
    taxLabel: label(20),
    taxIdLabel: label(20),
    formatLocale: localeTag,
  })
  .partial();
export type RegionDto = z.infer<typeof RegionSchema>;

// ── headless ─────────────────────────────────────────────────────────────

/** An exact origin: https://host[:port], or http://localhost[:port] while developing. */
const origin = z
  .string()
  .trim()
  .toLowerCase()
  .refine((value) => {
    try {
      const url = new URL(value);
      const isLocal = url.protocol === "http:" && url.hostname === "localhost";
      // The URL parser lets "*" through in a hostname; a wildcard origin must never be storable.
      return (url.protocol === "https:" || isLocal) && url.origin === value && /^[a-z0-9.-]+$/.test(url.hostname);
    } catch {
      return false;
    }
  }, "Use an exact origin like https://shop.example.com (no path, no wildcard)");

export const HeadlessSchema = z
  .object({
    enabled: z.boolean(),
    allowedOrigins: z
      .array(origin)
      .max(MAX_HEADLESS_ORIGINS)
      .refine((o) => new Set(o).size === o.length, { message: "Each origin once" }),
  })
  .partial();
export type HeadlessDto = z.infer<typeof HeadlessSchema>;
