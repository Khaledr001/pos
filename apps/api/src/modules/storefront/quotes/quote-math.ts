import type { TaxMode } from "@devsfleet/shared-types";
import { calculateDocument, calculateLine, Money } from "@devsfleet/shared-utils";

export interface QuoteLineInput {
  quantity: string;
  /** In the quote's tax mode, like every unit price on a document. */
  unitPrice: string;
  taxPercent: string;
}

export interface QuoteTotals {
  subtotal: string;
  discountAmount: string;
  taxAmount: string;
  total: string;
}

/**
 * A quote's totals, through the same calculateDocument the cart, the order
 * and the till use (rule 1). Strings at 4 decimals, as the numeric columns
 * store them; `decimals` is the display rounding applied to each line.
 */
export function quoteTotals(lines: QuoteLineInput[], taxMode: TaxMode, decimals: number, discountPercent = "0"): QuoteTotals {
  const totals = calculateDocument({
    taxMode,
    decimals,
    lines,
    ...(Money.toMinor(discountPercent) > 0n ? { documentDiscountPercent: discountPercent } : {}),
  });
  return {
    subtotal: Money.toDecimalString(totals.subtotal, 4),
    discountAmount: Money.toDecimalString(totals.discountAmount, 4),
    taxAmount: Money.toDecimalString(totals.taxAmount, 4),
    total: Money.toDecimalString(totals.total, 4),
  };
}

/** One line, VAT-inclusive, before any document discount. Minor4. */
export function lineGross(line: QuoteLineInput, taxMode: TaxMode, decimals: number): bigint {
  return calculateLine(line, taxMode, decimals).total;
}

/**
 * Whether `quoted` is within `maxDiscountPercent` of `list` once the document
 * discount is applied too. Cross-multiplied in bigint rather than divided
 * (two Minor4 values are never divided): quoted*(100%-doc) >= list*(100%-max).
 */
export function withinDiscountCeiling(list: string, quoted: string, documentDiscountPercent: string, maxDiscountPercent: string): boolean {
  const hundred = Money.toMinor("100");
  const effective = Money.toMinor(quoted) * (hundred - Money.toMinor(documentDiscountPercent));
  const floor = Money.toMinor(list) * (hundred - Money.toMinor(maxDiscountPercent));
  return effective >= floor;
}
