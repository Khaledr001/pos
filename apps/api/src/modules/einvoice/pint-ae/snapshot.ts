import { EAS_UAE_TIN, normalizeTrn, PAYMENT_MEANS_CODES, resolveTenantSettings, tinFromTrn, type CreditNoteReason, type EinvoiceDocType, type TaxCategory, type TaxExemptionCode } from "@devsfleet/shared-types";
import { Money } from "@devsfleet/shared-utils";
import { AED } from "./constants.js";
import { addDays, amount2, localParts, trimmed } from "./format.js";
import { SNAPSHOT_SCHEMA_VERSION, type EinvoiceSnapshot, type LineSnapshot, type PartySnapshot, type TaxBreakdownSnapshot } from "./snapshot-types.js";

/** What `buildSnapshot` needs, as plain rows (strings straight from Postgres). */
export interface SnapshotSource {
  docType: EinvoiceDocType;
  uuid: string;
  sale: {
    saleNumber: string;
    occurredAt: Date;
    currency: string;
    exchangeRate: string;
    taxMode: "exclusive" | "inclusive";
    subtotal: string;
    taxAmount: string;
    total: string;
    dueAmount: string;
    creditReason: string | null;
  };
  lines: {
    sortOrder: number;
    productName: string;
    variantName: string;
    productSku: string;
    quantity: string;
    unitPrice: string;
    taxPercent: string;
    taxAmount: string;
    lineSubtotal: string;
    taxCategory: string;
    taxExemptionCode: string | null;
    unitCode: string;
  }[];
  payments: { method: string; amount: string }[];
  tenant: { name: string; settings: unknown };
  customer: {
    name: string;
    company: string | null;
    trn: string | null;
    email: string | null;
    phone: string | null;
    paymentTermDays: number;
    addressLine1: string | null;
    addressLine2: string | null;
    addressCity: string | null;
    addressSubdivision: string | null;
    addressPostalCode: string | null;
    addressCountry: string | null;
    einvoiceScheme: string | null;
    einvoiceEndpoint: string | null;
  } | null;
  original: { saleNumber: string; occurredAt: Date } | null;
}

const trimOrNull = (value: string | null | undefined): string | null => {
  const t = value?.trim();
  return t ? t : null;
};

/** How a tender is reported (UNCL4461 subset in PINT AE). Bank transfer is "not defined": code 30 would demand an IBAN the platform does not hold. */
export function paymentMeansCode(method: string): string {
  switch (method) {
    case "cash":
      return PAYMENT_MEANS_CODES.cash;
    case "card":
      return PAYMENT_MEANS_CODES.card;
    case "cheque":
      return PAYMENT_MEANS_CODES.cheque;
    default:
      return PAYMENT_MEANS_CODES.other;
  }
}

function sellerFrom(tenant: SnapshotSource["tenant"]): PartySnapshot {
  const s = resolveTenantSettings(tenant.settings);
  const trn = trimOrNull(s.trn) ? normalizeTrn(s.trn!) : null;
  const tin = trn ? tinFromTrn(trn) : null;
  const endpoint = s.einvoice.endpoint ?? (tin ? { scheme: EAS_UAE_TIN, id: tin } : null);
  const a = s.legalAddress;
  return {
    name: trimOrNull(s.legalName) ?? tenant.name,
    endpoint,
    trn,
    address: a
      ? {
          line1: a.line1?.trim() ?? "",
          line2: trimOrNull(a.line2),
          city: a.city?.trim() ?? "",
          subdivision: a.subdivision?.trim() ?? "",
          postalCode: trimOrNull(a.postalCode),
          countryCode: (a.countryCode ?? "AE").trim().toUpperCase(),
        }
      : null,
    legalRegistration: s.einvoice.legalRegistration,
    email: trimOrNull(s.email),
    phone: trimOrNull(s.phone),
  };
}

