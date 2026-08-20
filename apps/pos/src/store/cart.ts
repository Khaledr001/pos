import { DEFAULT_TENANT_SETTINGS } from "@devsfleet/shared-types";
import { Money, calculateDocument, type DocumentTotals } from "@devsfleet/shared-utils";
import { useMemo } from "react";
import { create } from "zustand";
import type { PosCustomer, PosProduct, PosVariantUnit } from "../lib/pos-data.js";

/**
 * The cart.
 *
 * Totals are NOT stored. They are derived on every read by `calculateDocument`
 * — the same function the API and the admin panel call. Caching a total here
 * would create a second implementation of the tax maths, and the two would
 * eventually disagree; the whole point of the shared engine is that the receipt
 * in the customer's hand and the invoice in the database are computed by one
 * piece of code.
 */

export interface CartLine {
  /** Line identity, stable across quantity edits. Not the product id — the same
   *  product can appear twice at different prices. */
  key: string;
  product: PosProduct;
  quantity: string;
  /** Editable: a manager may override, down to the floor price. */
  unitPrice: string;
  discountPercent: string;
  /** Set when a supervisor authorised going below `minSellingPrice`. */
  floorOverridden: boolean;
  /** Drives the entry animation, so a scan is visibly confirmed. */
  addedAt: number;
  /**
   * The packaging this line is sold in — a box, a carton. `null` means the
   * base unit. Snapshotted onto the line (not re-resolved) for the same
   * reason `product` is: a cart parked and restored later must still ring up
   * in the unit it was quoted in.
   */
  unit: PosVariantUnit | null;
}

/** What a held cart stores. Versioned, so an older build can decline politely. */
export interface CartSnapshot {
  version: 1;
  lines: CartLine[];
  customer: PosCustomer | null;
  documentDiscountPercent: string;
  note: string;
  /**
   * Optional, so a cart parked by an older build still restores.
   *
   * Parked with the cart because the approval belongs to the transaction, and
   * a cart brought back an hour later is the same transaction — without them a
   * restored below-floor line would sail through the till and be refused by
   * the server, long after the customer left. The grants expire on their own,
   * which is what bounds this.
   */
  overrideGrants?: string[];
}

interface CartState {
  lines: CartLine[];
  customer: PosCustomer | null;
  /** Applied across the document and pushed down onto lines before tax. */
  documentDiscountPercent: string;
  note: string;

  /**
   * Signed supervisor approvals collected while ringing this cart up.
   *
   * Kept on the CART rather than the line because that is the lifetime that
   * matches: an approval belongs to the transaction in front of the manager,
   * and clearing the cart must throw it away. Leaving one lying around between
   * customers would turn a single approval into a standing permission.
   *
   * Opaque strings. The terminal attaches them to the sale and never reads
   * them — the server is what decides what they authorise.
   */
  overrideGrants: string[];

  addProduct: (product: PosProduct, quantity?: string) => void;
  setQuantity: (key: string, quantity: string) => void;
  adjustQuantity: (key: string, delta: number) => void;
  setUnitPrice: (key: string, unitPrice: string, overrideFloor?: boolean) => void;
  /**
   * Switch which packaging a line is sold in, recomputing its listed price —
   * the packaging's own flat price if the merchant set one, otherwise the
   * base price scaled by the conversion factor. Matches create()'s own
   * resolution exactly, so what the cashier sees is what the server will
   * charge. Clears any floor override: it was an approval for a different
   * number, and the new price needs its own fresh check.
   */
  setLineUnit: (key: string, unit: PosVariantUnit | null) => void;
  /** Record an approval a supervisor gave for this cart. */
  addOverrideGrant: (grant: string) => void;
  setLineDiscount: (key: string, percent: string) => void;
  removeLine: (key: string) => void;
  setCustomer: (customer: PosCustomer | null) => void;
  setDocumentDiscount: (percent: string) => void;
  setNote: (note: string) => void;
  clear: () => void;

