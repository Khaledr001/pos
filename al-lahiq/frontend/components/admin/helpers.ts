import type { OrderStatus, PaymentStatus } from "@al-lahiq/api-client";

/** Integer fils → "12.50" for an AED text input. */
export function filsToInput(fils: number | null | undefined) {
  if (fils == null) return "";
  return (fils / 100).toFixed(2);
}

/** "12.5" / "1,250" → 1250 fils. Returns null for empty or invalid input. */
export function inputToFils(value: string): number | null {
  const clean = value.replace(/[,\s]/g, "").replace(/^AED/i, "");
  if (!clean) return null;
  const n = Number(clean);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** Standard UAE VAT (5 %) on a net amount. */
export function withVat(fils: number) {
  return Math.round(fils * 1.05);
}

export function formatAed(fils: number) {
  return `AED ${(fils / 100).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** ISO → value for <input type="datetime-local"> in the browser's time zone. */
export function isoToLocalInput(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** <input type="datetime-local"> value → ISO string, or null when empty. */
export function localInputToIso(value: string) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** "Floor Tiles & Grout" → "floor-tiles-grout" */
export function slugify(text: string) {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

export type Tone = "neutral" | "pipe" | "brass" | "signal" | "ink";

export const ORDER_STATUS_TONE: Record<OrderStatus, Tone> = {
  PENDING_PAYMENT: "neutral",
  PLACED: "brass",
  CONFIRMED: "brass",
  PACKED: "brass",
  SHIPPED: "neutral",
  READY_FOR_PICKUP: "neutral",
  DELIVERED: "pipe",
  COLLECTED: "pipe",
  CANCELLED: "signal",
  REFUNDED: "neutral",
};

export const PAYMENT_STATUS_TONE: Record<PaymentStatus, Tone> = {
  PENDING: "neutral",
  AUTHORIZED: "brass",
  PAID: "pipe",
  FAILED: "signal",
  REFUNDED: "neutral",
  PARTIALLY_REFUNDED: "neutral",
};

/** Button label for moving an order to a status: says exactly what it does. */
export const STATUS_ACTION: Partial<Record<OrderStatus, string>> = {
  CONFIRMED: "Confirm order",
  PACKED: "Mark as packed",
  SHIPPED: "Mark as shipped",
  READY_FOR_PICKUP: "Mark ready for pickup",
  DELIVERED: "Mark as delivered",
  COLLECTED: "Mark as collected",
  CANCELLED: "Cancel order",
};

export function pluralize(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString("en-AE")} ${n === 1 ? one : many}`;
}

/** Compact, readable JSON for payload viewers. */
export function prettyJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Only return to admin pages after login (never to another site). */
export function safeNext(next: string | null | undefined) {
  return next && next.startsWith("/admin") && !next.startsWith("//") && !next.startsWith("/admin/login") ? next : "/admin";
}
