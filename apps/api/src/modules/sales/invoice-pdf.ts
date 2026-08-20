import PDFDocument from "pdfkit";

/**
 * A sale rendered as an A4 tax invoice.
 *
 * Deliberately the same approach as `quotations/quotation-pdf.ts`: a coded
 * layout with `pdfkit`, not an HTML template through a headless browser. One
 * PDF-rendering technique in the codebase, and no extra runtime in the deploy
 * image for a document this structured.
 *
 * Every figure comes from the SNAPSHOT on the sale — `sale_items` keeps the
 * product name, SKU, unit price and tax percent as they were at the moment of
 * sale, so re-downloading last year's invoice cannot be rewritten by a
 * renamed product or a changed VAT rate. Nothing here re-resolves a price.
 */

export interface InvoicePdfLine {
  productName: string;
  variantName: string;
  productSku: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  taxPercent: string;
  total: string;
}

export interface InvoicePdfPayment {
  method: string;
  amount: string;
}

export interface InvoicePdfInput {
  /** The business issuing it — from tenant settings, falling back to the tenant name. */
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
  /** "VAT" in the UAE, but a tenant setting — never hardcoded. */
  taxLabel: string;
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

const MONEY_COLS = ["Qty", "Unit price", "Disc %", `Tax %`, "Total"] as const;

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  bank_transfer: "Bank Transfer",
  credit: "On Account",
  loyalty_points: "Loyalty Points",
};

function money(value: string): string {
  const n = Number(value || "0");
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Keeps precision but drops meaningless trailing zeros: "2" rather than the
 * stored "2.0000", while "1.5" metres of cable stays "1.5". This catalogue
 * genuinely sells fractional units, so rounding here would lie.
 */
function quantity(value: string): string {
  const n = Number(value || "0");
  return Number.isFinite(n) ? String(n) : value;
}

function formatDateTime(date: Date): string {
  // ISO-ish and unambiguous. A tax document read in another country should not
  // depend on whether the reader assumes day-first or month-first.
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)} UTC`;
}

export function renderInvoicePdf(input: InvoicePdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // --- issuer ------------------------------------------------------------
    doc.fontSize(18).font("Helvetica-Bold").fillColor("#000").text(input.business.legalName);
    doc.fontSize(9).font("Helvetica").fillColor("#555");
    for (const line of input.business.addressLines) doc.text(line);
    const contact = [input.business.phone, input.business.email].filter(Boolean).join("  ·  ");
    if (contact) doc.text(contact);
    if (input.business.trn) doc.text(`TRN: ${input.business.trn}`);
    doc.moveDown(0.5);

    if (input.voided) {
      doc
        .fontSize(12)
        .font("Helvetica-Bold")
        .fillColor("#b00")
        .text("VOIDED — THIS SALE WAS CANCELLED");
      doc.moveDown(0.25);
    }

    doc.fontSize(16).font("Helvetica-Bold").fillColor("#000").text("TAX INVOICE");
    doc.fontSize(10).font("Helvetica-Bold").text(input.saleNumber);
    doc
      .fontSize(9)
      .font("Helvetica")
      .fillColor("#555")
      .text(formatDateTime(input.occurredAt));
    if (input.branchName) doc.text(input.branchName);
    if (input.cashierName) doc.text(`Served by ${input.cashierName}`);
    doc.moveDown();

    // --- customer ----------------------------------------------------------
    if (input.customer) {
      doc.fontSize(9).font("Helvetica-Bold").fillColor("#555").text("BILL TO");
      doc.fontSize(10).font("Helvetica-Bold").fillColor("#000").text(input.customer.name);
      doc.font("Helvetica").fontSize(9).fillColor("#555");
      if (input.customer.company) doc.text(input.customer.company);
      if (input.customer.address) doc.text(input.customer.address);
      if (input.customer.phone) doc.text(input.customer.phone);
      // The customer's own TRN, which is what makes this reclaimable for them.
      if (input.customer.trn) doc.text(`TRN: ${input.customer.trn}`);
      doc.moveDown();
    }

    // --- lines -------------------------------------------------------------
    const startX = doc.page.margins.left;
    const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const nameWidth = tableWidth * 0.36;
    const colWidth = (tableWidth - nameWidth) / MONEY_COLS.length;

    function row(cells: string[], y: number, opts: { bold?: boolean; color?: string } = {}): number {
      doc
        .font(opts.bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(9)
        .fillColor(opts.color ?? "#000");
      doc.text(cells[0] ?? "", startX, y, { width: nameWidth });
      cells.slice(1).forEach((cell, i) => {
        doc.text(cell, startX + nameWidth + i * colWidth, y, { width: colWidth, align: "right" });
      });
      return doc.heightOfString(cells[0] ?? "", { width: nameWidth });
    }

    let y = doc.y;
    row(["Item", ...MONEY_COLS], y, { bold: true, color: "#555" });
    y += 16;
    doc.moveTo(startX, y - 4).lineTo(startX + tableWidth, y - 4).strokeColor("#ddd").stroke();

    for (const line of input.lines) {
      const label =
        line.variantName && line.variantName !== "Default"
          ? `${line.productName} — ${line.variantName}`
          : line.productName;

      const height = row(
        [
          `${label} (${line.productSku})`,
          quantity(line.quantity),
          money(line.unitPrice),
          `${Number(line.discountPercent || "0")}%`,
          `${Number(line.taxPercent || "0")}%`,
          money(line.total),
        ],
        y,
      );
      y += Math.max(height, 12) + 6;

      // A long invoice runs onto a second page rather than off the bottom of
      // the first — a truncated tax document is not a tax document.
      if (y > doc.page.height - doc.page.margins.bottom - 140) {
        doc.addPage();
        y = doc.page.margins.top;
      }
    }

    y += 10;
    doc.moveTo(startX, y).lineTo(startX + tableWidth, y).strokeColor("#ddd").stroke();
    y += 10;

    // --- totals ------------------------------------------------------------
    const totalsX = startX + tableWidth - 220;
    const totalRow = (label: string, value: string, opts: { bold?: boolean } = {}) => {
      doc
        .font(opts.bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(opts.bold ? 11 : 9)
        .fillColor(opts.bold ? "#000" : "#555")
        .text(label, totalsX, y, { width: 110 });
      doc.text(`${input.currency} ${money(value)}`, totalsX + 110, y, {
        width: 110,
        align: "right",
      });
      y += opts.bold ? 18 : 14;
    };

    totalRow("Subtotal", input.subtotal);
    if (Number(input.discountAmount || "0") > 0) totalRow("Discount", `-${input.discountAmount}`);
    totalRow(input.taxLabel, input.taxAmount);
    totalRow("Total", input.total, { bold: true });

    y += 6;
    for (const payment of input.payments) {
      totalRow(METHOD_LABEL[payment.method] ?? payment.method, payment.amount);
    }

    // Only shown when it is actually outstanding — printing "Balance due 0.00"
    // on a settled invoice invites a second payment.
    if (Number(input.dueAmount || "0") > 0) {
      totalRow("Balance due", input.dueAmount, { bold: true });
    }

    if (input.notes) {
      doc.moveDown(3);
      doc.font("Helvetica").fontSize(9).fillColor("#555").text(input.notes, startX, doc.y, {
        width: tableWidth,
      });
    }

    doc.end();
  });
}
