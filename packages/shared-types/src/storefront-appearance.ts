/**
 * How one tenant's online store looks, reads and behaves regionally.
 *
 * Everything here is data stored in `storefronts.settings` (JSONB) and applied
 * by the ONE storefront deployment at request time: CSS variables for the
 * theme, an ordered section list for the home page, link lists for navigation,
 * and a region block for currency, language and delivery zones. A tenant never
 * gets its own code — that is what keeps one deployment serving every shop.
 */

const asConst = <const T extends readonly string[]>(values: T) => values;

// ── theme ────────────────────────────────────────────────────────────────

export const THEME_PRESET_IDS = asConst(["workshop", "ocean", "boutique", "fresh", "midnight"]);
export type ThemePresetId = (typeof THEME_PRESET_IDS)[number];

/** Fonts the storefront build ships. A tenant picks one; it cannot load its own. */
export const FONT_PAIR_IDS = asConst(["barlow", "inter", "poppins", "serif"]);
export type FontPairId = (typeof FONT_PAIR_IDS)[number];

export const RADIUS_STYLES = asConst(["sharp", "soft", "round"]);
export type RadiusStyle = (typeof RADIUS_STYLES)[number];

/**
 * classic/centered/compact are shop headers (search, account, cart). `simple` is
 * a brochure header: logo, menu links and one call-to-action button.
 */
export const HEADER_LAYOUTS = asConst(["classic", "centered", "compact", "simple"]);
export type HeaderLayout = (typeof HEADER_LAYOUTS)[number];

export const PRODUCT_CARD_LAYOUTS = asConst(["standard", "minimal", "bordered"]);
export type ProductCardLayout = (typeof PRODUCT_CARD_LAYOUTS)[number];

/** `minimal` is a single row: name, legal links and social icons. */
export const FOOTER_LAYOUTS = asConst(["dark", "light", "minimal"]);
export type FooterLayout = (typeof FOOTER_LAYOUTS)[number];

/** Page content width: boxed is the 80rem column, wide is 96rem. */
export const CONTAINER_WIDTHS = asConst(["boxed", "wide"]);
export type ContainerWidth = (typeof CONTAINER_WIDTHS)[number];

/** Six-digit hex, e.g. "#0e6b53". Everything else (tints, hover shades) is derived in CSS. */
export type HexColor = string;
export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export interface ThemeColors {
  /** Text, header bar, dark panels. */
  ink: HexColor;
  /** Primary action: buttons, links, "in stock". */
  accent: HexColor;
  /** Offers, trade prices, highlights. */
  highlight: HexColor;
  /** Page background. */
  background: HexColor;
  /** Cards and panels. */
  surface: HexColor;
}

export interface StorefrontTheme {
  /** The preset the colours started from; informational, the colours are what render. */
  preset: ThemePresetId;
  colors: ThemeColors;
  font: FontPairId;
  radius: RadiusStyle;
  layout: {
    header: HeaderLayout;
    productCard: ProductCardLayout;
    footer: FooterLayout;
    container: ContainerWidth;
    /** The header stays visible while scrolling. */
    stickyHeader: boolean;
  };
  /** Public URLs from the platform's asset storage. */
  faviconUrl: string | null;
  shareImageUrl: string | null;
  announcement: { enabled: boolean; text: string; href: string | null };
  social: SocialLinks;
}

export interface SocialLinks {
  instagram?: string;
  facebook?: string;
  x?: string;
  tiktok?: string;
  youtube?: string;
  linkedin?: string;
  snapchat?: string;
}
export const SOCIAL_NETWORKS = asConst(["instagram", "facebook", "x", "tiktok", "youtube", "linkedin", "snapchat"]);

