import PDFDocument from "pdfkit";
import {
  ACCENT,
  ACCENT_SOFT,
  FONT_FILES,
  INK,
  LINE,
  MARGIN,
  MUTED,
  formatDate,
  resolveFont,
  rtl,
} from "./tax-document.js";

/**
 * A customer's statement of account, A4, in the tax invoice's visual
 * language — same letter mark, accent and ruled table — so a trade customer
 * reconciling a statement against the invoices in their file sees one
 * business, not two.
 *
 * Every amount arrives already formatted. The renderer does no arithmetic:
 * the running balance, the opening and closing figures are worked out by the
 * API from the ledger in Money, and a layout that re-adds them in floats is
 * how a statement ends up a fils off its own total.
 */

export interface StatementEntry {
  date: Date;
  documentNumber: string | null;
  /** "Invoice", "Return", "Payment — cash" … */
  description: string;
  /** Formatted, or "" when the row moves nothing that way. */
  debit: string;
  credit: string;
  balance: string;
}

export interface StatementDocumentInput {
  business: {
    legalName: string;
    trn: string | null;
    phone: string | null;
    email: string | null;
    addressLines: string[];
  };
  currency: string;
  timezone: string;
  issuedAt: Date;
  /** Already worded: "1 Oct 2026 – 31 Oct 2026", "All activity to 22 Oct 2026". */
  periodLabel: string;
  customer: {
    name: string;
    company: string | null;
    phone: string | null;
    trn: string | null;
  };
  openingBalance: string;
  totalDebit: string;
  totalCredit: string;
  closingBalance: string;
  /** Null when the customer has no credit facility. */
  creditLimit: string | null;
  availableCredit: string | null;
  entries: StatementEntry[];
}

const L = {
  title: ["Statement of Account", "كشف حساب"],
} as const;

/** Date, document, description, debit, credit, balance — description takes the slack. */
const COLUMN_SHARE = [0.13, 0.19, 0.26, 0.14, 0.14, 0.14] as const;

