import { renderTaxDocument, type TaxDocumentInput } from "@devsfleet/pdf-documents";
import type { ReceiptBusiness, ReceiptSale } from "./receipt-template.js";

/**
 * A4 tax invoice for a wholesale customer — same snapshotted sale data as the
 * thermal receipt, laid out on the shared A4 bilingual layout from
 * `@devsfleet/pdf-documents`, the same one the admin panel's own sales
 * invoices and quotations render from. A customer who is handed this at the
 * till and later downloads the same sale from the admin panel should be
 * looking at the same piece of paper, not two differently-designed ones —
 * which is exactly what a second, bespoke layout here would have produced.
 *
 * This file is only the mapping from this terminal's local sale shape onto
 * that layout, the same role `invoice-pdf.ts` plays on the API side.
 *
 * The resulting Buffer is a real, complete PDF — handed to the OS's own PDF
 * viewer (shell.openPath, see hardware/index.ts), whose native Print command
 * is what actually reaches an A4 printer. That is the honest boundary here:
 * this module is verified by its bytes, not by a physical printed page.
 */

export function renderA4Invoice(
  sale: ReceiptSale,
  business: ReceiptBusiness,
  options: {
    duplicate?: boolean;
    customer?: TaxDocumentInput["customer"];
  } = {},
): Promise<Buffer> {
  const paid = sale.payments.reduce((sum, p) => sum + Number(p.amount || "0"), 0);
  const due = Math.max(0, Number(sale.total || "0") - paid);

  const document: TaxDocumentInput = {
    kind: "invoice",
    business: {
      legalName: business.legalName,
      trn: business.trn,
      phone: business.phone,
      email: business.email,
      addressLines: business.addressLines,
    },
    branchName: business.branchName,
    documentNumber: sale.saleNumber ?? `PENDING-${sale.localId.slice(0, 8)}`,
    issuedAt: new Date(sale.occurredAt),
    currency: business.currency,
    taxLabel: business.taxLabel,
    timezone: business.timezone,
    customer: options.customer ?? null,
    lines: sale.lines.map((line) => ({
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
    subtotal: sale.subtotal,
    discountAmount: sale.discountAmount,
    taxAmount: sale.taxAmount,
    total: sale.total,
    payments: sale.payments.map((p) => ({ method: p.method, amount: p.amount })),
    dueAmount: due.toFixed(2),
    // A reprint of a duplicate is still the SAME sale, not a cancelled one —
    // "voided" is reserved for a sale actually voided at the till.
    voided: false,
    notes: options.duplicate ? "DUPLICATE — reprinted copy." : null,
  };

  return renderTaxDocument(document);
}
