import { vatFor } from './money.js';

export const SHIPPING_VAT_BPS = 500;

export interface TotalsLine {
  lineNetFils: number;
  vatRateBps: number;
}

export interface Totals {
  subtotalNetFils: number; // before discount
  discountNetFils: number;
  shippingNetFils: number;
  vatFils: number;
  totalFils: number; // VAT-inclusive grand total
  /** VAT per line after the discount share, aligned with the input lines. */
  lineVatFils: number[];
}

/**
 * Splits a discount across lines in proportion to their net value (largest
 * remainder, so the parts add up exactly), then charges VAT on what's left.
 * This keeps VAT correct when lines have different VAT classes.
 */
export function allocateDiscount(lines: TotalsLine[], discountNetFils: number): number[] {
  const subtotal = lines.reduce((s, l) => s + l.lineNetFils, 0);
  if (!discountNetFils || !subtotal) return lines.map(() => 0);
  const discount = Math.min(discountNetFils, subtotal);

  const raw = lines.map((l) => (l.lineNetFils * discount) / subtotal);
  const parts = raw.map(Math.floor);
  let rest = discount - parts.reduce((s, p) => s + p, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (rest <= 0) break;
    parts[i] += 1;
    rest -= 1;
  }
  return parts;
}

export function computeTotals(
  lines: TotalsLine[],
  discountNetFils: number,
  shippingNetFils: number,
): Totals {
  const subtotalNetFils = lines.reduce((s, l) => s + l.lineNetFils, 0);
  const discount = Math.min(discountNetFils, subtotalNetFils);
  const shares = allocateDiscount(lines, discount);
  const lineVatFils = lines.map((l, i) => vatFor(l.lineNetFils - shares[i], l.vatRateBps));
  const vatFils = lineVatFils.reduce((s, v) => s + v, 0) + vatFor(shippingNetFils, SHIPPING_VAT_BPS);
  return {
    subtotalNetFils,
    discountNetFils: discount,
    shippingNetFils,
    vatFils,
    totalFils: subtotalNetFils - discount + shippingNetFils + vatFils,
    lineVatFils,
  };
}
