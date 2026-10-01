/**
 * The online store: a sales channel on the platform, not a second system.
 *
 * Products, prices, stock, customers and orders are the POS's own rows. What
 * lives here is only what a shop window needs on top of them — the domain it
 * answers on, delivery rules, which products are listed, and the shopper's
 * side of an order (contact, address, payment, delivery status).
 */

// `const T` keeps the literals, so a status is "placed" | "shipped" | …, not string.
const asConst = <const T extends readonly string[]>(values: T) => values;

export const EMIRATES = asConst([
  "ABU_DHABI",
  "DUBAI",
  "SHARJAH",
  "AJMAN",
  "UMM_AL_QUWAIN",
  "RAS_AL_KHAIMAH",
  "FUJAIRAH",
]);
export type Emirate = (typeof EMIRATES)[number];

export const PRODUCT_LINK_KINDS = asConst(["related", "alternative", "bought_together"]);
export type ProductLinkKind = (typeof PRODUCT_LINK_KINDS)[number];

export const STOREFRONT_PAGE_KINDS = asConst(["page", "blog"]);
export type StorefrontPageKind = (typeof STOREFRONT_PAGE_KINDS)[number];

export const BANNER_PLACEMENTS = asConst(["home_hero", "home_strip"]);
export type BannerPlacement = (typeof BANNER_PLACEMENTS)[number];

export const CART_STATUSES = asConst(["active", "converted", "abandoned"]);
export type CartStatus = (typeof CART_STATUSES)[number];

export const COUPON_TYPES = asConst(["percent", "fixed", "free_shipping"]);
export type CouponType = (typeof COUPON_TYPES)[number];

export const TRADE_STATUSES = asConst(["none", "pending", "approved", "rejected"]);
export type TradeStatus = (typeof TRADE_STATUSES)[number];

export const DELIVERY_METHODS = asConst(["courier", "pickup"]);
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];

export const WEB_PAYMENT_METHODS = asConst(["card", "apple_pay", "google_pay", "cod"]);
export type WebPaymentMethod = (typeof WEB_PAYMENT_METHODS)[number];

export const WEB_PAYMENT_STATUSES = asConst([
  "pending",
  "authorized",
  "paid",
  "failed",
  "refunded",
  "partially_refunded",
]);
export type WebPaymentStatus = (typeof WEB_PAYMENT_STATUSES)[number];

/**
 * What the shopper sees on the tracking page.
 *
 * Finer-grained than `orders.status`, which only knows whether stock is held
 * and whether the goods have left. The mapping is one-way and lives in
 * apps/api/src/modules/storefront/orders: `confirmed`/`packed` are both a
 * `processing` POS order, `ready_for_pickup` is `ready`, and the two terminal
 * hand-overs are the moment the POS order is fulfilled into a sale.
 */
export const WEB_ORDER_STATUSES = asConst([
  "pending_payment",
  "placed",
  "confirmed",
  "packed",
  "shipped",
  "ready_for_pickup",
  "delivered",
  "collected",
  "cancelled",
  "refunded",
]);
export type WebOrderStatus = (typeof WEB_ORDER_STATUSES)[number];

/** Courier pricing for one emirate. Amounts are decimal strings, VAT-exclusive. */
export interface ShippingRate {
  emirate: Emirate;
  /** Fee for an order up to `baseWeightKg`. */
  baseFee: string;
  baseWeightKg: number;
  /** Added per kg (or part of one) above `baseWeightKg`. */
  perKgFee: string;
  /** Delivery is free once the net subtotal reaches this. null = never free. */
  freeOver: string | null;
  /** The courier refuses parcels above this. */
  maxWeightKg: number;
  etaDays: number;
  active: boolean;
}

/** How one branch appears on the website. Branches not listed are not shown. */
export interface StorefrontBranch {
  branchId: string;
  emirate: Emirate;
  lat: number | null;
  lng: number | null;
  /** { mon: "08:00-20:00", ... } — free-form, shown as written. */
  openingHours: Record<string, string> | null;
  pickupEnabled: boolean;
}

/**
 * Shape of `storefronts.settings` (JSONB). Read through
 * `resolveStorefrontSettings()` so an older row still yields every field.
 */
export interface StorefrontSettings {
  /** Shown in the header and on emails. Falls back to the tenant's name. */
  displayName?: string;
  /** The line under the name in the header, e.g. "Building Materials". */
  tagline?: string;
  /**
   * The shop's public origin, e.g. "https://shop.al-lahiq.ae". Where a payment
   * gateway sends the shopper back to. Defaults to https:// plus the host the
   * request arrived on; set it when that is wrong (local development, a port).
   */
  siteUrl?: string;
  whatsapp?: string;

