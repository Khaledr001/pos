import { renderTaxDocument, type TaxDocumentInput } from "@devsfleet/pdf-documents";

/**
 * A quotation as an A4 bilingual document.
 *
 * The layout lives in `common/pdf/tax-document.ts`, shared with the sales
 * invoice: a customer who accepts a quote and then receives an invoice for the
 * same goods should get the same piece of paper, with the title and the
 * validity line as the only differences. This file is the mapping only.
 *
 * Every figure comes from the snapshotted quotation row, never re-resolved, so
 * the PDF a customer is holding never disagrees with what is in the database.
 */

export interface QuotationPdfLine {
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

export interface QuotationPdfInput {
  business: {
    legalName: string;
    trn: string | null;
    phone: string | null;
    email: string | null;
    addressLines: string[];
  };
  branchName: string | null;
  quotationNumber: string;
  currency: string;
  taxLabel: string;
  /** The business's own timezone, so the printed date is the shop's, not the server's. */
  timezone: string;
  createdAt: Date;
  validUntil: string | null;
  customer: {
    name: string;
    company: string | null;
    phone: string | null;
    trn: string | null;
    address: string | null;
  } | null;
  items: QuotationPdfLine[];
  subtotal: string;
  discountAmount: string;
  taxAmount: string;
  total: string;
  notes: string | null;
}

export function renderQuotationPdf(input: QuotationPdfInput): Promise<Buffer> {
  const document: TaxDocumentInput = {
    kind: "quotation",
    business: input.business,
    branchName: input.branchName,
    documentNumber: input.quotationNumber,
    issuedAt: input.createdAt,
    validUntil: input.validUntil,
    currency: input.currency,
    taxLabel: input.taxLabel,
    timezone: input.timezone,
    customer: input.customer,
    lines: input.items.map((line) => ({
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
    notes: input.notes,
  };

  return renderTaxDocument(document);
}
