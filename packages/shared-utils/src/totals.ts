import type { TaxMode } from "@devsfleet/shared-types";
import {
  type Minor4,
  add,
  allocateByWeight,
  divideRoundHalfUp,
  multiplyByQuantity,
  percentOf,
  roundTo,
  toMinor,
  type MoneyInput,
} from "./money.js";

/**
 * The one and only place a line total or a document total is computed.
 *
 * apps/api, apps/pos and apps/admin all call this. That is the point: a
 * quotation created by the WhatsApp bot, the same cart priced on a POS
 * terminal, and the invoice the admin panel renders must agree to the fils. Two
 * implementations of "subtotal minus discount plus VAT" will diverge — usually
 * on the day a customer notices.
 *
 * Rounding policy: round once, per line, at the end of that line. Not per
 * intermediate step (accumulates error) and not only at document level (line
 * totals on the printed receipt would not sum to the printed total).
 */

export interface LineInput {
  quantity: MoneyInput;
  unitPrice: MoneyInput;
  /** 0-100. Applied to the line's gross before tax. */
  discountPercent?: MoneyInput;
  /** Absolute per-line discount. Applied after the percentage. */
  discountAmount?: MoneyInput;
  /** 0-100. Defaults to the tenant's configured rate; pass 0 for exempt lines. */
  taxPercent?: MoneyInput;
}

export interface LineTotals {
  /** quantity x unitPrice, before any discount. */
  gross: Minor4;
  discount: Minor4;
  /** Taxable base: gross - discount, tax removed if the price was tax-inclusive. */
  net: Minor4;
  tax: Minor4;
  /** What the customer pays for this line: net + tax. */
  total: Minor4;
}

export interface DocumentInput {
  lines: LineInput[];
  taxMode: TaxMode;
  /** Discount applied to the whole document, spread across lines by weight. */
  documentDiscountPercent?: MoneyInput;
  documentDiscountAmount?: MoneyInput;
  /** Display decimals. Line totals round here, e.g. 2 for AED. */
  decimals?: number;
}

export interface DocumentTotals {
  lines: LineTotals[];
  subtotal: Minor4;
  discountAmount: Minor4;
  taxAmount: Minor4;
  total: Minor4;
  /** Tax broken out by rate — required on a UAE tax invoice with mixed rates. */
  taxBreakdown: Array<{ rate: string; base: Minor4; tax: Minor4 }>;
}

const HUNDRED = 100n;

/**
 * Compute one line.
 *
 * `taxMode: "exclusive"` — unitPrice excludes tax; tax is added on top.
 * `taxMode: "inclusive"` — unitPrice already contains tax; it is extracted out.
 *
 * Extraction is `net = grossAfterDiscount / (1 + rate)`, done as one integer
 * division so it rounds once rather than compounding.
 */
export function calculateLine(
  line: LineInput,
  taxMode: TaxMode,
  decimals: number = 2,
): LineTotals {
  const unitPrice = toMinor(line.unitPrice);
  const gross = multiplyByQuantity(unitPrice, line.quantity);

  const percentDiscount = line.discountPercent
    ? percentOf(gross, line.discountPercent)
    : 0n;
  const flatDiscount = line.discountAmount ? toMinor(line.discountAmount) : 0n;
  const discount = percentDiscount + flatDiscount;

  const afterDiscount = gross - discount;
  const taxPercent = toMinor(line.taxPercent ?? 0);

  let net: Minor4;
  let tax: Minor4;

  if (taxPercent === 0n) {
    net = afterDiscount;
    tax = 0n;
  } else if (taxMode === "inclusive") {
    // net = afterDiscount * 100 / (100 + rate), with rate scaled by 10^4.
    const denominator = HUNDRED * 10_000n + taxPercent;
    net = divideRoundHalfUp(afterDiscount * HUNDRED * 10_000n, denominator);
    tax = afterDiscount - net;
  } else {
    net = afterDiscount;
    tax = percentOf(net, taxPercent);
  }

  const rNet = roundTo(net, decimals);
  const rTax = roundTo(tax, decimals);

  return {
    gross: roundTo(gross, decimals),
    discount: roundTo(discount, decimals),
    net: rNet,
    tax: rTax,
    total: rNet + rTax,
  };
}

/**
 * Compute a whole document.
 *
 * A document-level discount is pushed down onto the lines proportionally
 * (weighted by each line's net) before tax is computed, rather than subtracted
 * from the final total. That is the only way the tax figure stays correct: a
 * 10% invoice discount reduces the VAT owed, it does not sit beneath it.
 */
export function calculateDocument(input: DocumentInput): DocumentTotals {
  const { lines, taxMode, decimals = 2 } = input;

  if (lines.length === 0) {
    return {
      lines: [],
      subtotal: 0n,
      discountAmount: 0n,
      taxAmount: 0n,
      total: 0n,
      taxBreakdown: [],
    };
  }

  // Pass 1: line-level discounts only, to get the weights.
  const provisional = lines.map((line) => calculateLine(line, taxMode, decimals));

  const docPercent = input.documentDiscountPercent
    ? toMinor(input.documentDiscountPercent)
    : 0n;
  const docFlat = input.documentDiscountAmount ? toMinor(input.documentDiscountAmount) : 0n;

  let finalLines = provisional;
  let documentDiscount = 0n;

  if (docPercent !== 0n || docFlat !== 0n) {
    const provisionalNet = add(...provisional.map((l) => l.net));
    documentDiscount =
      (docPercent !== 0n ? percentOf(provisionalNet, docPercent) : 0n) + docFlat;

    const shares = allocateByWeight(
      documentDiscount,
      provisional.map((l) => l.net),
    );

    // Pass 2: fold each line's share of the document discount into that line,
    // then recompute so tax lands on the genuinely discounted base.
    finalLines = lines.map((line, i) => {
      const existingFlat = line.discountAmount ? toMinor(line.discountAmount) : 0n;
      return calculateLine(
        { ...line, discountAmount: existingFlat + (shares[i] ?? 0n) },
        taxMode,
        decimals,
      );
    });
  }

  const subtotal = add(...finalLines.map((l) => l.net));
  const taxAmount = add(...finalLines.map((l) => l.tax));
  const lineDiscounts = add(...finalLines.map((l) => l.discount));

  return {
    lines: finalLines,
    subtotal,
    discountAmount: lineDiscounts,
    taxAmount,
    total: subtotal + taxAmount,
    taxBreakdown: buildTaxBreakdown(lines, finalLines),
  };
}

function buildTaxBreakdown(
  inputs: LineInput[],
  totals: LineTotals[],
): Array<{ rate: string; base: Minor4; tax: Minor4 }> {
  const byRate = new Map<string, { base: Minor4; tax: Minor4 }>();

  inputs.forEach((line, i) => {
    const totalsForLine = totals[i];
    if (!totalsForLine) return;

    const rate = String(line.taxPercent ?? 0);
    const existing = byRate.get(rate) ?? { base: 0n, tax: 0n };
    byRate.set(rate, {
      base: existing.base + totalsForLine.net,
      tax: existing.tax + totalsForLine.tax,
    });
  });

  return [...byRate.entries()]
    .map(([rate, v]) => ({ rate, ...v }))
    .sort((a, b) => Number(a.rate) - Number(b.rate));
}