  /**
   * Where the storefront's `/api/revalidate` lives, so a price or stock change
   * refreshes cached pages within seconds instead of waiting out the TTL.
   * The secret is NOT stored here — see STOREFRONT_REVALIDATE_SECRET.
   */
  revalidateUrl?: string;

  checkout: {
    cod: { enabled: boolean; /** VAT-inclusive cap. */ maxTotal: string };
    card: { enabled: boolean };
    /** Units held back from what the POS shows, so a counter sale cannot oversell online. */
    stockSafetyBuffer: number;
    /** The branch whose stock a courier order ships from. */
    fulfilmentBranchId: string | null;
    /**
     * A non-stock-tracked variant used as the delivery line on an order, so
     * the fee is taxed and invoiced by the same `calculateDocument` call as
     * the goods. Without one, courier delivery is unavailable.
     */
    deliveryVariantId: string | null;
  };

  shipping: { rates: ShippingRate[] };

  pickup: {
    /** Slot length in minutes. */
    slotMinutes: number;
    /** Earliest slot is at least this far from now. */
    leadTimeHours: number;
    /** How many days of slots to offer. */
    daysAhead: number;
    /** Daily window in the tenant's timezone, "HH:MM". */
    opensAt: string;
    closesAt: string;
  };

  branches: StorefrontBranch[];

  search: {
    /** Each group is a set of interchangeable words: ["tap", "faucet", "mixer"]. */
    synonyms: string[][];
  };
}

export const DEFAULT_SHIPPING_RATES: ShippingRate[] = [
  { emirate: "DUBAI", baseFee: "20.00", baseWeightKg: 5, perKgFee: "2.00", freeOver: "300.00", maxWeightKg: 30, etaDays: 1, active: true },
  { emirate: "SHARJAH", baseFee: "20.00", baseWeightKg: 5, perKgFee: "2.00", freeOver: "300.00", maxWeightKg: 30, etaDays: 1, active: true },
  { emirate: "AJMAN", baseFee: "25.00", baseWeightKg: 5, perKgFee: "2.00", freeOver: "350.00", maxWeightKg: 30, etaDays: 2, active: true },
  { emirate: "ABU_DHABI", baseFee: "30.00", baseWeightKg: 5, perKgFee: "2.50", freeOver: "400.00", maxWeightKg: 30, etaDays: 2, active: true },
  { emirate: "UMM_AL_QUWAIN", baseFee: "30.00", baseWeightKg: 5, perKgFee: "2.50", freeOver: "400.00", maxWeightKg: 30, etaDays: 2, active: true },
  { emirate: "RAS_AL_KHAIMAH", baseFee: "35.00", baseWeightKg: 5, perKgFee: "3.00", freeOver: "450.00", maxWeightKg: 30, etaDays: 3, active: true },
  { emirate: "FUJAIRAH", baseFee: "35.00", baseWeightKg: 5, perKgFee: "3.00", freeOver: "450.00", maxWeightKg: 30, etaDays: 3, active: true },
];

export const DEFAULT_STOREFRONT_SETTINGS: StorefrontSettings = {
  checkout: {
    cod: { enabled: true, maxTotal: "2000.00" },
    card: { enabled: false },
    stockSafetyBuffer: 0,
    fulfilmentBranchId: null,
    deliveryVariantId: null,
  },
  shipping: { rates: DEFAULT_SHIPPING_RATES },
  pickup: { slotMinutes: 120, leadTimeHours: 2, daysAhead: 5, opensAt: "08:00", closesAt: "20:00" },
  branches: [],
  search: { synonyms: [] },
};

/** Merge stored partial settings over the defaults. One level per section. */
export function resolveStorefrontSettings(stored: unknown): StorefrontSettings {
  const s = (stored ?? {}) as Partial<StorefrontSettings>;
  const d = DEFAULT_STOREFRONT_SETTINGS;
  return {
    ...d,
    ...s,
    checkout: {
      ...d.checkout,
      ...s.checkout,
      cod: { ...d.checkout.cod, ...s.checkout?.cod },
      card: { ...d.checkout.card, ...s.checkout?.card },
    },
    shipping: { ...d.shipping, ...s.shipping },
    pickup: { ...d.pickup, ...s.pickup },
    branches: s.branches ?? d.branches,
    search: { ...d.search, ...s.search },
  };
}