function buyerFrom(customer: SnapshotSource["customer"]): PartySnapshot {
  if (!customer) {
    return { name: "", endpoint: null, trn: null, address: null, legalRegistration: null, email: null, phone: null };
  }
  const trn = trimOrNull(customer.trn) ? normalizeTrn(customer.trn!) : null;
  const tin = trn ? tinFromTrn(trn) : null;
  const scheme = trimOrNull(customer.einvoiceScheme);
  const id = trimOrNull(customer.einvoiceEndpoint);
  const endpoint = scheme && id ? { scheme, id } : tin ? { scheme: EAS_UAE_TIN, id: tin } : null;
  const line1 = trimOrNull(customer.addressLine1);
  const city = trimOrNull(customer.addressCity);
  const subdivision = trimOrNull(customer.addressSubdivision);
  return {
    name: trimOrNull(customer.company) ?? customer.name.trim(),
    endpoint,
    trn,
    address:
      line1 || city || subdivision
        ? {
            line1: line1 ?? "",
            line2: trimOrNull(customer.addressLine2),
            city: city ?? "",
            subdivision: subdivision ?? "",
            postalCode: trimOrNull(customer.addressPostalCode),
            countryCode: (trimOrNull(customer.addressCountry) ?? "AE").toUpperCase(),
          }
        : null,
    legalRegistration: null,
    email: trimOrNull(customer.email),
    phone: trimOrNull(customer.phone),
  };
}

const HUNDRED_SCALED = 100n * 10_000n;

/**
 * One line, derived entirely from what the platform stored for it.
 *
 * The XML's price block is rebuilt from the line's net so that the rule
 * "net = quantity × price + charges − allowances" (ibr-147-ae) holds by
 * construction: the gross is the stored net plus the discount, the discount is
 * whatever reconciles them, and the per-unit price is used only when it is
 * exact at 4 decimals — otherwise the price is sent for the whole line (base
 * quantity = quantity), which is arithmetic-safe at any rounding.
 */
export function buildLine(source: SnapshotSource["lines"][number], index: number, taxMode: "exclusive" | "inclusive", rateToAed: string | null): LineSnapshot {
  const qty = Money.abs(Money.toMinor(source.quantity));
  const unitPrice = Money.toMinor(source.unitPrice);
  const rate = Money.toMinor(source.taxPercent);
  const net = Money.abs(Money.toMinor(source.lineSubtotal));
  const tax = Money.abs(Money.toMinor(source.taxAmount));

  // Gross before discount, before VAT, to 2 places — the way calculateLine would have reached it.
  let gross = Money.multiplyByQuantity(unitPrice, qty);
  if (taxMode === "inclusive" && rate !== 0n) {
    gross = Money.divideRoundHalfUp(gross * HUNDRED_SCALED, HUNDRED_SCALED + rate);
  }
  gross = Money.roundTo(gross, 2);
  // A discount cannot be negative; if rounding put the gross a cent under the net, the net is the gross.
  if (gross < net) gross = net;
  const allowance = gross - net;

  let price: Money.Minor4;
  let baseQuantity: string;
  const perUnit = qty === 0n ? 0n : Money.divideRoundHalfUp(gross * 10_000n, qty);
  if (qty !== 0n && perUnit * qty === gross * 10_000n) {
    price = perUnit;
    baseQuantity = "1";
  } else {
    price = gross;
    baseQuantity = trimmed(qty);
  }

  const category = (source.taxCategory as TaxCategory) || "S";
  const total = net + tax;
  const toAed = (value: Money.Minor4) => (rateToAed ? Money.roundTo(Money.multiplyByQuantity(value, rateToAed), 2) : value);
  const name = source.variantName && source.variantName !== "Default" ? `${source.productName} - ${source.variantName}` : source.productName;

  return {
    id: index + 1,
    name: name.trim(),
    description: name.trim(),
    sku: source.productSku,
    quantity: trimmed(qty),
    unitCode: source.unitCode || "C62",
    unitPrice: trimmed(price),
    priceBaseQuantity: baseQuantity,
    allowance: amount2(allowance),
    net: amount2(net),
    taxCategory: category,
    taxRate: category === "E" || category === "O" ? null : trimmed(rate),
    taxExemptionCode: (source.taxExemptionCode as TaxExemptionCode | null) ?? null,
    tax: amount2(tax),
    total: amount2(total),
    amountAed: amount2(toAed(total)),
    taxAed: amount2(toAed(tax)),
  };
}

