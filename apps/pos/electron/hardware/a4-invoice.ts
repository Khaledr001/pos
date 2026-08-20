import PDFDocument from "pdfkit";
import type { ReceiptBusiness, ReceiptSale } from "./receipt-template.js";

/**
 * A4 tax invoice for a wholesale customer — same snapshotted sale data as the
 * thermal receipt, laid out for a full page instead of an 80mm strip. Built
 * with `pdfkit`, the same dependency-light, native-binding-free library the
 * API already uses for quotation PDFs (see quotation-pdf.ts) — reusing it
 * here means one PDF-rendering approach in the codebase, not two, and this is
 * the same reasoning that ruled out a headless-browser/`printToPDF` route:
 * no extra runtime, nothing that can fail to launch on a till.
 *
 * The resulting Buffer is a real, complete PDF — handed to the OS's own PDF
 * viewer (shell.openPath, see hardware/index.ts), whose native Print command
 * is what actually reaches an A4 printer. That is the honest boundary here:
 * this module is verified by its bytes, not by a physical printed page.
 */

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  bank_transfer: "Bank Transfer",
  credit: "On Account",
  loyalty_points: "Loyalty Points",
};

const TABLE_COLS = ["Qty", "Unit price", "Disc %", "Tax %", "Total"] as const;

function money(value: string): string {
  const n = Number(value || "0");
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}

export function renderA4Invoice(
  sale: ReceiptSale,
  business: ReceiptBusiness,
  options: { duplicate?: boolean; customerName?: string | null } = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).font("Helvetica-Bold").text(business.legalName || "Tax Invoice");
    doc.fontSize(9).font("Helvetica").fillColor("#555");
    for (const line of business.addressLines) doc.text(line);
    if (business.phone) doc.text(`Tel: ${business.phone}`);
    if (business.trn) doc.text(`TRN: ${business.trn}`);
    doc.moveDown(0.5);

    if (options.duplicate) {
      doc.fontSize(10).font("Helvetica-Bold").fillColor("#b00").text("DUPLICATE");
    }
    doc.fontSize(14).fillColor("#000").font("Helvetica-Bold").text("TAX INVOICE");
    doc
      .fontSize(9)
      .font("Helvetica")
      .fillColor("#555")
      .text(`${sale.saleNumber ?? `PENDING-${sale.localId.slice(0, 8)}`} — ${formatDate(sale.occurredAt)}`);
    doc.moveDown();

    if (options.customerName) {
      doc.fontSize(10).fillColor("#000").font("Helvetica-Bold").text(options.customerName);
      doc.moveDown();
    }

    const startX = doc.page.margins.left;
    const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const nameWidth = tableWidth * 0.36;
    const colWidth = (tableWidth - nameWidth) / TABLE_COLS.length;

    function row(cells: string[], y: number, opts: { bold?: boolean; color?: string } = {}): number {
      doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(9).fillColor(opts.color ?? "#000");
      doc.text(cells[0] ?? "", startX, y, { width: nameWidth });
      cells.slice(1).forEach((cell, i) => {
        doc.text(cell, startX + nameWidth + i * colWidth, y, { width: colWidth, align: "right" });
      });
      return doc.heightOfString(cells[0] ?? "", { width: nameWidth });
    }

    let y = doc.y;
    row(["Item", ...TABLE_COLS], y, { bold: true, color: "#555" });
    y += 16;
    doc.moveTo(startX, y - 4).lineTo(startX + tableWidth, y - 4).strokeColor("#ddd").stroke();

    for (const line of sale.lines) {
      const height = row(
        [
          `${line.productName} (${line.productSku})`,
          line.quantity,
          money(line.unitPrice),
          `${line.discountPercent}%`,
          `${line.taxPercent}%`,
          money(line.total),
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
      ["Subtotal", sale.subtotal],
      ...(Number(sale.discountAmount) > 0 ? [["Discount", `-${sale.discountAmount}`]] : []),
      [business.taxLabel, sale.taxAmount],
    ] as Array<[string, string]>) {
      doc.font("Helvetica").fontSize(9).fillColor("#555").text(label, totalsX, y, { width: 100 });
      doc.text(`${business.currency} ${money(value)}`, totalsX + 100, y, { width: 100, align: "right" });
      y += 14;
    }
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#000").text("Total", totalsX, y, { width: 100 });
    doc.text(`${business.currency} ${money(sale.total)}`, totalsX + 100, y, { width: 100, align: "right" });
    y += 24;

    const tendered = sale.payments.reduce((sum, p) => sum + Number(p.amount || "0"), 0);
    const change = Math.max(0, tendered - Number(sale.total || "0"));

    for (const payment of sale.payments) {
      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor("#555")
        .text(METHOD_LABEL[payment.method] ?? payment.method, totalsX, y, { width: 100 });
      doc.text(`${business.currency} ${money(payment.amount)}`, totalsX + 100, y, { width: 100, align: "right" });
      y += 14;
    }
    if (change > 0) {
      doc.font("Helvetica").fontSize(9).fillColor("#555").text("Change", totalsX, y, { width: 100 });
      doc.text(`${business.currency} ${money(String(change))}`, totalsX + 100, y, { width: 100, align: "right" });
    }

    doc.end();
  });
}
