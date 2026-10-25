/**
 * What kind of website a tenant runs, and which parts of the platform it uses.
 *
 * One storefront deployment serves shops, product catalogues, company sites and
 * landing pages. The difference is DATA: a `mode`, a set of derived feature
 * flags, and the page sections a template pre-fills. The flags are enforced by
 * the API (a catalogue site's cart and checkout routes refuse), and merely
 * reflected by the storefront's navigation — rule 9: a client-side check is
 * never the control.
 */
import type { HomeSection, PageLayout, StorefrontTheme, ThemePresetId } from "./storefront-appearance.js";
import type { FormDef } from "./storefront-forms.js";

const asConst = <const T extends readonly string[]>(values: T) => values;

/**
 * shop      full e-commerce: cart, checkout, accounts, order tracking.
 * catalogue products are browsable but not buyable; actions become enquiries.
 * showcase  no products at all: a company or landing site.
 */
export const SITE_MODES = asConst(["shop", "catalogue", "showcase"]);
export type SiteMode = (typeof SITE_MODES)[number];

export const SITE_TEMPLATE_IDS = asConst(["shop", "catalogue", "corporate", "landing"]);
export type SiteTemplateId = (typeof SITE_TEMPLATE_IDS)[number];

export interface SiteSettings {
  /** The template the site started from; "custom" once it has drifted far enough that nobody cares. */
  template: SiteTemplateId | "custom";
  mode: SiteMode;
  /** Catalogue mode: show prices or hide them (the API stops sending them). Ignored in other modes. */
  showPrices: boolean;
  /** Catalogue mode: how a visitor asks about a product. At least one should be on. */
  enquiry: {
    form: boolean;
    whatsapp: boolean;
    call: boolean;
    /** The form behind the "Enquire" button. Created with the template. */
    formSlug: string;
  };
  /** Shop and catalogue modes only; a showcase site has neither. */
  features: { search: boolean; account: boolean };
  /** One button in the header, e.g. "Get a quote". */
  headerCta: { label: string; href: string } | null;
}

export const DEFAULT_ENQUIRY_FORM_SLUG = "product-enquiry";

export const DEFAULT_SITE: SiteSettings = {
  template: "shop",
  mode: "shop",
  showPrices: true,
  enquiry: { form: true, whatsapp: true, call: false, formSlug: DEFAULT_ENQUIRY_FORM_SLUG },
  features: { search: true, account: true },
  headerCta: null,
};

/** What the site can do, derived from its settings. The one place this is decided. */
export interface SiteFeatures {
  /** Product, category, brand and search pages exist. */
  products: boolean;
  /** Prices are sent to browsers. */
  prices: boolean;
  cart: boolean;
  checkout: boolean;
  /** Shopper sign-in, order history, saved lists, trade accounts, quotes. */
  accounts: boolean;
  /** "Track an order" by token. */
  tracking: boolean;
  /** Back-in-stock alerts. */
  stockAlerts: boolean;
  search: boolean;
  compare: boolean;
  /** Product pages offer "Enquire". */
  enquiries: boolean;
}

export function resolveSiteFeatures(site: SiteSettings): SiteFeatures {
  switch (site.mode) {
    case "shop":
      return {
        products: true,
        prices: true,
        cart: true,
        checkout: true,
        accounts: site.features.account,
        tracking: true,
        stockAlerts: true,
        search: site.features.search,
        compare: true,
        enquiries: false,
      };
    case "catalogue":
      return {
        products: true,
        prices: site.showPrices,
        cart: false,
        checkout: false,
        accounts: false,
        tracking: false,
        stockAlerts: false,
        search: site.features.search,
        compare: true,
        enquiries: true,
      };
    case "showcase":
      return {
        products: false,
        prices: false,
        cart: false,
        checkout: false,
        accounts: false,
        tracking: false,
        stockAlerts: false,
        search: false,
        compare: false,
        enquiries: false,
      };
  }
}

export function resolveSite(stored: Partial<SiteSettings> | undefined): SiteSettings {
  const s = stored ?? {};
  return {
    ...DEFAULT_SITE,
    ...s,
    enquiry: { ...DEFAULT_SITE.enquiry, ...s.enquiry },
    features: { ...DEFAULT_SITE.features, ...s.features },
    headerCta: s.headerCta === undefined ? DEFAULT_SITE.headerCta : s.headerCta,
  };
}

// ── templates ────────────────────────────────────────────────────────────

export interface SiteTemplatePage {
  slug: string;
  title: string;
  seoDescription?: string;
  layout: PageLayout;
  sections: HomeSection[];
}

/**
 * A starting point. Applying one writes the site mode, layout, navigation and
 * home sections into the settings, creates any of its pages and forms that do
 * not exist yet, and (optionally) its theme preset. Nothing is linked back: the
 * tenant owns the result and reconfigures it freely.
 */
export interface SiteTemplate {
  id: SiteTemplateId;
  label: string;
  /** One line shown on the picker card. */
  blurb: string;
  /** Who it suits, for the picker. */
  bestFor: string;
  mode: SiteMode;
  themePreset: ThemePresetId;
  layout: Partial<StorefrontTheme["layout"]>;
  site: Partial<SiteSettings>;
  navigation: {
    header: { label: string; href: string }[];
    footerColumns: { title: string; links: { label: string; href: string }[] }[];
    legal: { label: string; href: string }[];
    footerNote: string;
  };
  homeSections: HomeSection[];
  pages: SiteTemplatePage[];
  forms: FormDef[];
}