  /**
   * Park the cart, or bring one back.
   *
   * The snapshot carries the full `PosProduct` on each line, not just an id.
   * A cart restored an hour later must ring up at the price it was quoted at —
   * looking the product up again would silently re-price it, and the customer
   * standing there was told a number.
   */
  snapshot: () => CartSnapshot;
  restore: (snapshot: CartSnapshot) => void;

  /**
   * Non-reactive readers.
   *
   * Call these from event handlers via `useCart.getState()`. Do NOT pass them
   * to a `useCart(...)` selector — they build a fresh object on every call, so
   * `useSyncExternalStore` would see a new snapshot each render and loop
   * forever (React error #185). Components use the `useCartTotals` /
   * `useFloorViolations` hooks below instead.
   */
  totals: () => DocumentTotals;
  lineCount: () => number;
  unitCount: () => string;
  /** Lines priced below their floor without authorisation. Blocks checkout. */
  floorViolations: () => CartLine[];
}

const TAX_MODE = DEFAULT_TENANT_SETTINGS.tax.mode;
const DECIMALS = DEFAULT_TENANT_SETTINGS.currency.decimals;

/**
 * A line's floor, scaled to whatever it is sold in — a box cannot go below
 * cost any more than a single piece can, so the base floor scales by the
 * same conversion factor the listed price does. Mirrors create()'s own
 * scaling exactly.
 */
export function scaledFloor(line: CartLine): Money.Minor4 | null {
  const floor = line.product.minSellingPrice;
  if (!floor) return null;
  return Money.multiplyByQuantity(Money.toMinor(floor), line.unit?.conversionFactor ?? "1");
}

/**
 * A line's LIST price, in whatever it is sold in — the packaging's own flat
 * price if the merchant set one, otherwise the base price scaled by the
 * conversion factor. What "undercutting" is measured against; without this a
 * cashier typing a price below the PACKAGING's real list, but above the raw
 * base price, would read as an undercut against the wrong number.
 */
export function scaledListPrice(line: CartLine): Money.Minor4 {
  if (line.unit?.priceOverride) return Money.toMinor(line.unit.priceOverride);
  return Money.multiplyByQuantity(
    Money.toMinor(line.product.sellingPrice),
    line.unit?.conversionFactor ?? "1",
  );
}

/**
 * The base (untiered) price for a given quantity — the highest-threshold
 * tier the quantity actually reaches, or the product's ordinary
 * `sellingPrice` when it carries no tiers at all (or none of them apply).
 * Mirrors PriceResolverService.resolveMany's own tier-picking exactly, so a
 * quantity discount rings up offline the same way it would online.
 */
/**
 * "10.00" and "10.0000" are the same amount but different strings —
 * comparing them with `===` would wrongly read an untouched, on-ladder line
 * as manually overridden the moment its price round-trips through Money's
 * 4-decimal formatting (e.g. after a packaging change).
 */
function sameAmount(a: string, b: string): boolean {
  return Money.toMinor(a) === Money.toMinor(b);
}

export function pickTierPrice(product: PosProduct, quantity: string): string {
  const tiers = product.priceTiers;
  if (!tiers || tiers.length === 0) return product.sellingPrice;

  const qty = Number(quantity);
  const applicable = tiers.filter((tier) => Number(tier.minQuantity) <= qty);
  if (applicable.length === 0) return product.sellingPrice;

  return applicable.reduce((best, tier) =>
    Number(tier.minQuantity) > Number(best.minQuantity) ? tier : best,
  ).sellingPrice;
}

/**
 * The tiered price for a line, scaled into whatever it is sold in — same
 * scaling `setLineUnit` always did, just against the tier the CURRENT
 * quantity reaches rather than always the base (quantity-1) tier. A
 * packaging with its own flat price is never tiered: a box has one price,
 * not a ladder. No packaging chosen returns the tier's own string exactly
 * as-is — matching `sellingPrice`'s own precision — rather than round-
 * tripping it through Money for a x1 scale that changes nothing but the
 * number of decimal places.
 */