export const THEME_PRESETS: Record<ThemePresetId, { label: string; blurb: string; colors: ThemeColors; font: FontPairId; radius: RadiusStyle; layout: StorefrontTheme["layout"] }> = {
  workshop: {
    label: "Workshop",
    blurb: "Graphite and green. Trade counters, tools, building supply.",
    colors: { ink: "#1c2530", accent: "#0e6b53", highlight: "#c9971c", background: "#f4f6f7", surface: "#ffffff" },
    font: "barlow",
    radius: "sharp",
    layout: { header: "classic", productCard: "standard", footer: "dark", container: "boxed", stickyHeader: true },
  },
  ocean: {
    label: "Ocean",
    blurb: "Clean blue on white. Electronics, general retail.",
    colors: { ink: "#10243e", accent: "#1d5fd6", highlight: "#f59e0b", background: "#f5f8fc", surface: "#ffffff" },
    font: "inter",
    radius: "soft",
    layout: { header: "classic", productCard: "bordered", footer: "dark", container: "boxed", stickyHeader: true },
  },
  boutique: {
    label: "Boutique",
    blurb: "Warm neutrals and serif headings. Fashion, home, gifts.",
    colors: { ink: "#2b2622", accent: "#8a5a44", highlight: "#b8860b", background: "#faf7f2", surface: "#ffffff" },
    font: "serif",
    radius: "round",
    layout: { header: "centered", productCard: "minimal", footer: "light", container: "boxed", stickyHeader: true },
  },
  fresh: {
    label: "Fresh",
    blurb: "Bright green and rounded corners. Grocery, pharmacy, food.",
    colors: { ink: "#14291d", accent: "#16a34a", highlight: "#f97316", background: "#f6faf6", surface: "#ffffff" },
    font: "poppins",
    radius: "round",
    layout: { header: "compact", productCard: "standard", footer: "light", container: "boxed", stickyHeader: true },
  },
  midnight: {
    label: "Midnight",
    blurb: "Near-black with a vivid accent. Gadgets, gaming, auto.",
    colors: { ink: "#0f1115", accent: "#e11d48", highlight: "#facc15", background: "#eef0f3", surface: "#ffffff" },
    font: "inter",
    radius: "soft",
    layout: { header: "compact", productCard: "bordered", footer: "dark", container: "boxed", stickyHeader: true },
  },
};

export const DEFAULT_THEME_PRESET: ThemePresetId = "workshop";

export const DEFAULT_THEME: StorefrontTheme = {
  preset: DEFAULT_THEME_PRESET,
  colors: THEME_PRESETS.workshop.colors,
  font: THEME_PRESETS.workshop.font,
  radius: THEME_PRESETS.workshop.radius,
  layout: THEME_PRESETS.workshop.layout,
  faviconUrl: null,
  shareImageUrl: null,
  announcement: { enabled: false, text: "", href: null },
  social: {},
};

// ── page sections ────────────────────────────────────────────────────────
//
// A page — the home page or any custom page — is an ordered list of sections.
// The same registry renders all of them, so a tenant can build a shop front, a
// company profile or a one-page landing from the same parts.

export const HOME_SECTION_TYPES = asConst([
  // shop
  "hero",
  "trust_badges",
  "categories",
  "products",
  "promo_banner",
  "brands",
  "banner_strip",
  // content
  "rich_text",
  "faq",
  "image_text",
  "features",
  "cards",
  "stats",
  "gallery",
  "testimonials",
  "logos",
  "steps",
  "cta_banner",
  "video",
  "map",
  "contact_info",
  "form",
  "spacer",
]);
export type HomeSectionType = (typeof HOME_SECTION_TYPES)[number];

/** Section types that need the product catalogue; hidden in a `showcase` site. */
export const COMMERCE_SECTION_TYPES: readonly HomeSectionType[] = ["categories", "products", "promo_banner", "brands", "banner_strip", "trust_badges"];

/** Icons a feature or trust badge may use. A closed set, so a tenant never injects markup. */
export const BADGE_ICONS = asConst([
  "truck", "shield", "badge-check", "headset", "refresh", "credit-card", "clock", "package", "star", "leaf",
  "wrench", "hammer", "building", "users", "award", "phone", "mail", "map-pin", "globe", "heart", "lightbulb",
  "ruler", "zap", "droplet", "briefcase", "chart", "lock", "thumbs-up",
]);
export type BadgeIcon = (typeof BADGE_ICONS)[number];

export interface TrustBadge {
  icon: BadgeIcon;
  title: string;
  text: string;
}

export interface FaqItem {
  q: string;
  a: string;
}

export const SECTION_BACKGROUNDS = asConst(["none", "surface", "tint", "accent", "dark"]);
export type SectionBackground = (typeof SECTION_BACKGROUNDS)[number];
export const SECTION_SPACING = asConst(["none", "sm", "md", "lg"]);
export type SectionSpacing = (typeof SECTION_SPACING)[number];

