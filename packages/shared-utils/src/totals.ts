import { defaultTaxCategory, TAX_CATEGORIES, type TaxCategory, type TaxMode } from "@devsfleet/shared-types";
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
  /**
   * VAT category (S standard, Z zero-rated, E exempt, O out of scope). Absent =
   * derived from the rate: taxed is S, untaxed is Z. It does not change the
   * arithmetic — only how the line is reported in the tax breakdown.
   */
  taxCategory?: TaxCategory;
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

export interface TaxBreakdownEntry {
  category: TaxCategory;
  rate: string;
  base: Minor4;
  tax: Minor4;
}

export interface DocumentTotals {
  lines: LineTotals[];
  subtotal: Minor4;
  discountAmount: Minor4;
  taxAmount: Minor4;
  total: Minor4;
  /**
   * Tax broken out by category and rate — required on a UAE tax invoice with
   * mixed treatments. Zero-rated and exempt lines stay separate even though
   * both are 0%.
   */
  taxBreakdown: TaxBreakdownEntry[];
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

  finalLines = settleTaxByGroup(lines, finalLines, taxMode, decimals);

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

/**
 * Re-settle VAT per (category, rate) group instead of per line.
 *
 * Each line was rounded on its own by `calculateLine`, which is right for one
 * line but drifts on a long invoice: 100 lines of 0.30 at 5% round to 0.02 each,
 * so the document says 2.00 VAT where 5% of the 30.00 taxable amount is 1.50.
 * A tax invoice's VAT per rate must agree with rate x taxable amount (the UAE
 * e-invoice rules allow only 0.02 of difference), so the group's VAT is rounded
 * ONCE from the group's taxable amount and then spread back over its lines
 * (largest remainder) so the lines still add up to it to the last fil.
 *
 * Exclusive: line nets stay as they are; each line's tax is its share.
 * Inclusive: the customer's price for each line is what it is — the line total
 * stays exactly the discounted shelf price — and the group's tax is extracted
 * from the group's gross in one division, then shared out the same way.
 *
 * A group with a single line, or no tax, is already exact and left alone.
 */
function settleTaxByGroup(
  inputs: LineInput[],
  totals: LineTotals[],
  taxMode: TaxMode,
  decimals: number,
): LineTotals[] {
  const groups = new Map<string, number[]>();
  inputs.forEach((line, i) => {
    const rate = toMinor(line.taxPercent ?? 0);
    if (rate === 0n) return;
    const category = line.taxCategory ?? defaultTaxCategory(String(line.taxPercent ?? 0));
    const key = `${category}|${rate}`;
    const members = groups.get(key);
    if (members) members.push(i);
    else groups.set(key, [i]);
  });

  const result = totals.slice();
  const unit = 10n ** BigInt(4 - decimals);

  for (const [key, members] of groups) {
    if (members.length < 2) continue;
    const rate = BigInt(key.split("|")[1] as string);

    if (taxMode === "inclusive") {
      const gross = members.map((i) => (totals[i] as LineTotals).total);
      const groupGross = add(...gross);
      const exactNet = divideRoundHalfUp(groupGross * HUNDRED * 10_000n, HUNDRED * 10_000n + rate);
      const groupTax = groupGross - roundTo(exactNet, decimals);
      const shares = spreadRounded(groupTax, gross, unit);
      members.forEach((lineIndex, k) => {
        const line = totals[lineIndex] as LineTotals;
        const tax = shares[k] as Minor4;
        result[lineIndex] = { ...line, tax, net: line.total - tax };
      });
    } else {
      const nets = members.map((i) => (totals[i] as LineTotals).net);
      const groupTax = roundTo(percentOf(add(...nets), rate), decimals);
      const shares = spreadRounded(groupTax, nets, unit);
      members.forEach((lineIndex, k) => {
        const line = totals[lineIndex] as LineTotals;
        const tax = shares[k] as Minor4;
        result[lineIndex] = { ...line, tax, total: line.net + tax };
      });
    }
  }
  return result;
}

/**
 * Split `amount` over `weights` in whole multiples of `unit`, by largest
 * remainder, so the parts sum to the amount exactly. Signs are handled on
 * magnitudes: a credit note's negative weights and amount split like a positive
 * one. All-zero weights give the first line everything.
 */
function spreadRounded(amount: Minor4, weights: Minor4[], unit: Minor4): Minor4[] {
  const sign = amount < 0n ? -1n : 1n;
  const magnitude = amount < 0n ? -amount : amount;
  const absWeights = weights.map((w) => (w < 0n ? -w : w));
  const totalWeight = absWeights.reduce((a, b) => a + b, 0n);
  if (totalWeight === 0n) return weights.map((_, i) => (i === 0 ? amount : 0n));

  const units = magnitude / unit;
  const parts = absWeights.map((w) => {
    const exact = units * w;
    return { whole: exact / totalWeight, remainder: exact % totalWeight };
  });
  let left = units - parts.reduce((a, p) => a + p.whole, 0n);
  const order = parts.map((_, i) => i).sort((a, b) => {
    const diff = (parts[b] as { remainder: bigint }).remainder - (parts[a] as { remainder: bigint }).remainder;
    return diff > 0n ? 1 : diff < 0n ? -1 : a - b;
  });
  for (const i of order) {
    if (left === 0n) break;
    (parts[i] as { whole: bigint }).whole += 1n;
    left -= 1n;
  }
  return parts.map((p) => sign * p.whole * unit);
}

function buildTaxBreakdown(inputs: LineInput[], totals: LineTotals[]): TaxBreakdownEntry[] {
  const groups = new Map<string, TaxBreakdownEntry>();

  inputs.forEach((line, i) => {
    const totalsForLine = totals[i];
    if (!totalsForLine) return;

    const rate = String(line.taxPercent ?? 0);
    const category = line.taxCategory ?? defaultTaxCategory(rate);
    // Keyed on the numeric rate so "5" and "5.0000" are one group, as they are one rate.
    const key = `${category}|${toMinor(rate)}`;
    const existing = groups.get(key) ?? { category, rate, base: 0n, tax: 0n };
    groups.set(key, {
      ...existing,
      base: existing.base + totalsForLine.net,
      tax: existing.tax + totalsForLine.tax,
    });
  });

  return [...groups.values()].sort(
    (a, b) => Number(a.rate) - Number(b.rate) || TAX_CATEGORIES.indexOf(a.category) - TAX_CATEGORIES.indexOf(b.category),
  );
}
