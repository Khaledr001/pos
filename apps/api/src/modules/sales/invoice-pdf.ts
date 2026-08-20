import { renderTaxDocument, type TaxDocumentInput } from "../../common/pdf/tax-document.js";

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
}

export interface InvoicePdfPayment {
  method: string;
  amount: string;
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
  payments: InvoicePdfPayment[];
  /** A voided sale still has a downloadable document — stamped, never hidden. */
  voided: boolean;
  notes: string | null;
}

export function renderInvoicePdf(input: InvoicePdfInput): Promise<Buffer> {
  const document: TaxDocumentInput = {
    kind: "invoice",
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
    })),
    subtotal: input.subtotal,
    discountAmount: input.discountAmount,
    taxAmount: input.taxAmount,
    total: input.total,
    payments: input.payments,
    dueAmount: input.dueAmount,
    voided: input.voided,
    notes: input.notes,
  };

  return renderTaxDocument(document);
}
