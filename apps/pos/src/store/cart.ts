import { DEFAULT_TENANT_SETTINGS } from "@devsfleet/shared-types";
import { Money, calculateDocument, type DocumentTotals } from "@devsfleet/shared-utils";
import { useMemo } from "react";
import { create } from "zustand";
import type { PosCustomer, PosProduct } from "../lib/pos-data.js";

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
}

/** What a held cart stores. Versioned, so an older build can decline politely. */
export interface CartSnapshot {
  version: 1;
  lines: CartLine[];
  customer: PosCustomer | null;
  documentDiscountPercent: string;
  note: string;
}

interface CartState {
  lines: CartLine[];
  customer: PosCustomer | null;
  /** Applied across the document and pushed down onto lines before tax. */
  documentDiscountPercent: string;
  note: string;

  addProduct: (product: PosProduct, quantity?: string) => void;
  setQuantity: (key: string, quantity: string) => void;
  adjustQuantity: (key: string, delta: number) => void;
  setUnitPrice: (key: string, unitPrice: string, overrideFloor?: boolean) => void;
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

export const useCart = create<CartState>((set, get) => ({
  lines: [],
  customer: null,
  documentDiscountPercent: "0",
  note: "",

  /**
   * Scanning the same item twice increments the existing line rather than
   * adding a second one — that is what a cashier expects when they pass three
   * identical boxes over the scanner.
   *
   * A line whose price was manually edited is left alone, so a negotiated price
   * is not silently merged into a standard one.
   */
  addProduct(product, quantity = "1") {
    const existing = get().lines.find(
      (line) =>
        line.product.id === product.id &&
        line.unitPrice === product.sellingPrice &&
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
          unitPrice: product.sellingPrice,
          discountPercent: "0",
          floorOverridden: false,
          addedAt: Date.now(),
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
      lines: state.lines.map((line) =>
        line.key === key ? { ...line, quantity } : line,
      ),
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
    set({ lines: [], customer: null, documentDiscountPercent: "0", note: "" });
  },

  snapshot() {
    const { lines, customer, documentDiscountPercent, note } = get();
    return { version: 1, lines, customer, documentDiscountPercent, note };
  },

  restore(snapshot) {
    set({
      // Fresh keys and timestamps: the old ones would collide with whatever is
      // on the till now, and a restored line should animate in like any other.
      lines: snapshot.lines.map((line) => ({
        ...line,
        key: crypto.randomUUID(),
        addedAt: Date.now(),
      })),
      customer: snapshot.customer ?? null,
      documentDiscountPercent: snapshot.documentDiscountPercent ?? "0",
      note: snapshot.note ?? "",
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
      const floor = line.product.minSellingPrice;
      if (!floor) return false;

      const unit = Money.toMinor(line.unitPrice);
      const discount = Money.percentOf(unit, line.discountPercent || "0");
      const effective = unit - discount;

      return effective < Money.toMinor(floor);
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
        const floor = line.product.minSellingPrice;
        if (!floor) return false;

        const unit = Money.toMinor(line.unitPrice);
        const discount = Money.percentOf(unit, line.discountPercent || "0");
        return unit - discount < Money.toMinor(floor);
      }),
    [lines],
  );
}
