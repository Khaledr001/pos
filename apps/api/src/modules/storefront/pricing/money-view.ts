import type { TaxMode } from "@devsfleet/shared-types";
import { calculateLine, Money } from "@devsfleet/shared-utils";

type Minor4 = bigint;

/**
 * Money as the storefront receives it.
 *
 * `amount` is the authority — a decimal string, the same one the POS stores.
 * `fils` is the same figure in whole minor units, for a page to compare and
 * sort by; it is derived here, from Minor4, so no float ever produced it, and
 * no total the shopper sees is computed from it — every total comes from
 * calculateDocument on the server.
 */
export interface MoneyView {
  amount: string;
  fils: number;
  formatted: string;
}

export function moneyView(minor: Minor4, currency = "AED", decimals = 2): MoneyView {
  const rounded = Money.roundTo(minor, decimals);
  return {
    amount: Money.toDecimalString(rounded, decimals),
    // Minor4 is scaled by 10^4; whole fils are 10^2 of the major unit.
    fils: Number(rounded / 100n),
    formatted: Money.formatMoney(rounded, { currency, decimals }),
  };
}

/**
 * What one unit costs, net and gross, at a given VAT rate.
 *
 * Through calculateLine rather than `price * 1.05`, so a product page shows
 * exactly what that unit would contribute to a receipt.
 */
export function unitNetGross(
  unitPrice: string,
  taxPercent: string,
  taxMode: TaxMode,
  decimals = 2,
): { net: Minor4; gross: Minor4 } {
  const line = calculateLine({ quantity: "1", unitPrice, taxPercent }, taxMode, decimals);
  return { net: line.net, gross: line.total };
}
