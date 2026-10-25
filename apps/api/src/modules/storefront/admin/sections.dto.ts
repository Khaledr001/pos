import {
  BADGE_ICONS,
  HOME_SECTION_TYPES,
  MAX_HOME_SECTIONS,
  MAX_PAGE_SECTIONS,
  FORM_SLUG,
  SECTION_ANCHOR,
  SECTION_BACKGROUNDS,
  SECTION_SPACING,
} from "@devsfleet/shared-types";
import { z } from "zod";
import { href, label, SLUG_LIKE, sectionImage, text } from "./field-rules.js";

/**
 * One definition of a page section, used by the home page AND every custom
 * page. Each type's settings are strict (an unknown key is an error, so a typo
 * is not silently stored) and capped (a page cannot be made enormous). Every
 * link is a site path or https URL; every image is https or an uploaded file;
 * embeds are limited to named providers — nothing a tenant types can run script
 * or load an arbitrary frame on the shop's origin.
 */

export const SectionStyleSchema = z
  .object({
    background: z.enum(SECTION_BACKGROUNDS),
    paddingY: z.enum(SECTION_SPACING),
    width: z.enum(["contained", "full"]),
    align: z.enum(["left", "center"]),
    anchor: z.string().trim().regex(SECTION_ANCHOR, "Lowercase letters, digits and hyphens, starting with a letter"),
    hideOnMobile: z.boolean(),
  })
  .partial()
  .strict();
const sectionBase = { id: z.string().trim().min(1).max(40).regex(/^[a-z0-9_-]+$/i, "Letters, digits, - and _ only"), enabled: z.boolean(), style: SectionStyleSchema.optional() };
const limit = z.coerce.number().int().min(1).max(12);
const columns = z.union([z.literal(2), z.literal(3), z.literal(4)]);

const TrustBadgeSchema = z.object({ icon: z.enum(BADGE_ICONS), title: label(60), text: text(200) });
const FaqItemSchema = z.object({ q: label(200), a: label(1000) });

const VIDEO_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "www.youtube-nocookie.com",
  "youtube-nocookie.com",
  "vimeo.com",
  "www.vimeo.com",
  "player.vimeo.com",
]);

/** A watch or embed link on YouTube or Vimeo. Parsed, not pattern-matched: `https://youtube.com.evil.test` fails. */
export const videoUrl = z
  .string()
  .trim()
  .max(300)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && VIDEO_HOSTS.has(url.hostname);
    } catch {
      return false;
    }
  }, "Use a YouTube or Vimeo link");

const MAP_EMBEDS: { origin: string; path: string }[] = [
  { origin: "https://www.google.com", path: "/maps/embed" },
  { origin: "https://maps.google.com", path: "/maps" },
  { origin: "https://www.openstreetmap.org", path: "/export/embed.html" },
];

/** The embed URL a map provider's "Share → Embed" gives you; nothing else becomes an iframe source. */
export const mapEmbedUrl = z
  .string()
  .trim()
  .max(1000)
  .refine((value) => {
    try {
      const url = new URL(value);
      return MAP_EMBEDS.some((m) => url.origin === m.origin && url.pathname.startsWith(m.path));
    } catch {
      return false;
    }
  }, "Paste the embed link from Google Maps (Share → Embed a map) or OpenStreetMap");

const CardItemSchema = z.object({ imageUrl: sectionImage.optional(), title: label(80), text: text(300).optional(), href: href.optional(), label: text(40).optional() });
const ImageItemSchema = z.object({ imageUrl: sectionImage, alt: text(200).optional(), caption: text(200).optional() });

const settings = <T extends z.ZodRawShape>(shape: T) => z.object(shape).partial().strict();

