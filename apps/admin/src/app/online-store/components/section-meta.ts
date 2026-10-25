import {
  COMMERCE_SECTION_TYPES,
  HOME_SECTION_LABELS,
  NAV_HREF,
  SECTION_ANCHOR,
  type HomeSection,
  type HomeSectionType,
  type SiteMode,
} from "@devsfleet/shared-types";

/** Caps mirror the API's validation, so the editor stops at the same number the server would. */
export const CAPS = { badges: 6, features: 12, cards: 24, stats: 6, gallery: 24, testimonials: 12, logos: 24, steps: 8, faq: 20, bullets: 8 } as const;

export const SHOP_TYPES: readonly HomeSectionType[] = ["hero", "trust_badges", "categories", "products", "promo_banner", "brands", "banner_strip"];
export const CONTENT_TYPES: readonly HomeSectionType[] = [
  "rich_text", "faq", "image_text", "features", "cards", "stats", "gallery", "testimonials", "logos", "steps", "cta_banner", "video", "map", "contact_info", "form", "spacer",
];

export const TYPE_HINTS: Record<HomeSectionType, string> = {
  hero: "The big opening banner: a photo with a headline and buttons.",
  trust_badges: "Short reasons to buy from you, with icons.",
  categories: "Tiles for your top departments.",
  products: "A row of product cards.",
  promo_banner: "A wide call-to-action panel.",
  brands: "Logos of your featured brands.",
  banner_strip: "Smaller promotional banners. They come from Banners.",
  rich_text: "A heading and paragraphs of your own words.",
  faq: "Questions and answers.",
  image_text: "A picture beside a block of text, with optional bullets and a button.",
  features: "A grid of icons with a title and a line of text.",
  cards: "Cards with a picture, title and link: services, projects or team members.",
  stats: "Big numbers: years in business, projects done.",
  gallery: "A grid of pictures.",
  testimonials: "Quotes from happy customers.",
  logos: "A row of client or partner logos.",
  steps: "A numbered process: how you work.",
  cta_banner: "A bold panel asking visitors to get in touch.",
  video: "A YouTube or Vimeo video.",
  map: "A map: your branches, or an embedded Google map.",
  contact_info: "Your address, phone, opening hours and social links.",
  form: "A form from the form builder, such as a contact or quote form.",
  spacer: "Empty space or a divider line between sections.",
};

const newIds = new Set<string>();
export function newSectionId(type: HomeSectionType, taken: Iterable<string> = []): string {
  const used = new Set(taken);
  for (;;) {
    const id = `${type.replace(/_/g, "-")}-${Math.random().toString(36).slice(2, 8)}`;
    if (!used.has(id) && !newIds.has(id)) {
      newIds.add(id);
      return id;
    }
  }
}

export function blankSection(type: HomeSectionType, taken: Iterable<string> = []): HomeSection {
  const id = newSectionId(type, taken);
  switch (type) {
    case "hero": return { id, type, enabled: true, settings: { variant: "image", align: "left", height: "md" } };
    case "trust_badges": return { id, type, enabled: true, settings: { items: [{ icon: "truck", title: "Fast delivery", text: "" }] } };
    case "categories": return { id, type, enabled: true, settings: { limit: 8 } };
    case "products": return { id, type, enabled: true, settings: { source: "best_sellers", title: "Best sellers", limit: 8 } };
    case "promo_banner": return { id, type, enabled: true, settings: {} };
    case "brands": return { id, type, enabled: true, settings: {} };
    case "banner_strip": return { id, type, enabled: true, settings: {} };
    case "rich_text": return { id, type, enabled: true, settings: { title: "", body: "" } };
    case "faq": return { id, type, enabled: true, settings: { title: "Frequently asked questions", items: [{ q: "", a: "" }] } };
    case "image_text": return { id, type, enabled: true, settings: { title: "", body: "", imageSide: "right" } };
    case "features": return { id, type, enabled: true, settings: { title: "Why choose us", columns: 3, items: [{ icon: "badge-check", title: "", text: "" }] } };
    case "cards": return { id, type, enabled: true, settings: { title: "Our services", variant: "card", columns: 3, items: [{ title: "" }] } };
    case "stats": return { id, type, enabled: true, settings: { items: [{ value: "", label: "" }] } };
    case "gallery": return { id, type, enabled: true, settings: { title: "Gallery", columns: 3, items: [] } };
    case "testimonials": return { id, type, enabled: true, settings: { title: "What our customers say", items: [{ quote: "", name: "" }] } };
    case "logos": return { id, type, enabled: true, settings: { title: "Trusted by", items: [] } };
    case "steps": return { id, type, enabled: true, settings: { title: "How it works", items: [{ title: "", text: "" }] } };
    case "cta_banner": return { id, type, enabled: true, settings: { headline: "Ready to start?", ctaLabel: "Get in touch", ctaHref: "/contact" } };
    case "video": return { id, type, enabled: true, settings: { title: "" } };
    case "map": return { id, type, enabled: true, settings: { mode: "branches", height: "md" } };
    case "contact_info": return { id, type, enabled: true, settings: { title: "Contact us", showBranches: true, showHours: true, showSocial: true } };
    case "form": return { id, type, enabled: true, settings: { title: "Get in touch", layout: "stacked" } };
    case "spacer": return { id, type, enabled: true, settings: { height: "md", divider: false } };
  }
}