/** Look shared by every section type. All optional; absent = the type's own default. */
export interface SectionStyle {
  background?: SectionBackground;
  paddingY?: SectionSpacing;
  /** contained = inside the page column; full = edge to edge. */
  width?: "contained" | "full";
  align?: "left" | "center";
  /** Lets a menu link jump here: `#<anchor>`. Lowercase letters, digits, hyphens. */
  anchor?: string;
  hideOnMobile?: boolean;
}
export const SECTION_ANCHOR = /^[a-z][a-z0-9-]{0,39}$/;

export interface ImageItem {
  imageUrl: string;
  alt?: string;
  caption?: string;
}

export interface CardItem {
  imageUrl?: string;
  title: string;
  text?: string;
  href?: string;
  /** Link text, e.g. "Learn more". */
  label?: string;
}

/** Per-type settings. Every field is optional: a section with `{}` renders sensible defaults. */
export interface HomeSectionSettings {
  hero: {
    headline?: string;
    subheadline?: string;
    ctaLabel?: string;
    ctaHref?: string;
    secondaryLabel?: string;
    secondaryHref?: string;
    /** `image` = full-width photo behind the text; the others use the shop's hero banners. */
    variant?: "banner" | "split" | "minimal" | "image";
    /** The photo for `image` and `split`. */
    imageUrl?: string;
    align?: "left" | "center";
    height?: "sm" | "md" | "lg";
  };
  trust_badges: { items?: TrustBadge[] };
  categories: { title?: string; limit?: number };
  products: { title?: string; source?: "best_sellers" | "new_arrivals" | "category"; categorySlug?: string; limit?: number };
  promo_banner: { headline?: string; text?: string; ctaLabel?: string; ctaHref?: string };
  brands: { title?: string };
  banner_strip: Record<string, never>;
  rich_text: { title?: string; body?: string };
  faq: { title?: string; items?: FaqItem[] };
  image_text: { title?: string; body?: string; imageUrl?: string; imageAlt?: string; imageSide?: "left" | "right"; bullets?: string[]; ctaLabel?: string; ctaHref?: string };
  features: { title?: string; subtitle?: string; columns?: 2 | 3 | 4; items?: { icon: BadgeIcon; title: string; text: string }[] };
  cards: { title?: string; subtitle?: string; variant?: "card" | "plain" | "overlay" | "person"; columns?: 2 | 3 | 4; items?: CardItem[] };
  stats: { title?: string; items?: { value: string; label: string }[] };
  gallery: { title?: string; columns?: 2 | 3 | 4; items?: ImageItem[] };
  testimonials: { title?: string; items?: { quote: string; name: string; role?: string; avatarUrl?: string }[] };
  logos: { title?: string; items?: { imageUrl: string; name: string; href?: string }[] };
  steps: { title?: string; subtitle?: string; items?: { title: string; text: string }[] };
  cta_banner: { headline?: string; text?: string; ctaLabel?: string; ctaHref?: string; secondaryLabel?: string; secondaryHref?: string; showWhatsapp?: boolean };
  /** YouTube or Vimeo watch/embed URL only; rendered through the provider's privacy-friendly embed. */
  video: { title?: string; url?: string; caption?: string };
  map: { title?: string; mode?: "branches" | "embed"; /** https://www.google.com/maps/embed… or openstreetmap embed */ embedUrl?: string; height?: "sm" | "md" | "lg" };
  contact_info: { title?: string; showBranches?: boolean; showHours?: boolean; showSocial?: boolean };
  /** Embeds a form from the form builder. */
  form: { title?: string; subtitle?: string; formSlug?: string; layout?: "stacked" | "split" };
  spacer: { height?: "sm" | "md" | "lg"; divider?: boolean };
}

export type HomeSection = {
  [T in HomeSectionType]: {
    /** Stable id so the editor can reorder without losing a section's settings. */
    id: string;
    type: T;
    enabled: boolean;
    settings: HomeSectionSettings[T];
    style?: SectionStyle;
  };
}[HomeSectionType];

/** A page's sections are the same thing as the home page's. */
export type PageSection = HomeSection;

