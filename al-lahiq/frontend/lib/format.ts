import type { DeliveryMethod, Emirate, OrderStatus, PaymentMethod, PaymentStatus, StockLabel } from "@al-lahiq/api-client";

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

export const EMIRATES: { value: Emirate; label: string }[] = [
  { value: "DUBAI", label: "Dubai" },
  { value: "ABU_DHABI", label: "Abu Dhabi" },
  { value: "SHARJAH", label: "Sharjah" },
  { value: "AJMAN", label: "Ajman" },
  { value: "UMM_AL_QUWAIN", label: "Umm Al Quwain" },
  { value: "RAS_AL_KHAIMAH", label: "Ras Al Khaimah" },
  { value: "FUJAIRAH", label: "Fujairah" },
];

export function emirateName(e: Emirate | string | null | undefined) {
  return EMIRATES.find((x) => x.value === e)?.label ?? e ?? "";
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

const dateFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Dubai",
  day: "numeric",
  month: "short",
  year: "numeric",
});
const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Dubai",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDate(iso: string | null | undefined) {
  return iso ? dateFmt.format(new Date(iso)) : "";
}

export function formatDateTime(iso: string | null | undefined) {
  return iso ? dateTimeFmt.format(new Date(iso)) : "";
}

export function aed(fils: number) {
  return `AED ${(fils / 100).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Splits "AED 1,234.50" into parts for the shelf-tag price. */
export function priceParts(fils: number) {
  const [whole, dec] = (fils / 100).toFixed(2).split(".");
  return { whole: Number(whole).toLocaleString("en-AE"), dec };
}

export function whatsappLink(number: string, text?: string) {
  const digits = number.replace(/\D/g, "");
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

/** Only follow a `?next=` value when it is a path on this site (not "//evil.com"). */
export function safeNext(next: unknown, fallback = "/account") {
  return typeof next === "string" && /^\/(?![/\\])/.test(next) ? next : fallback;
}

/** "Villa 12, Street 5, Al Barsha 2, Dubai" from a saved or order address. */
export function addressLine(a: { building?: string | null; street?: string | null; area?: string | null; emirate?: string | null }) {
  return [a.building, a.street, a.area, emirateName(a.emirate)].filter(Boolean).join(", ");
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