export const IMAGE_URL = /^(https:\/\/|\/(?!\/))\S+$/;
const VIDEO_URL = /^https:\/\/(www\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com|vimeo\.com|player\.vimeo\.com)\//i;
const MAP_EMBED = /^https:\/\/(www\.google\.com\/maps\/embed|maps\.google\.com\/|www\.openstreetmap\.org\/export\/embed)/i;

const str = (v: unknown) => (typeof v === "string" ? v : "");
const items = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** What is wrong with one section, in plain words. Empty = fine to save. */
export function sectionProblems(s: HomeSection): string[] {
  const out: string[] = [];
  const st = s.settings as Record<string, unknown>;
  const href = (label: string, value: unknown) => {
    const v = str(value);
    if (v && !NAV_HREF.test(v)) out.push(`${label} must start with / or https://.`);
  };
  const image = (label: string, value: unknown) => {
    const v = str(value);
    if (v && !IMAGE_URL.test(v)) out.push(`${label} must be an https:// address or a path starting with /.`);
  };
  href("The button link", st.ctaHref);
  href("The second button link", st.secondaryHref);

  switch (s.type) {
    case "hero":
      image("The hero image", st.imageUrl);
      if (st.variant === "image" && !str(st.imageUrl)) out.push("A full-width image hero needs an image.");
      break;
    case "trust_badges":
      if (items<{ title: string }>(st.items).some((i) => !i.title.trim())) out.push("Every badge needs a title.");
      break;
    case "products":
      if (st.source === "category" && !str(st.categorySlug)) out.push("Choose which category to show.");
      break;
    case "rich_text":
      if (!str(st.body).trim() && !str(st.title).trim()) out.push("The text block is empty.");
      break;
    case "faq":
      if (items<{ q: string; a: string }>(st.items).some((i) => !i.q.trim() || !i.a.trim())) out.push("Every FAQ needs a question and an answer.");
      break;
    case "image_text":
      image("The image", st.imageUrl);
      if (!str(st.title).trim() && !str(st.body).trim()) out.push("Add a heading or some text.");
      break;
    case "features":
      if (items<{ title: string }>(st.items).some((i) => !i.title.trim())) out.push("Every feature needs a title.");
      break;
    case "cards":
      for (const i of items<{ title: string; imageUrl?: string; href?: string }>(st.items)) {
        if (!i.title.trim()) { out.push("Every card needs a title."); break; }
      }
      for (const i of items<{ imageUrl?: string; href?: string }>(st.items)) {
        if (i.imageUrl && !IMAGE_URL.test(i.imageUrl)) { out.push("A card image must be an https:// address or a path starting with /."); break; }
      }
      for (const i of items<{ href?: string }>(st.items)) {
        if (i.href && !NAV_HREF.test(i.href)) { out.push("A card link must start with / or https://."); break; }
      }
      break;
    case "stats":
      if (items<{ value: string; label: string }>(st.items).some((i) => !i.value.trim() || !i.label.trim())) out.push("Every number needs a value and a label.");
      break;
    case "gallery":
      for (const i of items<{ imageUrl: string }>(st.items)) {
        if (!IMAGE_URL.test(i.imageUrl)) { out.push("Every gallery picture needs an https:// address or a path starting with /."); break; }
      }
      break;
    case "testimonials":
      if (items<{ quote: string; name: string }>(st.items).some((i) => !i.quote.trim() || !i.name.trim())) out.push("Every testimonial needs a quote and a name.");
      for (const i of items<{ avatarUrl?: string }>(st.items)) {
        if (i.avatarUrl && !IMAGE_URL.test(i.avatarUrl)) { out.push("A testimonial photo must be an https:// address or a path starting with /."); break; }
      }
      break;
    case "logos":
      for (const i of items<{ imageUrl: string; name: string; href?: string }>(st.items)) {
        if (!IMAGE_URL.test(i.imageUrl) || !i.name.trim()) { out.push("Every logo needs a name and an https:// address or a path starting with /."); break; }
      }
      for (const i of items<{ href?: string }>(st.items)) {
        if (i.href && !NAV_HREF.test(i.href)) { out.push("A logo link must start with / or https://."); break; }
      }
      break;
    case "steps":
      if (items<{ title: string }>(st.items).some((i) => !i.title.trim())) out.push("Every step needs a title.");
      break;
    case "cta_banner":
      if (!str(st.headline).trim()) out.push("The call to action needs a headline.");
      break;
    case "video":
      if (!str(st.url).trim()) out.push("Paste a YouTube or Vimeo address.");
      else if (!VIDEO_URL.test(str(st.url))) out.push("Only YouTube and Vimeo addresses (https://) are supported.");
      break;
    case "map":
      if (st.mode === "embed" && !MAP_EMBED.test(str(st.embedUrl))) out.push("Paste a Google Maps or OpenStreetMap embed address (https://www.google.com/maps/embed…).");
      break;
    case "form":
      if (!str(st.formSlug)) out.push("Choose which form to show.");
      break;
    default:
      break;
  }
  const anchor = s.style?.anchor;
  if (anchor && !SECTION_ANCHOR.test(anchor)) out.push("The anchor uses lowercase letters, digits and hyphens, starting with a letter.");
  return out;
}