export const HOME_SECTION_LABELS: Record<HomeSectionType, string> = {
  hero: "Hero",
  trust_badges: "Trust badges",
  categories: "Departments",
  products: "Product row",
  promo_banner: "Promo banner",
  brands: "Brands",
  banner_strip: "Banner strip",
  rich_text: "Text block",
  faq: "FAQ",
  image_text: "Image + text",
  features: "Feature grid",
  cards: "Cards (services, projects, team)",
  stats: "Numbers",
  gallery: "Image gallery",
  testimonials: "Testimonials",
  logos: "Client logos",
  steps: "Process steps",
  cta_banner: "Call to action",
  video: "Video",
  map: "Map",
  contact_info: "Contact details",
  form: "Form",
  spacer: "Spacer / divider",
};

/** Max sections on one page; keeps the page fast and the editor sane. */
export const MAX_HOME_SECTIONS = 30;
export const MAX_PAGE_SECTIONS = 30;

/** How a custom page frames its content: `standard` = title + breadcrumb; `full` = sections edge to edge. */
export const PAGE_LAYOUTS = asConst(["standard", "full"]);
export type PageLayout = (typeof PAGE_LAYOUTS)[number];

/** What the home page looked like before sections were configurable. */
export const DEFAULT_HOME_SECTIONS: HomeSection[] = [
  { id: "hero", type: "hero", enabled: true, settings: { variant: "banner" } },
  {
    id: "trust",
    type: "trust_badges",
    enabled: true,
    settings: {
      items: [
        { icon: "truck", title: "Fast delivery", text: "Delivered to your door or ready for pickup." },
        { icon: "shield", title: "Genuine products", text: "Sourced from authorised suppliers." },
        { icon: "headset", title: "Friendly support", text: "Talk to a real person on WhatsApp." },
      ],
    },
  },
  { id: "departments", type: "categories", enabled: true, settings: { limit: 8 } },
  { id: "best-sellers", type: "products", enabled: true, settings: { source: "best_sellers", title: "Best sellers", limit: 8 } },
  { id: "promo", type: "promo_banner", enabled: true, settings: {} },
  { id: "brands", type: "brands", enabled: true, settings: {} },
  { id: "new", type: "products", enabled: true, settings: { source: "new_arrivals", title: "New arrivals", limit: 8 } },
];

// ── navigation ───────────────────────────────────────────────────────────

export interface NavLink {
  label: string;
  /** A path on this shop ("/pages/about") or an https URL. */
  href: string;
}

export interface FooterColumn {
  title: string;
  links: NavLink[];
}

export interface StorefrontNavigation {
  /** Extra links beside the department menu. Empty = departments only. */
  header: NavLink[];
  /** Empty = the built-in Shop / Help / Company columns. */
  footerColumns: FooterColumn[];
  /** Small links in the bottom bar (Privacy, Terms…). Empty = the built-in two. */
  legal: NavLink[];
  /** Free text under the logo in the footer. */
  footerNote: string;
}

export const MAX_NAV_LINKS = 12;
export const MAX_FOOTER_COLUMNS = 4;

export const DEFAULT_NAVIGATION: StorefrontNavigation = { header: [], footerColumns: [], legal: [], footerNote: "" };

/** A site path or an https URL; nothing else (no javascript:, no protocol-relative). */
export const NAV_HREF = /^(\/(?![/\\])[^\s]*|https:\/\/[^\s]+)$/;

// ── region ───────────────────────────────────────────────────────────────

export interface RegionZone {
  /** Stable, upper-case, ≤20 chars. Stored on addresses and orders. */
  code: string;
  name: string;
}

export interface StorefrontRegion {
  /** ISO 3166-1 alpha-2. */
  country: string;
  /** Digits only, no "+": what a local phone number is prefixed with. */
  callingCode: string;
  /** What the shopper calls a delivery zone here: "Emirate", "Region", "Governorate". */
  zoneLabel: string;
  zones: RegionZone[];
  /** "VAT", "GST"… shown beside prices. */
  taxLabel: string;
  /** Tax registration label on invoices and the footer: "TRN", "VAT No.", "GSTIN". */
  taxIdLabel: string;
  /** BCP-47 tag used to format numbers and dates. */
  formatLocale: string;
}