const HomeSectionSchemaUnion = z.discriminatedUnion("type", [
  z.object({
    ...sectionBase,
    type: z.literal("hero"),
    settings: settings({
      headline: text(120),
      subheadline: text(300),
      ctaLabel: text(40),
      ctaHref: href,
      secondaryLabel: text(40),
      secondaryHref: href,
      variant: z.enum(["banner", "split", "minimal", "image"]),
      imageUrl: sectionImage,
      align: z.enum(["left", "center"]),
      height: z.enum(["sm", "md", "lg"]),
    }),
  }),
  z.object({ ...sectionBase, type: z.literal("trust_badges"), settings: settings({ items: z.array(TrustBadgeSchema).max(6) }) }),
  z.object({
    ...sectionBase,
    type: z.literal("categories"),
    settings: settings({ title: text(80), limit: z.coerce.number().int().min(1).max(24) }),
  }),
  z.object({
    ...sectionBase,
    type: z.literal("products"),
    settings: settings({
      title: text(80),
      source: z.enum(["best_sellers", "new_arrivals", "category"]),
      categorySlug: z.string().trim().regex(SLUG_LIKE, "Use a category's address, like plumbing"),
      limit,
    }).refine((s) => s.source !== "category" || !!s.categorySlug, { message: "Pick the category to show", path: ["categorySlug"] }),
  }),
  z.object({
    ...sectionBase,
    type: z.literal("promo_banner"),
    settings: settings({ headline: text(120), text: text(300), ctaLabel: text(40), ctaHref: href }),
  }),
  z.object({ ...sectionBase, type: z.literal("brands"), settings: settings({ title: text(80) }) }),
  z.object({ ...sectionBase, type: z.literal("banner_strip"), settings: z.object({}).strict() }),
  z.object({ ...sectionBase, type: z.literal("rich_text"), settings: settings({ title: text(120), body: text(5000) }) }),
  z.object({ ...sectionBase, type: z.literal("faq"), settings: settings({ title: text(80), items: z.array(FaqItemSchema).max(20) }) }),
  z.object({
    ...sectionBase,
    type: z.literal("image_text"),
    settings: settings({
      title: text(120),
      body: text(3000),
      imageUrl: sectionImage,
      imageAlt: text(200),
      imageSide: z.enum(["left", "right"]),
      bullets: z.array(label(120)).max(8),
      ctaLabel: text(40),
      ctaHref: href,
    }),
  }),
  z.object({
    ...sectionBase,
    type: z.literal("features"),
    settings: settings({
      title: text(120),
      subtitle: text(300),
      columns,
      items: z.array(z.object({ icon: z.enum(BADGE_ICONS), title: label(60), text: text(240) })).max(12),
    }),
  }),
  z.object({
    ...sectionBase,
    type: z.literal("cards"),
    settings: settings({
      title: text(120),
      subtitle: text(300),
      variant: z.enum(["card", "plain", "overlay", "person"]),
      columns,
      items: z.array(CardItemSchema).max(24),
    }),
  }),
  z.object({
    ...sectionBase,
    type: z.literal("stats"),
    settings: settings({ title: text(120), items: z.array(z.object({ value: label(20), label: label(60) })).max(6) }),
  }),
  z.object({
    ...sectionBase,
    type: z.literal("gallery"),
    settings: settings({ title: text(120), columns, items: z.array(ImageItemSchema).max(24) }),
  }),
  z.object({
    ...sectionBase,
    type: z.literal("testimonials"),
    settings: settings({
      title: text(120),
      items: z.array(z.object({ quote: label(500), name: label(80), role: text(80).optional(), avatarUrl: sectionImage.optional() })).max(12),
    }),
  }),
  z.object({
    ...sectionBase,
    type: z.literal("logos"),
    settings: settings({ title: text(120), items: z.array(z.object({ imageUrl: sectionImage, name: label(80), href: href.optional() })).max(24) }),
  }),
  z.object({
    ...sectionBase,
    type: z.literal("steps"),
    settings: settings({ title: text(120), subtitle: text(300), items: z.array(z.object({ title: label(80), text: text(300) })).max(8) }),
  }),
  z.object({
    ...sectionBase,
    type: z.literal("cta_banner"),
    settings: settings({
      headline: text(120),
      text: text(300),
      ctaLabel: text(40),
      ctaHref: href,
      secondaryLabel: text(40),
      secondaryHref: href,
      showWhatsapp: z.boolean(),
    }),
  }),
  z.object({ ...sectionBase, type: z.literal("video"), settings: settings({ title: text(120), url: videoUrl, caption: text(200) }) }),
  z.object({
    ...sectionBase,
    type: z.literal("map"),
    settings: settings({ title: text(120), mode: z.enum(["branches", "embed"]), embedUrl: mapEmbedUrl, height: z.enum(["sm", "md", "lg"]) }).refine(
      (s) => s.mode !== "embed" || !!s.embedUrl,
      { message: "Paste the map's embed link", path: ["embedUrl"] },
    ),
  }),
  z.object({
    ...sectionBase,
    type: z.literal("contact_info"),
    settings: settings({ title: text(120), showBranches: z.boolean(), showHours: z.boolean(), showSocial: z.boolean() }),
  }),
  z.object({
    ...sectionBase,
    type: z.literal("form"),
    settings: settings({
      title: text(120),
      subtitle: text(300),
      formSlug: z.string().trim().regex(FORM_SLUG, "Use a form's address, like contact"),
      layout: z.enum(["stacked", "split"]),
    }),
  }),
  z.object({
    ...sectionBase,
    type: z.literal("spacer"),
    settings: settings({ height: z.enum(["sm", "md", "lg"]), divider: z.boolean() }),
  }),
]);

// Fails loudly if a type is added to the shared list without a schema here.
const _everyTypeHasASchema: (typeof HOME_SECTION_TYPES)[number] extends z.infer<typeof HomeSectionSchemaUnion>["type"] ? true : never = true;
void _everyTypeHasASchema;

function uniqueIdsAndAnchors(sections: { id: string; style?: { anchor?: string } }[]): boolean {
  const anchors = sections.map((s) => s.style?.anchor).filter((a): a is string => !!a);
  return new Set(sections.map((s) => s.id)).size === sections.length && new Set(anchors).size === anchors.length;
}

const UNIQUE = { message: "Section ids and anchors must be unique" };

export const HomeSectionsSchema = z.array(HomeSectionSchemaUnion).max(MAX_HOME_SECTIONS).refine(uniqueIdsAndAnchors, UNIQUE);
export const PageSectionsSchema = z.array(HomeSectionSchemaUnion).max(MAX_PAGE_SECTIONS).refine(uniqueIdsAndAnchors, UNIQUE);
export type SectionsDto = z.infer<typeof PageSectionsSchema>;