/** Problems across a whole list, prefixed with the section's position and name. Includes duplicate anchors. */
export function listProblems(sections: HomeSection[], mode: SiteMode | null): string[] {
  const out = sections.flatMap((s, i) => sectionProblems(s).map((p) => `${i + 1}. ${HOME_SECTION_LABELS[s.type]}: ${p}`));
  const seen = new Map<string, number>();
  sections.forEach((s, i) => {
    const a = s.style?.anchor;
    if (!a) return;
    if (seen.has(a)) out.push(`${i + 1}. ${HOME_SECTION_LABELS[s.type]}: the anchor “${a}” is already used by section ${seen.get(a)! + 1}.`);
    else seen.set(a, i);
  });
  void mode;
  return out;
}

export function isCommerce(type: HomeSectionType): boolean {
  return COMMERCE_SECTION_TYPES.includes(type);
}

/** One line shown when a section is collapsed. */
export function summarize(s: HomeSection): string {
  const st = s.settings as Record<string, unknown>;
  const n = (v: unknown) => items(v).length;
  const first = (...vals: unknown[]) => vals.map(str).find((v) => v.trim()) ?? "";
  const count = (v: unknown, noun: string) => `${n(v)} ${noun}${n(v) === 1 ? "" : "s"}`;
  switch (s.type) {
    case "hero": return first(st.headline) || `${str(st.variant) || "banner"} hero`;
    case "trust_badges": return count(st.items, "badge");
    case "categories": return `Up to ${st.limit ?? 8} departments`;
    case "products": return `${st.source === "new_arrivals" ? "New arrivals" : st.source === "category" ? `Category: ${str(st.categorySlug) || "—"}` : "Best sellers"} · ${st.limit ?? 8}`;
    case "promo_banner": return first(st.headline) || "Promo banner";
    case "brands": return first(st.title) || "Featured brands";
    case "banner_strip": return "Banners from Pages & banners";
    case "rich_text": return first(st.title, st.body).slice(0, 80) || "Empty text block";
    case "faq": return count(st.items, "question");
    case "image_text": return first(st.title, st.body).slice(0, 80) || "Image and text";
    case "features": return count(st.items, "feature");
    case "cards": return `${count(st.items, "card")} · ${str(st.variant) || "card"}`;
    case "stats": return count(st.items, "number");
    case "gallery": return count(st.items, "picture");
    case "testimonials": return count(st.items, "testimonial");
    case "logos": return count(st.items, "logo");
    case "steps": return count(st.items, "step");
    case "cta_banner": return first(st.headline) || "Call to action";
    case "video": return first(st.title, st.url) || "No video yet";
    case "map": return st.mode === "embed" ? "Embedded map" : "Branch locations";
    case "contact_info": return first(st.title) || "Contact details";
    case "form": return str(st.formSlug) ? `Form: ${str(st.formSlug)}` : "No form chosen";
    case "spacer": return `${str(st.height) || "md"} space${st.divider ? " with a line" : ""}`;
  }
}
