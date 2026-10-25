import type { StorefrontRegion } from "@devsfleet/shared-types";
import type { DeliveryMethod, OrderStatus, PaymentMethod, PaymentStatus, StockLabel } from "@devsfleet/storefront-client";

const UOM: Record<string, { short: string; one: string; many: string }> = {
  pc: { short: "pc", one: "piece", many: "pieces" },
  m: { short: "m", one: "metre", many: "metres" },
  roll: { short: "roll", one: "roll", many: "rolls" },
  box: { short: "box", one: "box", many: "boxes" },
  bag: { short: "bag", one: "bag", many: "bags" },
  sqm: { short: "m²", one: "m²", many: "m²" },
  can: { short: "can", one: "can", many: "cans" },
  pail: { short: "pail", one: "pail", many: "pails" },
  sheet: { short: "sheet", one: "sheet", many: "sheets" },
  l: { short: "L", one: "litre", many: "litres" },
  kg: { short: "kg", one: "kg", many: "kg" },
};

/** "/ m²" style unit suffix for prices. */
export function uomShort(uom: string) {
  return UOM[uom]?.short ?? uom;
}

export function uomCount(qty: number, uom: string) {
  const u = UOM[uom];
  if (!u) return `${formatQty(qty)} ${uom}`;
  return `${formatQty(qty)} ${qty === 1 ? u.one : u.many}`;
}

/** Units sold by length/area can be fractional; the rest are whole. */
export function isFractionalUom(uom: string) {
  return uom === "m" || uom === "sqm" || uom === "l" || uom === "kg";
}

export function formatQty(qty: number) {
  return Number.isInteger(qty) ? String(qty) : qty.toFixed(qty < 10 ? 2 : 1).replace(/\.?0+$/, "");
}

export const ORDER_STATUS: Record<OrderStatus, string> = {
  PENDING_PAYMENT: "Awaiting payment",
  PLACED: "Order placed",
  CONFIRMED: "Confirmed",
  PACKED: "Packed",
  SHIPPED: "On its way",
  READY_FOR_PICKUP: "Ready for pickup",
  DELIVERED: "Delivered",
  COLLECTED: "Collected",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

export const PAYMENT_STATUS: Record<PaymentStatus, string> = {
  PENDING: "Not paid yet",
  AUTHORIZED: "Authorised",
  PAID: "Paid",
  FAILED: "Payment failed",
  REFUNDED: "Refunded",
  PARTIALLY_REFUNDED: "Partly refunded",
};

export const PAYMENT_METHOD: Record<PaymentMethod, string> = {
  CARD: "Card",
  APPLE_PAY: "Apple Pay",
  GOOGLE_PAY: "Google Pay",
  COD: "Cash on delivery",
  TABBY: "Tabby",
  TAMARA: "Tamara",
};

export const DELIVERY_METHOD: Record<DeliveryMethod, string> = {
  COURIER: "Courier delivery",
  PICKUP: "Store pickup",
};

export const STOCK_LABEL: Record<StockLabel, string> = {
  IN_STOCK: "In stock",
  LOW_STOCK: "Low stock",
  OUT_OF_STOCK: "Out of stock",
};

/** What a page needs to know about the shop to print a price, a date or a zone name. */
export interface StoreFormat {
  /** ISO 4217, e.g. "AED". */
  currency: string;
  /** BCP-47 tag for numbers and dates, e.g. "en-AE". */
  locale: string;
  /** IANA zone the shop runs in; order times are shown in it, not the visitor's or the server's. */
  timezone: string;
  region: StorefrontRegion;
}

export type StoreFormatter = ReturnType<typeof makeFormat>;

/** The same formatters, built from a `StoreInfo` a page already has in hand. */
export function makeFormatFor(store: { currency: string; timezone: string; region: StorefrontRegion }) {
  return makeFormat({ currency: store.currency, locale: store.region.formatLocale, timezone: store.timezone, region: store.region });
}

/**
 * Formatters bound to one shop. One deployment serves every tenant, so none of
 * this can live in module state: a server render builds it per request from the
 * store's own settings, and client components read the same thing from context.
 */
export function makeFormat({ currency, locale, timezone, region }: StoreFormat) {
  const number = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const whole = new Intl.NumberFormat(locale);
  const dateFmt = new Intl.DateTimeFormat(locale, { timeZone: timezone, day: "numeric", month: "short", year: "numeric" });
  const dateTimeFmt = new Intl.DateTimeFormat(locale, { timeZone: timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const timeFmt = new Intl.DateTimeFormat(locale, { timeZone: timezone, hour: "2-digit", minute: "2-digit" });
  const zoneName = (code: string | null | undefined) => region.zones.find((z) => z.code === code)?.name ?? code ?? "";

  return {
    currency,
    locale,
    timezone,
    region,
    /** "AED 1,234.50" from whole minor units (fils). */
    money: (minor: number) => `${currency} ${number.format(minor / 100)}`,
    /** The pieces of a shelf-tag price: whole part and two decimals. */
    priceParts: (minor: number) => ({ whole: whole.format(Math.trunc(minor / 100)), dec: (minor / 100).toFixed(2).split(".")[1]! }),
    date: (iso: string | null | undefined) => (iso ? dateFmt.format(new Date(iso)) : ""),
    dateTime: (iso: string | null | undefined) => (iso ? dateTimeFmt.format(new Date(iso)) : ""),
    time: (iso: string | null | undefined) => (iso ? timeFmt.format(new Date(iso)) : ""),
    zoneName,
    /** Placeholder for a phone field: the shop's own calling code, never another country's. */
    phonePlaceholder: `+${region.callingCode} …`,
    /** "Villa 12, Street 5, Al Barsha 2, Dubai" from a saved or order address. */
    addressLine: (a: { building?: string | null; street?: string | null; area?: string | null; emirate?: string | null }) =>
      [a.building, a.street, a.area, zoneName(a.emirate)].filter(Boolean).join(", "),
  };
}

export function whatsappLink(number: string, text?: string) {
  const digits = number.replace(/\D/g, "");
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

/** Only follow a `?next=` value when it is a path on this site (not "//evil.com"). */
export function safeNext(next: unknown, fallback = "/account") {
  return typeof next === "string" && /^\/(?![/\\])/.test(next) ? next : fallback;
}

/** Weekday keys used in branch opening hours, Monday first. */
export const WEEKDAYS: { key: string; label: string }[] = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
];

/**
 * A catalogue name as shown to shoppers. Names imported from a price list are
 * often all lowercase ("italia brass double angle valve"); those get a capital
 * first letter. Anything with capitals of its own — "Schneider Electric",
 * "60X60 grill light", "iPhone" — is left exactly as the shop wrote it.
 */
export function displayName(name: string): string {
  if (!name || name !== name.toLowerCase()) return name;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Departments to lead with: the most stocked first, ties alphabetical. */
export function busiestFirst<T extends { name: string; productCount: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.productCount - a.productCount || a.name.localeCompare(b.name));
}

export function alphabetical<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
}
