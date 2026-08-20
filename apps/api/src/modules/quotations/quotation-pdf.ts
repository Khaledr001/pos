import PDFDocument from "pdfkit";

export interface QuotationPdfLine {
  productName: string;
  variantName: string;
  productSku: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  taxPercent: string;
  total: string;
}

export interface QuotationPdfInput {
  tenantName: string;
  quotationNumber: string;
  currency: string;
  createdAt: Date;
  validUntil: string | null;
  customer: { name: string; company: string | null; phone: string | null } | null;
  items: QuotationPdfLine[];
  subtotal: string;
  discountAmount: string;
  taxAmount: string;
  total: string;
  notes: string | null;
}

const MONEY_COLS = ["Qty", "Unit price", "Disc %", "Tax %", "Total"] as const;

/**
 * Renders a quotation as a printable PDF: a fixed, coded layout rather than
 * an HTML template — no headless browser in the deploy image for a document
 * this simple. Every figure comes straight from the snapshotted quotation
 * row, never re-resolved, so the PDF a customer is holding never disagrees
 * with what is in the database.
 */
export function renderQuotationPdf(input: QuotationPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).font("Helvetica-Bold").text(input.tenantName);
    doc.fontSize(10).font("Helvetica").fillColor("#555").text("Quotation");
    doc.moveDown(0.5);

    doc
      .fontSize(14)
      .fillColor("#000")
      .font("Helvetica-Bold")
      .text(input.quotationNumber, { continued: false });
    doc
      .fontSize(9)
      .font("Helvetica")
      .fillColor("#555")
      .text(`Issued ${formatDate(input.createdAt)}${input.validUntil ? ` — valid until ${input.validUntil}` : ""}`);
    doc.moveDown();

    if (input.customer) {
      doc.fontSize(10).fillColor("#000").font("Helvetica-Bold").text(input.customer.name);
      if (input.customer.company) doc.font("Helvetica").text(input.customer.company);
      if (input.customer.phone) doc.font("Helvetica").text(input.customer.phone);
      doc.moveDown();
    }

    const startX = doc.page.margins.left;
    const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const nameWidth = tableWidth * 0.36;
    const colWidth = (tableWidth - nameWidth) / MONEY_COLS.length;

    function row(
      cells: string[],
      y: number,
      opts: { bold?: boolean; color?: string } = {},
    ): number {
      doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(9).fillColor(opts.color ?? "#000");
      doc.text(cells[0] ?? "", startX, y, { width: nameWidth });
      cells.slice(1).forEach((cell, i) => {
        doc.text(cell, startX + nameWidth + i * colWidth, y, { width: colWidth, align: "right" });
      });
      return doc.heightOfString(cells[0] ?? "", { width: nameWidth });
    }

    let y = doc.y;
    row(["Item", ...MONEY_COLS], y, { bold: true, color: "#555" });
    y += 16;
    doc
      .moveTo(startX, y - 4)
      .lineTo(startX + tableWidth, y - 4)
      .strokeColor("#ddd")
      .stroke();

    for (const item of input.items) {
      const label = item.variantName && item.variantName !== "Default"
        ? `${item.productName} — ${item.variantName}`
        : item.productName;
      const height = row(
        [
          `${label} (${item.productSku})`,
          item.quantity,
          item.unitPrice,
          `${item.discountPercent}%`,
          `${item.taxPercent}%`,
          item.total,
        ],
        y,
      );
      y += Math.max(height, 12) + 6;
    }

    y += 10;
    doc.moveTo(startX, y).lineTo(startX + tableWidth, y).strokeColor("#ddd").stroke();
    y += 10;

    const totalsX = startX + tableWidth - 200;
    for (const [label, value] of [
      ["Subtotal", input.subtotal],
      ["Discount", input.discountAmount],
      ["Tax", input.taxAmount],
    ] as const) {
      doc.font("Helvetica").fontSize(9).fillColor("#555").text(label, totalsX, y, { width: 100 });
      doc.text(`${input.currency} ${value}`, totalsX + 100, y, { width: 100, align: "right" });
      y += 14;
    }
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#000").text("Total", totalsX, y, { width: 100 });
    doc.text(`${input.currency} ${input.total}`, totalsX + 100, y, { width: 100, align: "right" });

    if (input.notes) {
      doc.moveDown(3);
      doc.font("Helvetica").fontSize(9).fillColor("#555").text(input.notes);
    }

    doc.end();
  });
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