export function scaledTierPrice(line: CartLine, quantity: string): string {
  if (line.unit?.priceOverride) return line.unit.priceOverride;
  const base = pickTierPrice(line.product, quantity);
  if (!line.unit) return base;
  return Money.toDecimalString(
    Money.multiplyByQuantity(Money.toMinor(base), line.unit.conversionFactor),
    4,
  );
}

export const useCart = create<CartState>((set, get) => ({
  lines: [],
  customer: null,
  documentDiscountPercent: "0",
  note: "",
  overrideGrants: [],

  /**
   * Scanning the same item twice increments the existing line rather than
   * adding a second one — that is what a cashier expects when they pass three
   * identical boxes over the scanner.
   *
   * A line whose price was manually edited is left alone, so a negotiated price
   * is not silently merged into a standard one.
   */
  addProduct(product, quantity = "1") {
    // Still on-ladder for its OWN quantity, not necessarily the incoming
    // one — merging first, then adjustQuantity below re-prices for the sum.
    const existing = get().lines.find(
      (line) =>
        line.product.id === product.id &&
        sameAmount(line.unitPrice, pickTierPrice(product, line.quantity)) &&
        line.discountPercent === "0",
    );

    if (existing) {
      get().adjustQuantity(existing.key, Number(quantity));
      return;
    }

    set((state) => ({
      lines: [
        ...state.lines,
        {
          key: crypto.randomUUID(),
          product,
          quantity,
          unitPrice: pickTierPrice(product, quantity),
          discountPercent: "0",
          floorOverridden: false,
          addedAt: Date.now(),
          unit: null,
        },
      ],
    }));
  },

  setQuantity(key, quantity) {
    const parsed = Number(quantity);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      get().removeLine(key);
      return;
    }
    set((state) => ({
      lines: state.lines.map((line) => {
        if (line.key !== key) return line;
        // Only follow the ladder if the price is still exactly what the OLD
        // quantity's tier set it to — a manually typed price stays put.
        const onLadder = sameAmount(line.unitPrice, scaledTierPrice(line, line.quantity));
        const unitPrice = onLadder ? scaledTierPrice(line, quantity) : line.unitPrice;
        return { ...line, quantity, unitPrice };
      }),
    }));
  },

  adjustQuantity(key, delta) {
    const line = get().lines.find((l) => l.key === key);
    if (!line) return;
    const next = Number(line.quantity) + delta;
    get().setQuantity(key, String(Number(next.toFixed(4))));
  },

  setUnitPrice(key, unitPrice, overrideFloor = false) {
    set((state) => ({
      lines: state.lines.map((line) =>
        line.key === key
          ? { ...line, unitPrice, floorOverridden: overrideFloor }
          : line,
      ),
    }));
  },

  setLineUnit(key, unit) {
    set((state) => ({
      lines: state.lines.map((line) => {
        if (line.key !== key) return line;
        const listedPrice = scaledTierPrice({ ...line, unit }, line.quantity);
        return { ...line, unit, unitPrice: listedPrice, floorOverridden: false };
      }),
    }));
  },

  addOverrideGrant(grant) {
    if (!grant) return;
    set((state) =>
      state.overrideGrants.includes(grant)
        ? state
        : { overrideGrants: [...state.overrideGrants, grant] },
    );
  },

  setLineDiscount(key, percent) {
    set((state) => ({
      lines: state.lines.map((line) =>
        line.key === key ? { ...line, discountPercent: percent } : line,
      ),
    }));
  },

  removeLine(key) {
    set((state) => ({ lines: state.lines.filter((line) => line.key !== key) }));
  },

  setCustomer(customer) {
    set({ customer });
  },

  setDocumentDiscount(percent) {
    set({ documentDiscountPercent: percent });
  },

  setNote(note) {
    set({ note });
  },

  clear() {
    // Grants go with the cart. An approval outliving the customer it was given
    // for is an approval nobody authorised.
    set({
      lines: [],
      customer: null,
      documentDiscountPercent: "0",
      note: "",
      overrideGrants: [],
    });
  },

  snapshot() {
    const { lines, customer, documentDiscountPercent, note, overrideGrants } = get();
    return { version: 1, lines, customer, documentDiscountPercent, note, overrideGrants };
  },

  restore(snapshot) {
    set({
      // Fresh keys and timestamps: the old ones would collide with whatever is
      // on the till now, and a restored line should animate in like any other.
      lines: snapshot.lines.map((line) => ({
        ...line,
        key: crypto.randomUUID(),
        addedAt: Date.now(),
        // A cart parked by a build before packagings existed carries no
        // `unit` at all — the base unit, same as it always was.
        unit: line.unit ?? null,
      })),
      customer: snapshot.customer ?? null,
      documentDiscountPercent: snapshot.documentDiscountPercent ?? "0",
      note: snapshot.note ?? "",
      // Replaced, never merged: the cart being restored is a different
      // transaction to whatever was on screen a moment ago.
      overrideGrants: snapshot.overrideGrants ?? [],
    });
  },

  totals() {
    const { lines, documentDiscountPercent } = get();
    return calculateDocument({
      taxMode: TAX_MODE,
      decimals: DECIMALS,
      documentDiscountPercent,
      lines: lines.map((line) => ({
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountPercent: line.discountPercent,
        taxPercent: line.product.taxPercent,
      })),
    });
  },

  lineCount() {
    return get().lines.length;
  },

  unitCount() {
    const total = get().lines.reduce((sum, line) => sum + Number(line.quantity), 0);
    return String(Number(total.toFixed(4)));
  },

  /**
   * The floor check runs on the price AFTER the line discount, because a 20%
   * discount on a full-price line lands in the same place as typing the
   * discounted figure directly — and only one of those routes being checked is
   * exactly the gap a cashier finds.
   */
  floorViolations() {
    return get().lines.filter((line) => {
      if (line.floorOverridden) return false;
      const floor = scaledFloor(line);
      if (floor === null) return false;

      const unit = Money.toMinor(line.unitPrice);
      const discount = Money.percentOf(unit, line.discountPercent || "0");
      const effective = unit - discount;

      return effective < floor;
    });
  },
}));