export const REGION_PRESETS: Record<string, StorefrontRegion & { label: string }> = {
  AE: {
    label: "United Arab Emirates",
    country: "AE",
    callingCode: "971",
    zoneLabel: "Emirate",
    zones: [
      { code: "ABU_DHABI", name: "Abu Dhabi" },
      { code: "DUBAI", name: "Dubai" },
      { code: "SHARJAH", name: "Sharjah" },
      { code: "AJMAN", name: "Ajman" },
      { code: "UMM_AL_QUWAIN", name: "Umm Al Quwain" },
      { code: "RAS_AL_KHAIMAH", name: "Ras Al Khaimah" },
      { code: "FUJAIRAH", name: "Fujairah" },
    ],
    taxLabel: "VAT",
    taxIdLabel: "TRN",
    formatLocale: "en-AE",
  },
  SA: {
    label: "Saudi Arabia",
    country: "SA",
    callingCode: "966",
    zoneLabel: "Region",
    zones: [
      { code: "RIYADH", name: "Riyadh" },
      { code: "MAKKAH", name: "Makkah" },
      { code: "MADINAH", name: "Madinah" },
      { code: "EASTERN", name: "Eastern Province" },
      { code: "QASSIM", name: "Qassim" },
      { code: "ASIR", name: "Asir" },
      { code: "TABUK", name: "Tabuk" },
      { code: "HAIL", name: "Hail" },
      { code: "NORTHERN_BORDERS", name: "Northern Borders" },
      { code: "JAZAN", name: "Jazan" },
      { code: "NAJRAN", name: "Najran" },
      { code: "AL_BAHA", name: "Al Baha" },
      { code: "AL_JOUF", name: "Al Jouf" },
    ],
    taxLabel: "VAT",
    taxIdLabel: "VAT No.",
    formatLocale: "en-SA",
  },
  QA: {
    label: "Qatar",
    country: "QA",
    callingCode: "974",
    zoneLabel: "Municipality",
    zones: [
      { code: "DOHA", name: "Doha" },
      { code: "AL_RAYYAN", name: "Al Rayyan" },
      { code: "AL_WAKRAH", name: "Al Wakrah" },
      { code: "AL_KHOR", name: "Al Khor" },
      { code: "UMM_SALAL", name: "Umm Salal" },
      { code: "AL_DAAYEN", name: "Al Daayen" },
      { code: "AL_SHAMAL", name: "Al Shamal" },
      { code: "AL_SHAHANIYA", name: "Al Shahaniya" },
    ],
    taxLabel: "Tax",
    taxIdLabel: "Tax ID",
    formatLocale: "en-QA",
  },
  KW: {
    label: "Kuwait",
    country: "KW",
    callingCode: "965",
    zoneLabel: "Governorate",
    zones: [
      { code: "AL_ASIMAH", name: "Al Asimah" },
      { code: "HAWALLI", name: "Hawalli" },
      { code: "FARWANIYA", name: "Farwaniya" },
      { code: "AHMADI", name: "Ahmadi" },
      { code: "JAHRA", name: "Jahra" },
      { code: "MUBARAK_AL_KABEER", name: "Mubarak Al-Kabeer" },
    ],
    taxLabel: "Tax",
    taxIdLabel: "Tax ID",
    formatLocale: "en-KW",
  },
  BH: {
    label: "Bahrain",
    country: "BH",
    callingCode: "973",
    zoneLabel: "Governorate",
    zones: [
      { code: "CAPITAL", name: "Capital" },
      { code: "MUHARRAQ", name: "Muharraq" },
      { code: "NORTHERN", name: "Northern" },
      { code: "SOUTHERN", name: "Southern" },
    ],
    taxLabel: "VAT",
    taxIdLabel: "VAT No.",
    formatLocale: "en-BH",
  },
  OM: {
    label: "Oman",
    country: "OM",
    callingCode: "968",
    zoneLabel: "Governorate",
    zones: [
      { code: "MUSCAT", name: "Muscat" },
      { code: "DHOFAR", name: "Dhofar" },
      { code: "BATINAH_NORTH", name: "North Al Batinah" },
      { code: "BATINAH_SOUTH", name: "South Al Batinah" },
      { code: "SHARQIYAH_NORTH", name: "North Al Sharqiyah" },
      { code: "SHARQIYAH_SOUTH", name: "South Al Sharqiyah" },
      { code: "DAKHILIYAH", name: "Ad Dakhiliyah" },
      { code: "DHAHIRAH", name: "Ad Dhahirah" },
      { code: "BURAIMI", name: "Al Buraimi" },
      { code: "WUSTA", name: "Al Wusta" },
      { code: "MUSANDAM", name: "Musandam" },
    ],
    taxLabel: "VAT",
    taxIdLabel: "VAT No.",
    formatLocale: "en-OM",
  },
  PK: {
    label: "Pakistan",
    country: "PK",
    callingCode: "92",
    zoneLabel: "Province",
    zones: [
      { code: "PUNJAB", name: "Punjab" },
      { code: "SINDH", name: "Sindh" },
      { code: "KPK", name: "Khyber Pakhtunkhwa" },
      { code: "BALOCHISTAN", name: "Balochistan" },
      { code: "ISLAMABAD", name: "Islamabad Capital Territory" },
      { code: "GILGIT_BALTISTAN", name: "Gilgit-Baltistan" },
      { code: "AJK", name: "Azad Jammu & Kashmir" },
    ],
    taxLabel: "GST",
    taxIdLabel: "NTN",
    formatLocale: "en-PK",
  },
  BD: {
    label: "Bangladesh",
    country: "BD",
    callingCode: "880",
    zoneLabel: "Division",
    zones: [
      { code: "DHAKA", name: "Dhaka" },
      { code: "CHATTOGRAM", name: "Chattogram" },
      { code: "RAJSHAHI", name: "Rajshahi" },
      { code: "KHULNA", name: "Khulna" },
      { code: "BARISHAL", name: "Barishal" },
      { code: "SYLHET", name: "Sylhet" },
      { code: "RANGPUR", name: "Rangpur" },
      { code: "MYMENSINGH", name: "Mymensingh" },
    ],
    taxLabel: "VAT",
    taxIdLabel: "BIN",
    formatLocale: "en-BD",
  },
};

