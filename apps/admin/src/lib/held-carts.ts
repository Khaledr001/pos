/**
 * Parked ("held") carts for the admin sales terminal.
 *
 * Pure on purpose: no React, no `window`, no network. The page owns the I/O and
 * hands this module strings and plain objects, which is what makes every rule
 * below testable without a browser.
 *
 * Nothing here is authoritative. A parked cart is a note-to-self about what was
 * on the counter; prices, stock and the customer are all re-read when it is
 * resumed, and the server still recomputes the sale.
 */

export const HELD_CARTS_VERSION = 1;

/** Beyond this the list stops being a shortlist and becomes a place carts get lost. */
export const MAX_HELD_CARTS = 20;

export interface HeldVariant {
  id: string;
  productId: string;
  sku: string;
  barcode: string | null;
  productName: string;
  variantName: string | null;
  unitAbbr: string;
  categoryName: string | null;
  taxRate: string | null;
  stock: string;
  sellingPrice: string;
  minSellingPrice: string | null;
}

export interface HeldUnit {
  id: string;
  unitId: string;
  unitName: string;
  unitAbbr: string;
  conversionFactor: string;
  priceOverride: string | null;
  isSellable: boolean;
}

export interface HeldCustomer {
  id: string;
  name: string;
  company: string | null;
  phone: string | null;
  creditLimit: string;
  creditBalance: string;
  creditOnHold: boolean;
}

export interface HeldLine {
  variant: HeldVariant;
  quantity: string;
  unit: HeldUnit | null;
  unitPrice: string;
  discountPercent: string;
}

export interface HeldCart {
  id: string;
  /** ISO timestamp. */
  heldAt: string;
  /**
   * The cart's own idempotency key. It travels with the cart so that resuming
   * retries the SAME sale, and a cart started afterwards mints a fresh one —
   * two different sales can never share a key.
   */
  clientId: string;
  branchId: string;
  customer: HeldCustomer | null;
  lines: HeldLine[];
  documentDiscount: string;
  notes: string;
  /** Display-only, from the page's `calculateDocument` at the moment of parking. */
  total: string;
}

export interface HeldCartsPayload {
  v: typeof HELD_CARTS_VERSION;
  carts: HeldCart[];
}

/**
 * Scoped by tenant, user AND branch. Another cashier on the same browser must
 * not see (or resume) a colleague's parked sale, and a cart parked at one
 * branch holds that branch's stock figures and price list.
 */
export function heldCartsKey(tenantId: string, userId: string, branchId: string): string {
  return `devsfleet_sell_held:v${HELD_CARTS_VERSION}:${tenantId}:${userId}:${branchId}`;
}

// ── Validation ───────────────────────────────────────────────────────────────

type Rec = Record<string, unknown>;

