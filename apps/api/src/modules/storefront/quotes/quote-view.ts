import type { Transaction } from "@devsfleet/db";
import type { WebQuote, WebQuoteItem } from "@devsfleet/db";
import { resolveTenantSettings, type TaxMode } from "@devsfleet/shared-types";
import { Money } from "@devsfleet/shared-utils";
import { moneyView } from "../pricing/money-view.js";
import { toWire } from "../wire.js";
import { lineGross } from "./quote-math.js";
import { effectiveStatus } from "./quote-status.js";

/** Display decimals come from the tenant, not the request, so staff and shopper routes agree. */
export async function displayDecimals(tx: Transaction): Promise<number> {
  const tenant = await tx.query.tenants.findFirst({ columns: { settings: true } });
  return resolveTenantSettings(tenant?.settings).currency.decimals;
}

const unitPriceOf = (item: WebQuoteItem) => item.quotedUnitPrice ?? item.unitPrice;

function lines(items: WebQuoteItem[], taxMode: TaxMode, decimals: number, currency: string) {
  const view = (minor: bigint) => moneyView(minor, currency, decimals);
  return [...items]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((item) => {
      const price = unitPriceOf(item);
      const one = { quantity: "1", unitPrice: price, taxPercent: item.taxPercent };
      return {
        id: item.id,
        variantId: item.variantId,
        sku: item.productSku,
        name: item.productName,
        variantName: item.variantName,
        uom: item.uom,
        quantity: Number(item.quantity),
        // VAT-inclusive, as the cart shows them; the quote's own tax mode decides how.
        unitPrice: view(lineGross(one, taxMode, decimals)),
        lineTotal: view(lineGross({ ...one, quantity: item.quantity }, taxMode, decimals)),
        priced: item.quotedUnitPrice !== null,
      };
    });
}

/** What the shopper sees. Never staff notes, never who priced it. */
export function shopperQuoteView(quote: WebQuote, items: WebQuoteItem[], decimals: number, now = new Date()) {
  const view = (value: string) => moneyView(Money.toMinor(value), quote.currency, decimals);
  const taxMode = quote.taxMode as TaxMode;
  return {
    id: quote.id,
    number: quote.number,
    status: toWire(effectiveStatus(quote.status, quote.validUntil, now)),
    // While requested, every figure is an estimate at list price.
    estimate: quote.status === "requested",
    requestedAt: quote.requestedAt,
    quotedAt: quote.quotedAt,
    validUntil: quote.validUntil,
    respondedAt: quote.respondedAt,
    contactName: quote.contactName,
    contactEmail: quote.contactEmail,
    contactPhone: quote.contactPhone,
    companyName: quote.companyName,
    notes: quote.notes,
    itemCount: items.length,
    lines: lines(items, taxMode, decimals, quote.currency),
    totals: {
      subtotalNet: view(Money.toDecimalString(Money.toMinor(quote.subtotal) + Money.toMinor(quote.discountAmount), 4)),
      discountNet: view(quote.discountAmount),
      vat: view(quote.taxAmount),
      total: view(quote.total),
    },
  };
}

export function shopperQuoteSummary(quote: WebQuote, itemCount: number, decimals: number, now = new Date()) {
  return {
    id: quote.id,
    number: quote.number,
    status: toWire(effectiveStatus(quote.status, quote.validUntil, now)),
    estimate: quote.status === "requested",
    requestedAt: quote.requestedAt,
    validUntil: quote.validUntil,
    itemCount,
    total: moneyView(Money.toMinor(quote.total), quote.currency, decimals),
  };
}

/** What staff see: the shopper's view plus the raw prices they edit and the notes they keep. */
export function staffQuoteView(quote: WebQuote, items: WebQuoteItem[], decimals: number, now = new Date()) {
  return {
    ...shopperQuoteView(quote, items, decimals, now),
    staffNotes: quote.staffNotes,
    discountPercent: quote.discountPercent,
    currency: quote.currency,
    taxMode: quote.taxMode,
    accountId: quote.accountId,
    convertedOrderId: quote.convertedOrderId,
    items: [...items]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((i) => ({
        id: i.id,
        sku: i.productSku,
        name: i.productName,
        variantName: i.variantName,
        uom: i.uom,
        quantity: i.quantity,
        taxPercent: i.taxPercent,
        listUnitPrice: i.unitPrice,
        quotedUnitPrice: i.quotedUnitPrice,
      })),
    // On the stored status: a quote that lapsed unanswered can still be re-priced.
    canPrice: quote.status === "requested" || quote.status === "quoted",
    canDecline: quote.status === "requested" || quote.status === "quoted",
    canExpire: quote.status === "quoted",
  };
}