export function renderStatementDocument(input: StatementDocumentInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const arabicPath = resolveFont(FONT_FILES.arabic);
    if (arabicPath) doc.registerFont("ar", arabicPath);

    const contentW = doc.page.width - MARGIN * 2;
    const right = MARGIN + contentW;
    const bottom = doc.page.height - MARGIN - 24;
    const widths = COLUMN_SHARE.map((share) => contentW * share);
    const xs = widths.map((_, i) => MARGIN + widths.slice(0, i).reduce((a, b) => a + b, 0));

    // ── Letterhead ────────────────────────────────────────────────────────
    let y = MARGIN;
    const initial = (input.business.legalName.trim()[0] ?? "?").toUpperCase();
    doc.roundedRect(MARGIN, y, 38, 38, 8).fill(ACCENT);
    doc.font("Helvetica-Bold").fontSize(18).fillColor("#FFFFFF").text(initial, MARGIN, y + 11.5, {
      width: 38,
      align: "center",
    });

    const leftX = MARGIN + 48;
    const leftW = contentW * 0.5;
    doc.font("Helvetica-Bold").fontSize(14).fillColor(INK).text(input.business.legalName, leftX, y + 1, {
      width: leftW,
      lineBreak: false,
    });
    let leftY = y + 19;
    const quiet = (text: string) => {
      doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(text, leftX, leftY, { width: leftW, lineBreak: false });
      leftY += 11;
    };
    if (input.business.trn) quiet(`TRN ${input.business.trn}`);
    const contact = [input.business.phone, input.business.email].filter(Boolean).join("  ·  ");
    if (contact) quiet(contact);
    if (input.business.addressLines.length > 0) quiet(input.business.addressLines.join(", "));

    doc.font("Helvetica-Bold").fontSize(15).fillColor(ACCENT).text(L.title[0].toUpperCase(), MARGIN, y, {
      width: contentW,
      align: "right",
      characterSpacing: 0.6,
    });
    if (arabicPath) {
      doc.font("ar").fontSize(9).fillColor(MUTED).text(rtl(L.title[1]), MARGIN, y + 19, {
        width: contentW,
        align: "right",
        lineBreak: false,
      });
    }
    const meta: Array<[string, string]> = [
      ["Period", input.periodLabel],
      ["Issued", formatDate(input.issuedAt, input.timezone)],
      ["Currency", input.currency],
    ];
    let metaY = y + 36;
    for (const [label, value] of meta) {
      doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(label, right - 210, metaY, { width: 60 });
      doc.font("Helvetica-Bold").fontSize(8).fillColor(INK).text(value, right - 150, metaY, { width: 150, align: "right" });
      metaY += 12;
    }

    y = Math.max(leftY, metaY) + 14;

    // ── Customer and the four figures ─────────────────────────────────────
    doc.font("Helvetica").fontSize(7).fillColor(MUTED).text("ACCOUNT OF", MARGIN, y, { characterSpacing: 0.6 });
    y += 10;
    doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text(input.customer.name, MARGIN, y, {
      width: contentW * 0.6,
    });
    y = doc.y + 2;
    const customerLines = [
      input.customer.company,
      input.customer.phone,
      input.customer.trn ? `TRN ${input.customer.trn}` : null,
    ].filter((v): v is string => Boolean(v));
    for (const line of customerLines) {
      doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(line, MARGIN, y, { width: contentW * 0.6 });
      y = doc.y + 1;
    }
    y += 10;

    const figures: Array<[string, string]> = [
      ["Opening balance", input.openingBalance],
      ["Debits", input.totalDebit],
      ["Credits", input.totalCredit],
      ["Closing balance", input.closingBalance],
    ];
    const boxW = contentW / figures.length;
    doc.roundedRect(MARGIN, y, contentW, 40, 6).fill(ACCENT_SOFT);
    figures.forEach(([label, value], i) => {
      const x = MARGIN + boxW * i + 10;
      doc.font("Helvetica").fontSize(7).fillColor(MUTED).text(label.toUpperCase(), x, y + 8, {
        width: boxW - 20,
        characterSpacing: 0.4,
      });
      doc
        .font("Helvetica-Bold")
        .fontSize(i === figures.length - 1 ? 11 : 10)
        .fillColor(i === figures.length - 1 ? ACCENT : INK)
        .text(value, x, y + 20, { width: boxW - 20 });
    });
    y += 54;

    // ── Ledger ────────────────────────────────────────────────────────────
    const headers = ["DATE", "DOCUMENT", "DESCRIPTION", "DEBIT", "CREDIT", "BALANCE"];
    const numeric = (i: number) => i >= 3;

    const drawHeader = () => {
      doc.rect(MARGIN, y, contentW, 18).fill(INK);
      headers.forEach((h, i) => {
        doc.font("Helvetica-Bold").fontSize(7).fillColor("#FFFFFF").text(h, xs[i]! + 5, y + 6, {
          width: widths[i]! - 10,
          align: numeric(i) ? "right" : "left",
          characterSpacing: 0.4,
          lineBreak: false,
        });
      });
      y += 18;
    };

    const drawRow = (cells: string[], opts: { bold?: boolean; shade?: boolean } = {}) => {
      doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(8);
      const height =
        Math.max(...cells.map((c, i) => doc.heightOfString(c || " ", { width: widths[i]! - 10 }))) + 10;
      if (y + height > bottom) {
        doc.addPage();
        y = MARGIN;
        drawHeader();
        doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(8);
      }
      if (opts.shade) doc.rect(MARGIN, y, contentW, height).fill(ACCENT_SOFT);
      cells.forEach((cell, i) => {
        doc.fillColor(INK).text(cell, xs[i]! + 5, y + 5, { width: widths[i]! - 10, align: numeric(i) ? "right" : "left" });
      });
      y += height;
      doc.moveTo(MARGIN, y).lineTo(right, y).lineWidth(0.5).strokeColor(LINE).stroke();
    };

    drawHeader();
    drawRow(["", "", "Balance brought forward", "", "", input.openingBalance], { shade: true });
    if (input.entries.length === 0) {
      drawRow(["", "", "No activity in this period", "", "", ""]);
    }
    for (const e of input.entries) {
      drawRow([formatDate(e.date, input.timezone), e.documentNumber ?? "—", e.description, e.debit, e.credit, e.balance]);
    }
    drawRow(["", "", "Closing balance", input.totalDebit, input.totalCredit, input.closingBalance], {
      bold: true,
      shade: true,
    });

    // ── Credit ────────────────────────────────────────────────────────────
    if (input.creditLimit) {
      y += 12;
      if (y + 30 > bottom) {
        doc.addPage();
        y = MARGIN;
      }
      doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(`Credit limit  ${input.creditLimit}`, MARGIN, y);
      doc.text(`Available credit  ${input.availableCredit ?? "—"}`, MARGIN, y + 12);
    }

    // ── Footer on every page ──────────────────────────────────────────────
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // Inside the bottom margin pdfkit would start a new page for the text;
      // the margin is lifted for the footer and nothing else.
      doc.page.margins.bottom = 0;
      const footY = doc.page.height - MARGIN - 10;
      doc
        .font("Helvetica")
        .fontSize(7)
        .fillColor(MUTED)
        .text(
          "Please contact us if any entry does not match your records.",
          MARGIN,
          footY,
          { width: contentW * 0.7, lineBreak: false },
        );
      doc.text(`Page ${i - range.start + 1} of ${range.count}`, MARGIN, footY, {
        width: contentW,
        align: "right",
        lineBreak: false,
      });
    }

    doc.end();
  });
}