/** Group lines into the VAT breakdown PINT requires: one entry per category and rate. */
export function buildBreakdown(lines: LineSnapshot[]): TaxBreakdownSnapshot[] {
  const groups = new Map<string, { category: TaxCategory; rate: string | null; taxable: bigint; tax: bigint; exemptionCode: TaxExemptionCode | null }>();
  for (const line of lines) {
    // E and O carry no rate, so each is a single group however it was priced.
    const key = line.taxCategory === "E" || line.taxCategory === "O" ? line.taxCategory : `${line.taxCategory}:${line.taxRate}`;
    const group = groups.get(key) ?? { category: line.taxCategory, rate: line.taxRate, taxable: 0n, tax: 0n, exemptionCode: line.taxExemptionCode };
    group.taxable += Money.toMinor(line.net);
    group.tax += Money.toMinor(line.tax);
    group.exemptionCode ??= line.taxExemptionCode;
    groups.set(key, group);
  }
  const order: Record<string, number> = { S: 0, Z: 1, E: 2, O: 3 };
  return [...groups.values()]
    .sort((a, b) => (order[a.category]! - order[b.category]!) || Number(a.rate ?? 0) - Number(b.rate ?? 0))
    .map((g) => ({ category: g.category, rate: g.rate, taxable: amount2(g.taxable), tax: amount2(g.tax), exemptionCode: g.exemptionCode }));
}

export function buildSnapshot(source: SnapshotSource): EinvoiceSnapshot {
  const settings = resolveTenantSettings(source.tenant.settings);
  const timezone = settings.locale.timezone;
  const issued = localParts(source.sale.occurredAt, timezone);
  const isCredit = source.docType === "credit_note";
  const currency = source.sale.currency;
  const rateToAed = currency === AED ? null : settings.currency.base === AED ? trimmedRate(source.sale.exchangeRate) : null;

  const lines = [...source.lines].sort((a, b) => a.sortOrder - b.sortOrder).map((l, i) => buildLine(l, i, source.sale.taxMode, rateToAed));
  const net = lines.reduce((s, l) => s + Money.toMinor(l.net), 0n);
  const tax = lines.reduce((s, l) => s + Money.toMinor(l.tax), 0n);
  const total = net + tax;
  const toAed = (value: bigint) => (rateToAed ? Money.roundTo(Money.multiplyByQuantity(value, rateToAed), 2) : value);

  const paymentCodes = [...new Set(source.payments.filter((p) => Money.isPositive(Money.abs(Money.toMinor(p.amount)))).map((p) => paymentMeansCode(p.method)))].sort();
  const paymentMeans = isCredit ? [] : paymentCodes.length > 0 ? paymentCodes : [PAYMENT_MEANS_CODES.other];

  const originalIssue = source.original ? localParts(source.original.occurredAt, timezone).date : null;
  const due = Money.isPositive(Money.toMinor(source.sale.dueAmount)) ? addDays(issued.date, Math.max(0, source.customer?.paymentTermDays ?? 0)) : issued.date;

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    docType: source.docType,
    uuid: source.uuid,
    documentNumber: source.sale.saleNumber,
    issuedAt: source.sale.occurredAt.toISOString(),
    issueDate: issued.date,
    issueTime: `${issued.time}${issued.offset}`,
    timezone,
    dueDate: isCredit ? null : due,
    currency,
    exchangeRate: rateToAed,
    baseCurrency: settings.currency.base,
    seller: sellerFrom(source.tenant),
    buyer: buyerFrom(source.customer),
    lines,
    breakdown: buildBreakdown(lines),
    totals: {
      net: amount2(net),
      tax: amount2(tax),
      total: amount2(total),
      taxAed: amount2(toAed(tax)),
      totalAed: amount2(toAed(total)),
    },
    recorded: {
      net: amount2(Money.abs(Money.toMinor(source.sale.subtotal))),
      tax: amount2(Money.abs(Money.toMinor(source.sale.taxAmount))),
      total: amount2(Money.abs(Money.toMinor(source.sale.total))),
    },
    paymentMeans,
    credit: isCredit
      ? { reason: (source.sale.creditReason as CreditNoteReason | null) ?? null, originalNumber: source.original?.saleNumber ?? null, originalIssueDate: originalIssue }
      : null,
  };
}

/** The sale's rate as the exact string to send (≤ 6 places), or null when it is missing or not a positive number. */
function trimmedRate(value: string): string | null {
  const minor = Money.toMinor(value);
  return Money.isPositive(minor) ? trimmed(minor) : null;
}
