import type { CreditNoteReason, EinvoiceDocType, TaxCategory, TaxExemptionCode } from "@devsfleet/shared-types";

/**
 * Everything a PINT AE document is built from, frozen at the moment the
 * invoice or credit note is queued (rule 5): a renamed product, a changed
 * customer address or a new VAT setting next year cannot rewrite what was
 * reported. Stored as `einvoice_documents.snapshot`.
 *
 * Amounts are decimal STRINGS with exactly the precision they are sent at
 * (2 places; prices and quantities up to 4). Credit-note figures are positive:
 * the platform stores a return negative, PINT wants a positive credit note.
 */
export const SNAPSHOT_SCHEMA_VERSION = 1;

export interface PartySnapshot {
  /** Registered name (IBT-027 / IBT-044). */
  name: string;
  /** The Peppol electronic address (IBT-034 / IBT-049). */
  endpoint: { scheme: string; id: string } | null;
  /** The VAT registration number (IBT-031 / IBT-048), digits only. */
  trn: string | null;
  address: {
    line1: string;
    line2: string | null;
    city: string;
    subdivision: string;
    postalCode: string | null;
    countryCode: string;
  } | null;
  /** Seller only: the trade licence (or other) registration the buyer sees. */
  legalRegistration: { id: string; type: string; authority: string } | null;
  email: string | null;
  phone: string | null;
}

export interface LineSnapshot {
  /** 1-based, as printed. */
  id: number;
  name: string;
  description: string;
  sku: string;
  /** Always positive. */
  quantity: string;
  /** UN/ECE Recommendation 20. */
  unitCode: string;
  /** Unit price before discount, before VAT — see `priceBaseQuantity`. */
  unitPrice: string;
  /** "1" normally; the line quantity when no exact per-unit price exists at 4 decimals. */
  priceBaseQuantity: string;
  /** The line's discount, 2 places; "0.00" when there is none. */
  allowance: string;
  /** Line net after discount, before VAT (IBT-131). */
  net: string;
  taxCategory: TaxCategory;
  /** null for E and O, which carry no rate. */
  taxRate: string | null;
  taxExemptionCode: TaxExemptionCode | null;
  tax: string;
  /** net + tax. */
  total: string;
  /** BTAE-10: line amount payable, in AED. */
  amountAed: string;
  /** BTAE-08: line VAT, in AED. */
  taxAed: string;
}

export interface TaxBreakdownSnapshot {
  category: TaxCategory;
  rate: string | null;
  taxable: string;
  tax: string;
  exemptionCode: TaxExemptionCode | null;
}

export interface EinvoiceSnapshot {
  schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
  docType: EinvoiceDocType;
  /** BTAE-07. */
  uuid: string;
  documentNumber: string;
  /** The moment of issue, ISO 8601 UTC. */
  issuedAt: string;
  /** In the business's timezone: what IssueDate/IssueTime carry. */
  issueDate: string;
  issueTime: string;
  timezone: string;
  /** Invoices only; credit notes carry none (rule ibr-127-ae). */
  dueDate: string | null;
  /** The document's currency (IBT-005). */
  currency: string;
  /** Currency → AED, when the currency is not AED. */
  exchangeRate: string | null;
  /** The tenant's books currency, kept so the validator can say why a rate is unusable. */
  baseCurrency: string;
  seller: PartySnapshot;
  buyer: PartySnapshot;
  lines: LineSnapshot[];
  breakdown: TaxBreakdownSnapshot[];
  totals: {
    /** IBT-106 = IBT-109: sum of line nets. */
    net: string;
    tax: string;
    /** IBT-112 = IBT-115. */
    total: string;
    /** IBT-111 and BTAE-20, in AED. */
    taxAed: string;
    totalAed: string;
  };
  /** The platform's own header figures, kept to prove the XML agrees with the document the customer holds. */
  recorded: { net: string; tax: string; total: string };
  /** UNCL4461 codes, distinct. Empty on a credit note. */
  paymentMeans: string[];
  /** Credit notes only. */
  credit: { reason: CreditNoteReason | null; originalNumber: string | null; originalIssueDate: string | null } | null;
}
