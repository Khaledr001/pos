import { DEFAULT_TENANT_SETTINGS } from "@devsfleet/shared-types";
import { Money, calculateDocument, type DocumentTotals } from "@devsfleet/shared-utils";
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
