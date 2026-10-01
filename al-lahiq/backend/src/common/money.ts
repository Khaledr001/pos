import type { VatClass } from '../generated/prisma/enums.js';

/**
 * Money helpers. All amounts are integer fils (1 AED = 100 fils).
 * Rounding: half away from zero, applied per line (UAE FTA accepts line-level rounding).
 */

export const VAT_RATE_BPS: Record<VatClass, number> = {
  STANDARD_5: 500,
  ZERO: 0,
  EXEMPT: 0,
};

export function roundFils(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

export function vatFor(netFils: number, rateBps: number): number {
  return roundFils((netFils * rateBps) / 10_000);
}

export function grossFor(netFils: number, rateBps: number): number {
  return netFils + vatFor(netFils, rateBps);
}

/** Line net = unit net × quantity (quantity may be fractional, e.g. 2.5 m). */
export function lineNetFor(unitNetFils: number, quantity: number): number {
  return roundFils(unitNetFils * quantity);
}

const aed = new Intl.NumberFormat('en-AE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatAed(fils: number): string {
  return `AED ${aed.format(fils / 100)}`;
}

/** The shape every money value takes in API responses. */
export interface Money {
  fils: number;
  formatted: string;
}

export function money(fils: number): Money {
  return { fils, formatted: formatAed(fils) };
}
