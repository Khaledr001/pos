import { renderTaxDocument, type TaxDocumentInput } from "@devsfleet/pdf-documents";
import {
  CREDIT_NOTE_REASON_LABELS,
  EINVOICE_STATUS_LABELS,
  TAX_EXEMPTION_LABELS,
  type CreditNoteReason,
  type EinvoiceStatus,
  type TaxCategory,
  type TaxExemptionCode,
} from "@devsfleet/shared-types";

/**
 * A sale as an A4 bilingual tax invoice.
 *
 * The layout itself lives in `common/pdf/tax-document.ts`, shared with the
 * quotation renderer — a customer who gets a quote and then an invoice for
 * the same goods should not receive two different-looking documents. This
 * file is only the mapping from a sale's shape onto that layout.
 *
 * Every figure comes from the SNAPSHOT on the sale: `sale_items` keeps the
 * product name, SKU, unit price and tax percent as they were at the moment of
 * sale, so re-downloading last year's invoice cannot be rewritten by a
 * renamed product or a changed VAT rate.
 */

export interface InvoicePdfLine {
  productName: string;
  variantName: string;
  productSku: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  taxPercent: string;
  /** Line value before tax, after any line discount. */
  lineSubtotal: string;
  taxAmount: string;
  total: string;
  /** Snapshotted on the line. Absent on a line written before categories existed = standard-rated. */
  taxCategory?: TaxCategory;
  taxExemptionCode?: TaxExemptionCode | null;
}

export interface InvoicePdfInput {
  business: {
    legalName: string;
    trn: string | null;
    phone: string | null;
    email: string | null;
    addressLines: string[];
  };
  branchName: string | null;
  saleNumber: string;
  occurredAt: Date;
  currency: string;
  taxLabel: string;
  /** The business's own timezone, so the printed time is the shop's, not the server's. */
  timezone: string;
  customer: {
    name: string;
    company: string | null;
    phone: string | null;
    trn: string | null;
    address: string | null;
  } | null;
  cashierName: string | null;
  lines: InvoicePdfLine[];
  subtotal: string;
  discountAmount: string;
  taxAmount: string;
  total: string;
  paidAmount: string;
  dueAmount: string;
  /** A voided sale still has a downloadable document — stamped, never hidden. */
  voided: boolean;
  notes: string | null;
  /**
   * `credit_note` for a return: its own title, number and reference to the
   * invoice it corrects. Absent = an ordinary invoice.
   */
  documentType?: "invoice" | "credit_note";
  creditNote?: {
    againstNumber: string;
    againstDate: Date | null;
    reason: CreditNoteReason | null;
    note: string | null;
  };
  /** The document's own exchange rate to the books' currency; with a currency that differs from `baseCurrency` it makes the VAT-in-AED line appear. */
  exchangeRate?: string;
  baseCurrency?: string;
  /** The e-invoice this document was reported as, when there is one. */
  einvoice?: { uuid: string; status: EinvoiceStatus } | null;
}

/** The sale (or credit note) as the shared tax-document layout takes it. Pure, so the mapping is testable. */
export function toTaxDocument(input: InvoicePdfInput): TaxDocumentInput {
  const isCreditNote = input.documentType === "credit_note";
  return {
    kind: isCreditNote ? "credit_note" : "invoice",
    business: input.business,
    branchName: input.branchName,
    documentNumber: input.saleNumber,
    issuedAt: input.occurredAt,
    currency: input.currency,
    taxLabel: input.taxLabel,
    timezone: input.timezone,
    customer: input.customer,
    lines: input.lines.map((line) => ({
      productName: line.productName,
      variantName: line.variantName,
      productSku: line.productSku,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      beforeTax: line.lineSubtotal,
      taxAmount: line.taxAmount,
      taxPercent: line.taxPercent,
      total: line.total,
      ...(line.taxCategory ? { taxCategory: line.taxCategory } : {}),
      ...(line.taxCategory === "E" && line.taxExemptionCode ? { taxCategoryNote: TAX_EXEMPTION_LABELS[line.taxExemptionCode] } : {}),
    })),
    subtotal: input.subtotal,
    discountAmount: input.discountAmount,
    taxAmount: input.taxAmount,
    total: input.total,
    dueAmount: input.dueAmount,
    voided: input.voided,
    notes: input.notes,
    ...(isCreditNote && input.creditNote
      ? {
          creditNote: {
            againstNumber: input.creditNote.againstNumber,
            againstDate: input.creditNote.againstDate,
            reasonLabel: input.creditNote.reason ? CREDIT_NOTE_REASON_LABELS[input.creditNote.reason] : null,
            // A legacy note that merely repeats the reason adds nothing.
            note: input.creditNote.note,
          },
        }
      : {}),
    ...(input.baseCurrency && input.exchangeRate && input.baseCurrency !== input.currency
      ? { foreign: { baseCurrency: input.baseCurrency, exchangeRate: input.exchangeRate } }
      : {}),
    ...(input.einvoice ? { einvoice: { uuid: input.einvoice.uuid, statusLabel: EINVOICE_STATUS_LABELS[input.einvoice.status] } } : {}),
  };
}

export function renderInvoicePdf(input: InvoicePdfInput): Promise<Buffer> {
  return renderTaxDocument(toTaxDocument(input));
}