// -----------------------------------------------------------------------------
// Reactive selectors
// -----------------------------------------------------------------------------

/**
 * Cart totals, recomputed only when the cart actually changes.
 *
 * The naive form — `useCart((s) => s.totals())` — is an infinite render loop.
 * zustand compares snapshots with `Object.is`, `calculateDocument` returns a
 * fresh object every call, so every render produces a "changed" snapshot and
 * schedules another render. React eventually throws error #185.
 *
 * Subscribing to `lines` and `documentDiscountPercent` instead is safe: those
 * are stable references that only change when the cart is genuinely mutated,
 * and the expensive part is then memoised against them.
 */
export function useCartTotals(): DocumentTotals {
  const lines = useCart((state) => state.lines);
  const documentDiscountPercent = useCart((state) => state.documentDiscountPercent);

  return useMemo(
    () =>
      calculateDocument({
        taxMode: TAX_MODE,
        decimals: DECIMALS,
        documentDiscountPercent,
        lines: lines.map((line) => ({
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountPercent: line.discountPercent,
          taxPercent: line.product.taxPercent,
        })),
      }),
    [lines, documentDiscountPercent],
  );
}

/** Same reasoning as useCartTotals: `filter` returns a new array every call. */
export function useFloorViolations(): CartLine[] {
  const lines = useCart((state) => state.lines);

  return useMemo(
    () =>
      lines.filter((line) => {
        if (line.floorOverridden) return false;
        const floor = scaledFloor(line);
        if (floor === null) return false;

        const unit = Money.toMinor(line.unitPrice);
        const discount = Money.percentOf(unit, line.discountPercent || "0");
        return unit - discount < floor;
      }),
    [lines],
  );
}