export const DEFAULT_REGION_CODE = "AE";
export const DEFAULT_REGION: StorefrontRegion = stripLabel(REGION_PRESETS[DEFAULT_REGION_CODE]!);

function stripLabel(r: StorefrontRegion & { label: string }): StorefrontRegion {
  const { label: _label, ...region } = r;
  return region;
}

/** A zone code is stored on addresses and orders, so keep it boring. */
export const ZONE_CODE = /^[A-Z0-9_]{1,20}$/;

// ── headless ─────────────────────────────────────────────────────────────

/**
 * Lets a tenant's own front end (built by an agency, or a mobile app) read the
 * public catalogue straight from the browser. Gated on the plan's `apiAccess`.
 * Server-to-server use needs none of this: a custom frontend that proxies
 * through its own server is the same first-party pattern the hosted shop uses.
 */
export interface HeadlessSettings {
  enabled: boolean;
  /** Exact origins, e.g. "https://shop.example.com". No wildcards. */
  allowedOrigins: string[];
}

export const DEFAULT_HEADLESS: HeadlessSettings = { enabled: false, allowedOrigins: [] };
export const MAX_HEADLESS_ORIGINS = 10;

/** Merge stored partial appearance data over the defaults, one level per block. */
export function resolveTheme(stored: Partial<StorefrontTheme> | undefined): StorefrontTheme {
  const d = DEFAULT_THEME;
  const s = stored ?? {};
  return {
    ...d,
    ...s,
    colors: { ...d.colors, ...s.colors },
    layout: { ...d.layout, ...s.layout },
    announcement: { ...d.announcement, ...s.announcement },
    social: { ...d.social, ...s.social },
  };
}

export function resolveNavigation(stored: Partial<StorefrontNavigation> | undefined): StorefrontNavigation {
  return { ...DEFAULT_NAVIGATION, ...stored };
}

export function resolveRegion(stored: Partial<StorefrontRegion> | undefined): StorefrontRegion {
  const merged = { ...DEFAULT_REGION, ...stored };
  // A region with no zones could never take a delivery address.
  return merged.zones.length > 0 ? merged : { ...merged, zones: DEFAULT_REGION.zones };
}
