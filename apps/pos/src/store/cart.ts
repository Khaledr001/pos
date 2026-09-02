import { DEFAULT_TENANT_SETTINGS } from "@devsfleet/shared-types";
import { Money, calculateDocument, type DocumentTotals } from "@devsfleet/shared-utils";
import { useMemo } from "react";
import { create } from "zustand";
import type { PosCustomer, PosProduct, PosVariantUnit } from "../lib/pos-data.js";

/**
 * The cart.
 *
 * Totals are NOT stored. They are derived on every read by `calculateDocument`
 * — the same function the API and the admin panel call.
 *
 * Quantities are clamped against physical available stock at this branch
 * to prevent selling phantom negative inventory at the counter.
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
   * The packaging this line is sold in — a box, a carton (Stage 3). `null` means the
   * base unit. Snapshotted onto the line (not re-resolved).
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
  overrideGrants?: string[];
}

interface CartState {
  lines: CartLine[];
  customer: PosCustomer | null;
  /** Applied across the document and pushed down onto lines before tax. */
  documentDiscountPercent: string;
  note: string;
  overrideGrants: string[];

  addProduct: (product: PosProduct, quantity?: string) => void;
  setQuantity: (key: string, quantity: string) => void;
  adjustQuantity: (key: string, delta: number) => void;
  setUnitPrice: (key: string, unitPrice: string, overrideFloor?: boolean) => void;
  setLineUnit: (key: string, unit: PosVariantUnit | null) => void;
  addOverrideGrant: (grant: string) => void;
  setLineDiscount: (key: string, percent: string) => void;
  removeLine: (key: string) => void;
  setCustomer: (customer: PosCustomer | null) => void;
  setDocumentDiscount: (percent: string) => void;
  setNote: (note: string) => void;
  clear: () => void;

  snapshot: () => CartSnapshot;
  restore: (snapshot: CartSnapshot) => void;

  totals: () => DocumentTotals;
  lineCount: () => number;
  unitCount: () => string;
  floorViolations: () => CartLine[];
}

const TAX_MODE = DEFAULT_TENANT_SETTINGS.tax.mode;
const DECIMALS = DEFAULT_TENANT_SETTINGS.currency.decimals;

export function scaledFloor(line: CartLine): Money.Minor4 | null {
  const floor = line.product.minSellingPrice;
  if (!floor) return null;
  return Money.multiplyByQuantity(Money.toMinor(floor), line.unit?.conversionFactor ?? "1");
}

export function scaledListPrice(line: CartLine): Money.Minor4 {
  if (line.unit?.priceOverride) return Money.toMinor(line.unit.priceOverride);
  return Money.multiplyByQuantity(
    Money.toMinor(line.product.sellingPrice),
    line.unit?.conversionFactor ?? "1",
  );
}

function sameAmount(a: string, b: string): boolean {
  return Money.toMinor(a) === Money.toMinor(b);
}

/**
 * `product.stock` is always in the BASE unit. When a line is sold in a
 * packaging (`line.unit` — e.g. Roll, conversionFactor "100"), a quantity
 * typed in THAT unit has to be scaled down from stock before it means
 * anything as a ceiling — otherwise a cashier keying up to the raw stock
 * NUMBER is keying up to that many rolls, not that many metres, and can
 * oversell by a factor of the conversion (250m in stock read as "250" sellable
 * rolls instead of 2.5).
 */
export function maxQuantityInLineUnit(line: CartLine): number {
  const stock = Number(line.product.stock);
  if (!Number.isFinite(stock) || stock <= 0) return 0;
  const factor = line.unit ? Number(line.unit.conversionFactor) : 1;
  if (!Number.isFinite(factor) || factor <= 0) return stock;
  return stock / factor;
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

  addProduct(product, quantity = "1") {
    const stock = Number(product.stock);
    if (!Number.isFinite(stock) || stock <= 0) {
      return; // Out of stock: do not add
    }

    const requestedQty = Number(quantity);
    if (!Number.isFinite(requestedQty) || requestedQty <= 0) return;

    const existing = get().lines.find(
      (line) =>
        line.product.id === product.id &&
        sameAmount(line.unitPrice, pickTierPrice(product, line.quantity)) &&
        line.discountPercent === "0",
    );

    if (existing) {
      const currentQty = Number(existing.quantity);
      // existing.quantity is denominated in existing.unit, not necessarily
      // the base unit `stock` is — see maxQuantityInLineUnit.
      const nextQty = Math.min(maxQuantityInLineUnit(existing), currentQty + requestedQty);
      if (nextQty <= currentQty) return; // Cannot exceed available stock
      get().setQuantity(existing.key, String(Number(nextQty.toFixed(4))));
      return;
    }

    const safeQty = Math.min(stock, requestedQty);
    const qtyStr = String(Number(safeQty.toFixed(4)));

    set((state) => ({
      lines: [
        ...state.lines,
        {
          key: crypto.randomUUID(),
          product,
          quantity: qtyStr,
          unitPrice: pickTierPrice(product, qtyStr),
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
        const stock = Number(line.product.stock);
        // Clamp quantity strictly to available remaining stock (converted into
        // line.unit — see maxQuantityInLineUnit) if stock figure is finite
        const safeQty = Number.isFinite(stock) && stock > 0 ? Math.min(parsed, maxQuantityInLineUnit(line)) : parsed;
        const qtyStr = String(Number(safeQty.toFixed(4)));

        const onLadder = sameAmount(line.unitPrice, scaledTierPrice(line, line.quantity));
        const unitPrice = onLadder ? scaledTierPrice(line, qtyStr) : line.unitPrice;
        return { ...line, quantity: qtyStr, unitPrice };
      }),
    }));
  },

  adjustQuantity(key, delta) {
    const line = get().lines.find((l) => l.key === key);
    if (!line) return;
    const current = Number(line.quantity);
    const stock = Number(line.product.stock);
    let next = current + delta;
    if (delta > 0 && Number.isFinite(stock) && stock > 0) {
      next = Math.min(next, maxQuantityInLineUnit(line));
    }
    if (next <= 0) {
      get().removeLine(key);
      return;
    }
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
      lines: snapshot.lines.map((line) => ({
        ...line,
        key: crypto.randomUUID(),
        addedAt: Date.now(),
        unit: line.unit ?? null,
      })),
      customer: snapshot.customer ?? null,
      documentDiscountPercent: snapshot.documentDiscountPercent ?? "0",
      note: snapshot.note ?? "",
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