function isRec(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const str = (v: unknown): v is string => typeof v === "string";
const strOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";

/** Decimal text the money helpers can parse: "", "3.", ".5", "12.50". */
const DECIMAL = /^\d*\.?\d*$/;
const dec = (v: unknown): v is string => str(v) && DECIMAL.test(v);

function validVariant(v: unknown): v is HeldVariant {
  return (
    isRec(v) &&
    str(v.id) &&
    str(v.productId) &&
    str(v.sku) &&
    strOrNull(v.barcode) &&
    str(v.productName) &&
    strOrNull(v.variantName) &&
    str(v.unitAbbr) &&
    strOrNull(v.categoryName) &&
    strOrNull(v.taxRate) &&
    dec(v.stock) &&
    dec(v.sellingPrice) &&
    (v.minSellingPrice === null || dec(v.minSellingPrice))
  );
}

function validUnit(v: unknown): v is HeldUnit {
  return (
    isRec(v) &&
    str(v.id) &&
    str(v.unitId) &&
    str(v.unitName) &&
    str(v.unitAbbr) &&
    dec(v.conversionFactor) &&
    (v.priceOverride === null || dec(v.priceOverride)) &&
    typeof v.isSellable === "boolean"
  );
}

function validCustomer(v: unknown): v is HeldCustomer {
  return (
    isRec(v) &&
    str(v.id) &&
    str(v.name) &&
    strOrNull(v.company) &&
    strOrNull(v.phone) &&
    dec(v.creditLimit) &&
    dec(v.creditBalance) &&
    typeof v.creditOnHold === "boolean"
  );
}

function validLine(v: unknown): v is HeldLine {
  return (
    isRec(v) &&
    validVariant(v.variant) &&
    dec(v.quantity) &&
    (v.unit === null || validUnit(v.unit)) &&
    dec(v.unitPrice) &&
    dec(v.discountPercent)
  );
}

function validCart(v: unknown): v is HeldCart {
  return (
    isRec(v) &&
    str(v.id) &&
    str(v.heldAt) &&
    !Number.isNaN(Date.parse(v.heldAt)) &&
    str(v.clientId) &&
    v.clientId.length > 0 &&
    str(v.branchId) &&
    (v.customer === null || validCustomer(v.customer)) &&
    Array.isArray(v.lines) &&
    v.lines.length > 0 &&
    v.lines.every(validLine) &&
    dec(v.documentDiscount) &&
    str(v.notes) &&
    dec(v.total)
  );
}

// ── Serialise / deserialise ──────────────────────────────────────────────────

export function serializeHeldCarts(carts: HeldCart[]): string {
  const payload: HeldCartsPayload = { v: HELD_CARTS_VERSION, carts };
  return JSON.stringify(payload);
}

/**
 * Never throws. Missing, unparseable, wrong-version or malformed data reads as
 * "nothing parked" — a bad blob must not take the sales terminal down — and a
 * single bad cart is dropped without costing the good ones beside it.
 * Duplicate ids are collapsed (first wins) and the list is capped.
 */
export function parseHeldCarts(raw: string | null | undefined): HeldCart[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!isRec(data) || data.v !== HELD_CARTS_VERSION || !Array.isArray(data.carts)) return [];

  const seen = new Set<string>();
  const out: HeldCart[] = [];
  for (const candidate of data.carts) {
    if (!validCart(candidate) || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    out.push(candidate);
    if (out.length >= MAX_HELD_CARTS) break;
  }
  return out;
}

// ── List operations (immutable) ──────────────────────────────────────────────

export type HoldResult =
  | { ok: true; carts: HeldCart[] }
  | { ok: false; reason: "full" | "empty" };

/** Newest first, so the cart just parked is the one at the top when the list opens. */
export function addHeldCart(
  carts: HeldCart[],
  cart: HeldCart,
  max: number = MAX_HELD_CARTS,
): HoldResult {
  if (cart.lines.length === 0) return { ok: false, reason: "empty" };
  if (carts.length >= max) return { ok: false, reason: "full" };
  return { ok: true, carts: [cart, ...carts] };
}

export function removeHeldCart(carts: HeldCart[], id: string): HeldCart[] {
  return carts.filter((c) => c.id !== id);
}

// ── Re-pricing on resume ─────────────────────────────────────────────────────

export interface ReconcileResult {
  lines: HeldLine[];
  /** Human sentences for everything that changed or was dropped. */
  notices: string[];
}

/**
 * Bring a parked cart's lines up to date with what the catalogue says NOW.
 *
 * `fresh` maps variant id to the current search row (absent: the product is
 * gone, inactive, unpriced or out of scope at this branch). `unitsByVariant`
 * maps variant id to its currently sellable packagings; a variant missing from
 * it had its units unreadable, in which case the parked packaging is kept
 * rather than guessed at.
 *
 * - Variant absent, or no stock left: the line is dropped and reported.
 * - A line sold at list price follows the new list price; a line the operator
 *   deliberately moved off list keeps its figure (that was a decision, not a
 *   stale number) and the notice says list has changed.
 * - Quantity is clamped to what the branch can now supply.
 * - A packaging that is no longer sellable falls back to the base unit.
 */
export function reconcileHeldLines(
  lines: HeldLine[],
  fresh: ReadonlyMap<string, HeldVariant>,
  unitsByVariant: ReadonlyMap<string, HeldUnit[]>,
  listPriceFor: (variant: HeldVariant, unit: HeldUnit | null) => string,
  sameMoney: (a: string, b: string) => boolean,
): ReconcileResult {
  const notices: string[] = [];
  const out: HeldLine[] = [];

  for (const line of lines) {
    const name = line.variant.productName;
    const variant = fresh.get(line.variant.id);

    if (!variant) {
      notices.push(`${name} is no longer available at this branch and was removed.`);
      continue;
    }
    if (!(Number(variant.stock) > 0)) {
      notices.push(`${name} is out of stock and was removed.`);
      continue;
    }

    let unit = line.unit;
    const units = unitsByVariant.get(variant.id);
    if (unit && units) {
      const current = units.find((u) => u.unitId === unit!.unitId && u.isSellable);
      if (current) {
        unit = current;
      } else {
        notices.push(`${name} is no longer sold by the ${unit.unitAbbr}; switched to ${variant.unitAbbr}.`);
        unit = null;
      }
    }

    const wasOnList = !line.unit
      ? sameMoney(line.unitPrice, listPriceFor(line.variant, null))
      : sameMoney(line.unitPrice, listPriceFor(line.variant, line.unit));
    const unitChanged = (line.unit?.unitId ?? null) !== (unit?.unitId ?? null);

    const newList = listPriceFor(variant, unit);
    let unitPrice = line.unitPrice;
    if (wasOnList || unitChanged) {
      if (!sameMoney(line.unitPrice, newList)) {
        notices.push(`${name} price updated to the current list price.`);
      }
      unitPrice = newList;
    } else if (!sameMoney(listPriceFor(line.variant, line.unit), newList)) {
      notices.push(`${name} list price has changed; your custom price was kept.`);
    }

    const factor = unit ? Number(unit.conversionFactor) : 1;
    const ceiling = Number(variant.stock) / (Number.isFinite(factor) && factor > 0 ? factor : 1);
    let quantity = line.quantity;
    if (Number(quantity) > ceiling) {
      quantity = String(Number(ceiling.toFixed(4)));
      notices.push(`${name} quantity reduced to ${quantity} — all that is in stock.`);
    }

    out.push({ ...line, variant, unit, unitPrice, quantity });
  }

  return { lines: out, notices };
}

/** "just now", "5 min ago", "2 hours ago", "3 days ago". */
export function heldAgo(iso: string, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}
