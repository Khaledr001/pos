import {
  CONTAINER_WIDTHS,
  FONT_PAIR_IDS,
  FOOTER_LAYOUTS,
  HEADER_LAYOUTS,
  HEX_COLOR,
  MAX_FOOTER_COLUMNS,
  MAX_HEADLESS_ORIGINS,
  MAX_NAV_LINKS,
  PRODUCT_CARD_LAYOUTS,
  RADIUS_STYLES,
  SOCIAL_NETWORKS,
  THEME_PRESET_IDS,
  ZONE_CODE,
} from "@devsfleet/shared-types";
import { z } from "zod";
import { href, https, imageUrl, label, text } from "./field-rules.js";

/**
 * Shape rules for the storefront's appearance, home sections, navigation,
 * region and headless settings. Cross-field rules that need the stored
 * settings or the plan (zones vs delivery rates, headless vs plan) live in
 * SettingsAdminService, not here.
 */

const hex = z.string().trim().regex(HEX_COLOR, "Use a six-digit hex colour like #0e6b53").transform((v) => v.toLowerCase());

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
        container: z.enum(CONTAINER_WIDTHS),
        stickyHeader: z.boolean(),
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

/** The section schemas live in sections.dto.ts: the home page and custom pages share them. */
export { HomeSectionsSchema } from "./sections.dto.js";

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
