import { existsSync } from "node:fs";
import { join } from "node:path";
import PDFDocument from "pdfkit";

/**
 * The A4 bilingual tax document — one layout, used for both a sale's tax
 * invoice and a quotation.
 *
 * Shared deliberately rather than duplicated: they are the same piece of
 * paper with a different title, and a customer who receives a quote and then
 * an invoice for the same goods should not get two different-looking
 * documents from one business.
 *
 * ARABIC, and why it is handled the way it is below.
 *
 * pdfkit shapes Arabic letters correctly (fontkit applies the contextual
 * forms), but it implements no bidi algorithm — glyphs are laid down in
 * logical order, left to right. Two consequences, both verified by rendering
 * and looking at the result rather than by assumption:
 *
 *   1. A multi-word phrase comes out with its WORDS reversed. `rtl()` below
 *      pre-reverses them so the reader, going right to left, gets them back
 *      in the right order.
 *   2. A plain space between two Arabic words is swallowed by the shaper —
 *      "فاتورة ضريبية" renders as one run. A NO-BREAK SPACE survives, so
 *      that is what `rtl()` joins with.
 *
 * Both only hold for the fixed, Arabic-only labels in this file. Nothing
 * user-supplied is ever passed through `rtl()`: a product name or a customer
 * address is rendered as-is in Helvetica, because guessing at the direction
 * of arbitrary text is how you get a mangled invoice.
 */

// ── Arabic support ──────────────────────────────────────────────────────────

const FONT_FILES = {
  arabic: "NotoSansArabic-Regular.ttf",
  arabicBold: "NotoSansArabic-SemiBold.ttf",
} as const;

/**
 * `assets/fonts` is a sibling of this package's own root, not of `dist/` —
 * true whether this module is running compiled (`dist/tax-document.js`) or
 * straight from source under vitest (`src/tax-document.ts`), since both sit
 * one directory below the package root. That symmetry is also why the two
 * consuming apps never need to copy these files anywhere themselves: `pnpm
 * deploy` (the API's Docker image) and electron-builder (the POS installer)
 * each carry this package's own `assets/` folder along with it, listed
 * alongside `dist` in this package's `package.json` "files".
 *
 * Returns null if the files are somehow absent, and the caller then omits
 * the Arabic rather than printing tofu.
 */
function resolveFont(file: string): string | null {
  const candidates = [
    join(__dirname, "../assets/fonts", file),
    join(process.cwd(), "assets/fonts", file),
  ];
  return candidates.find((path) => existsSync(path)) ?? null;
}

/** Logical Arabic → the order and spacing pdfkit will actually render correctly. */
function rtl(text: string): string {
  return text.trim().split(/\s+/).reverse().join(" ");
}

/** Bilingual label pairs, kept together so the two halves cannot drift apart. */
const L = {
  taxInvoice: ["Tax Invoice", "فاتورة ضريبية"],
  quotation: ["Quotation", "عرض سعر"],
  no: ["NO", "الرقم"],
  description: ["DESCRIPTION", "التفاصيل"],
  qty: ["QTY", "الكمية"],
  unitPrice: ["UNIT PRICE", "سعر الوحدة"],
  beforeTax: ["BEFORE TAX", "قبل الضريبة"],
  total: ["TOTAL AMOUNT", "المبلغ الإجمالي"],
  sumTotal: ["Total", "المجموع"],
  billedTo: ["BILLED TO", "السادة"],
  receiverSign: ["Receiver's Sign.", "توقيع المستلم"],
} as const;

// ── Palette & metrics ───────────────────────────────────────────────────────

const ACCENT = "#4F46E5";
const ACCENT_SOFT = "#EEF0FB";
const ACCENT_BAND = "#EDE9FE";
const INK = "#111827";
const MUTED = "#6B7280";
const LINE = "#E5E7EB";

const MARGIN = 36;

/** Ruled but empty rows left under the last item, page space permitting. */
const BLANK_ROWS = 3;

/**
 * The item description is set at Helvetica regular — a true 400.
 *
 * It was bold, then a faux 600, then a faux 500, each produced by stroking
 * the regular face in its own colour to thicken the stems. This is the floor:
 * pdfkit's built-in family is Helvetica regular and bold with nothing below
 * regular, and the only embedded faces this package ships are the two Arabic
 * ones. Anything lighter would mean bundling a real Light face.
 *
 * The name no longer needs weight to stand out anyway — it is the only
 * left-aligned, non-numeric cell on the row, which separates it from the
 * figures on its own.
 */
const DESCRIPTION_SIZE = 8.5;

/**
 * DESCRIPTION takes 46% — the item name is the only column whose content is
 * unbounded, and wrapping it to three lines to keep a wide TAX column that
 * never holds more than six characters is the wrong trade. The rest share
 * what is left.
 */
export const COLS = {
  no: 0.04,
  description: 0.50,
  qty: 0.05,
  unitPrice: 0.10,
  beforeTax: 0.11,
  tax: 0.09,
  total: 0.11,
} as const;

export interface TaxDocumentLine {
  productName: string;
  variantName: string;
  productSku: string;
  quantity: string;
  unitPrice: string;
  /** Line value before tax, after any line discount. */
  beforeTax: string;
  taxAmount: string;
  taxPercent: string;
  total: string;
}

export interface TaxDocumentInput {
  kind: "invoice" | "quotation";
  business: {
    legalName: string;
    trn: string | null;
    phone: string | null;
    email: string | null;
    addressLines: string[];
  };
  branchName: string | null;
  documentNumber: string;
  issuedAt: Date;
  /** Quotations only — the date the quoted prices stop being held. */
  validUntil?: string | null;
  currency: string;
  /** "VAT" in the UAE, but a tenant setting. */
  taxLabel: string;
  /**
   * The business's own timezone (`settings.locale.timezone`), not the
   * server's. A tax invoice records when the sale happened in the shop; a
   * container running UTC would print 2:04 AM on a sale rung up at 10:04 PM
   * the evening before — wrong date as well as wrong time.
   */
  timezone: string;
  customer: {
    name: string;
    company: string | null;
    phone: string | null;
    trn: string | null;
    address: string | null;
  } | null;
  lines: TaxDocumentLine[];
  subtotal: string;
  discountAmount: string;
  taxAmount: string;
  total: string;
  /** Invoices only — what is still owed after everything taken so far. */
  dueAmount?: string;
  voided?: boolean;
  notes?: string | null;
}

function money(value: string): string {
  const n = Number(value || "0");
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Keeps real fractions ("1.5" metres) but drops the stored "12.0000" zeros. */
function qty(value: string): string {
  const n = Number(value || "0");
  return Number.isFinite(n) ? String(n) : value;
}

/** An unknown timezone must not throw mid-render; the UTC fallback is visible, not silent. */
function safeZone(timezone: string): string | undefined {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return timezone;
  } catch {
    return undefined;
  }
}

function formatDate(date: Date, timezone: string): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: safeZone(timezone),
  });
}

function formatTime(date: Date, timezone: string): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: safeZone(timezone),
  });
}

export function renderTaxDocument(input: TaxDocumentInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Registered only if the files are actually there; `ar()` is a no-op
    // otherwise, so a container missing them loses the Arabic and nothing else.
    const arabicPath = resolveFont(FONT_FILES.arabic);
    const arabicBoldPath = resolveFont(FONT_FILES.arabicBold);
    if (arabicPath) doc.registerFont("ar", arabicPath);
    if (arabicBoldPath) doc.registerFont("ar-bold", arabicBoldPath);
    const hasArabic = Boolean(arabicPath);

    const contentW = doc.page.width - MARGIN * 2;
    const right = MARGIN + contentW;

    /** An Arabic label, or nothing at all when the font is unavailable. */
    const ar = (
      text: string,
      x: number,
      y: number,
      opts: { size?: number; color?: string; width?: number; align?: "left" | "right" | "center"; bold?: boolean } = {},
    ) => {
      if (!hasArabic) return;
      doc
        .font(opts.bold ? "ar-bold" : "ar")
        .fontSize(opts.size ?? 6.5)
        .fillColor(opts.color ?? MUTED)
        .text(rtl(text), x, y, {
          ...(opts.width !== undefined ? { width: opts.width } : {}),
          ...(opts.align ? { align: opts.align } : {}),
          lineBreak: false,
        });
    };

    /**
     * ── Header ─────────────────────────────────────────────────────────
     *
     * Two columns that each read as one block, rather than four lines of
     * text drifting against three.
     *
     * LEFT is the business: a filled accent mark, the trading name, then its
     * registration and contact details in a quiet stack beneath.
     * RIGHT is the document: the title, then a tinted card holding the
     * number, date and time — the three things anyone filing or querying the
     * invoice actually looks for, so they are grouped and boxed instead of
     * floating as loose label/value pairs.
     *
     * The card is measured from its rows, not given a fixed height: a
     * quotation carries "Valid until" instead of a time, and a fixed box
     * either clipped it or left a gap.
     */
    let y = MARGIN;

    // Letter mark. A real logo would be an image; deriving it from the name
    // means every tenant has one without configuring anything. Filled rather
    // than tinted — at 38pt it is the only thing anchoring the top-left.
    const initial = (input.business.legalName.trim()[0] ?? "?").toUpperCase();
    doc.roundedRect(MARGIN, y, 38, 38, 8).fill(ACCENT);
    doc
      .font("Helvetica-Bold")
      .fontSize(18)
      .fillColor("#FFFFFF")
      .text(initial, MARGIN, y + 11.5, { width: 38, align: "center" });

    const leftX = MARGIN + 48;
    const leftW = contentW * 0.52;
    doc
      .font("Helvetica-Bold")
      .fontSize(14)
      .fillColor(INK)
      .text(input.business.legalName, leftX, y + 1, { width: leftW, lineBreak: false });

    let leftY = y + 19;
    if (input.business.trn) {
      doc.font("Helvetica").fontSize(8).fillColor(MUTED).text("TRN ", leftX, leftY, { continued: true });
      doc.font("Helvetica-Bold").fillColor(INK).text(input.business.trn);
      leftY += 11.5;
    }

    const contact = [input.business.phone, input.business.email].filter(Boolean).join("  ·  ");
    if (contact) {
      doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(contact, leftX, leftY, {
        width: leftW,
        lineBreak: false,
      });
      leftY += 11;
    }
    if (input.business.addressLines.length > 0) {
      doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(input.business.addressLines.join(", "), leftX, leftY, {
        width: leftW,
        lineBreak: false,
      });
      leftY += 11;
    }

    // Right: the document title, then its meta card.
    const titleEn = input.kind === "invoice" ? L.taxInvoice[0] : L.quotation[0];
    const titleAr = input.kind === "invoice" ? L.taxInvoice[1] : L.quotation[1];
    doc.font("Helvetica-Bold").fontSize(16).fillColor(ACCENT).text(titleEn.toUpperCase(), MARGIN, y, {
      width: contentW,
      align: "right",
      characterSpacing: 0.8,
    });
    const titleW = doc.widthOfString(titleEn.toUpperCase()) + titleEn.length * 0.8;
    ar(titleAr, MARGIN, y + 3.5, { size: 9, width: contentW - titleW - 8, align: "right" });

    const meta: Array<[string, string]> = [
      [input.kind === "invoice" ? "Invoice No" : "Quote No", input.documentNumber],
      ["Date", formatDate(input.issuedAt, input.timezone)],
    ];
    if (input.kind === "invoice") meta.push(["Time", formatTime(input.issuedAt, input.timezone)]);
    else if (input.validUntil) meta.push(["Valid until", input.validUntil]);

    const CARD_W = 208;
    const CARD_PAD = 8;
    const META_ROW_H = 13;
    const cardX = right - CARD_W;
    const cardY = y + 26;
    const cardH = CARD_PAD * 2 + meta.length * META_ROW_H - 2;

    doc.roundedRect(cardX, cardY, CARD_W, cardH, 6).fill(ACCENT_SOFT);

    let metaY = cardY + CARD_PAD;
    for (const [label, value] of meta) {
      doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(label, cardX + CARD_PAD, metaY, {
        width: 74,
      });
      doc
        .font("Helvetica-Bold")
        .fontSize(9)
        .fillColor(INK)
        .text(value, cardX + CARD_PAD + 74, metaY - 0.5, {
          width: CARD_W - CARD_PAD * 2 - 74,
          align: "right",
          lineBreak: false,
        });
      metaY += META_ROW_H;
    }

    y = Math.max(leftY, cardY + cardH) + 10;
    doc.moveTo(MARGIN, y).lineTo(right, y).lineWidth(0.8).strokeColor(LINE).stroke();
    y += 10;

    if (input.voided) {
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#B91C1C").text("VOIDED — THIS SALE WAS CANCELLED", MARGIN, y);
      y += 14;
    }

    // ── Billed to ────────────────────────────────────────────────────────
    doc.font("Helvetica-Bold").fontSize(7).fillColor(MUTED).text(L.billedTo[0], MARGIN, y, {
      characterSpacing: 0.6,
    });
    ar(L.billedTo[1], MARGIN, y - 1, { size: 7.5, width: contentW, align: "right" });
    y += 11;

    if (input.customer) {
      /**
       * A business is billed by its trading name, a person by theirs.
       *
       * The company used to be a secondary detail line under the contact's
       * name, which put "Khaled Rahman" in 11pt accent type on an invoice
       * addressed to a company — wrong on a tax document, and wrong for the
       * accounts department that files it. When a company is on record it IS
       * the billed party; the personal name only stands in when there is none.
       */
      const billedTo = input.customer.company?.trim() || input.customer.name;
      doc.font("Helvetica-Bold").fontSize(11).fillColor(ACCENT).text(billedTo, MARGIN, y, {
        width: contentW * 0.55,
        lineBreak: false,
      });
      // The address sits on the right, opposite the name, as on the reference.
      if (input.customer.address) {
        doc.font("Helvetica").fontSize(8).fillColor(INK).text(`Address: ${input.customer.address}`, MARGIN, y + 2, {
          width: contentW,
          align: "right",
          lineBreak: false,
        });
      }
      y += 14;

      const detail = (label: string, value: string) => {
        doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(label, MARGIN, y, { continued: true });
        doc.font("Helvetica-Bold").fillColor(INK).text(value);
        y += 10.5;
      };
      // The company is the headline above when it exists, so it is not
      // repeated here.
      if (input.customer.phone) detail("Phone: ", input.customer.phone);
      // The customer's own TRN is what makes the tax reclaimable for them.
      if (input.customer.trn) detail("TRN NO: ", input.customer.trn);
    } else {
      doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text("Walk-in Customer", MARGIN, y);
      y += 14;
    }

    y += 6;

    // ── Line table ───────────────────────────────────────────────────────
    const w = {
      no: contentW * COLS.no,
      description: contentW * COLS.description,
      qty: contentW * COLS.qty,
      unitPrice: contentW * COLS.unitPrice,
      beforeTax: contentW * COLS.beforeTax,
      tax: contentW * COLS.tax,
      total: contentW * COLS.total,
    };
    const x = {
      no: MARGIN,
      description: MARGIN + w.no,
      qty: MARGIN + w.no + w.description,
      unitPrice: MARGIN + w.no + w.description + w.qty,
      beforeTax: MARGIN + w.no + w.description + w.qty + w.unitPrice,
      tax: MARGIN + w.no + w.description + w.qty + w.unitPrice + w.beforeTax,
      total: MARGIN + w.no + w.description + w.qty + w.unitPrice + w.beforeTax + w.tax,
    };
    const PAD = 4;

    const HEAD_EN = 6.6;
    const HEAD_AR = 5.8;
    const heads: ReadonlyArray<
      readonly [keyof typeof w, readonly [string, string], "left" | "right" | "center"]
    > = [
      ["no", L.no, "center"],
      ["description", L.description, "left"],
      ["qty", L.qty, "center"],
      ["unitPrice", L.unitPrice, "right"],
      ["beforeTax", L.beforeTax, "right"],
      ["tax", [`TAX ${Number(input.lines[0]?.taxPercent ?? "5")}%`, "الضريبة"], "right"],
      ["total", L.total, "right"],
    ];

    /**
     * The band is measured, not guessed: "TOTAL AMOUNT" needs two lines in an
     * 11% column, and a fixed height clipped its Arabic against the first row.
     * Measuring means a longer tax label widens the band instead of spilling.
     */
    doc.font("Helvetica-Bold").fontSize(HEAD_EN);
    const headEnH = Math.max(
      ...heads.map(([key, pair]) => doc.heightOfString(pair[0], { width: w[key] - PAD * 2 })),
    );
    const headArH = hasArabic ? HEAD_AR * 1.5 : 0;
    const HEADER_H = 4 + headEnH + headArH + 3;
    const drawTableHeader = (top: number): number => {
      doc.rect(MARGIN, top, contentW, HEADER_H).fill("#F9FAFB");
      doc.rect(MARGIN, top, contentW, HEADER_H).lineWidth(0.6).strokeColor(LINE).stroke();

      // One shared baseline for the Arabic row. Deriving it per column would
      // step the two-line labels' Arabic below its neighbours'.
      const arY = top + 4 + headEnH + 1;

      for (const [key, pair, align] of heads) {
        const cellW = w[key] - PAD * 2;
        doc
          .font("Helvetica-Bold")
          .fontSize(HEAD_EN)
          .fillColor(MUTED)
          .text(pair[0], x[key] + PAD, top + 4, { width: cellW, align, characterSpacing: 0.3 });
        ar(pair[1], x[key] + PAD, arY, { size: HEAD_AR, width: cellW, align });
      }

      return top + HEADER_H;
    };

    y = drawTableHeader(y);

    const ROW_MIN = 18;

    /** The ruled box and its column separators — identical for filled and blank rows. */
    const drawRowFrame = (top: number, height: number) => {
      doc.rect(MARGIN, top, contentW, height).lineWidth(0.6).strokeColor(LINE).stroke();
      for (const key of ["description", "qty", "unitPrice", "beforeTax", "tax", "total"] as const) {
        doc.moveTo(x[key], top).lineTo(x[key], top + height).lineWidth(0.4).strokeColor(LINE).stroke();
      }
    };

    /** Where a row must stop and move to the next page, leaving room for the totals. */
    const pageLimit = () => doc.page.height - MARGIN - 120;

    for (const [index, line] of input.lines.entries()) {
      const label =
        line.variantName && line.variantName !== "Default"
          ? `${line.productName} — ${line.variantName}`
          : line.productName;
      const text = `${label} (${line.productSku})`.toUpperCase();

      /**
       * Measured in the FONT IT IS DRAWN IN. Uppercase Helvetica regular sets
       * to a different width than mixed-case Helvetica-Bold, so measuring
       * with one and drawing with the other under-reports the height and
       * clips the second line of a long product name.
       */
      doc.font("Helvetica").fontSize(DESCRIPTION_SIZE);
      const textH = doc.heightOfString(text, { width: w.description - PAD * 2 });
      const rowH = Math.max(ROW_MIN, textH + PAD * 2);

      // Break to a new page before drawing, never across a row — a line split
      // over a page boundary is unreadable on a tax document.
      if (y + rowH > pageLimit()) {
        doc.addPage();
        y = drawTableHeader(MARGIN);
      }

      drawRowFrame(y, rowH);

      const midY = y + (rowH - 8) / 2;
      doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(String(index + 1), x.no + PAD, midY, {
        width: w.no - PAD * 2,
        align: "center",
      });
      /**
        * Centred on the row like every other cell, left-aligned within it.
        * Measured height rather than a single line's, so a name that wraps
        * to two lines centres as a block instead of hanging off the top.
        */
      const descY = y + (rowH - textH) / 2;
      doc
        .font("Helvetica")
        .fontSize(DESCRIPTION_SIZE)
        .fillColor(INK)
        .text(text, x.description + PAD, descY, {
          width: w.description - PAD * 2,
          align: "left",
        });

      doc.font("Helvetica").fontSize(8).fillColor(INK);
      doc.text(qty(line.quantity), x.qty + PAD, midY, { width: w.qty - PAD * 2, align: "center" });
      doc.text(money(line.unitPrice), x.unitPrice + PAD, midY, { width: w.unitPrice - PAD * 2, align: "right" });
      doc.text(money(line.beforeTax), x.beforeTax + PAD, midY, { width: w.beforeTax - PAD * 2, align: "right" });
      doc.text(money(line.taxAmount), x.tax + PAD, midY, { width: w.tax - PAD * 2, align: "right" });
      doc.font("Helvetica-Bold").text(money(line.total), x.total + PAD, midY, {
        width: w.total - PAD * 2,
        align: "right",
      });

      y += rowH;
    }

    /**
     * Ruled but empty rows, closing the table off.
     *
     * They close the table off under the last item and leave a counter hand
     * somewhere to write something added after the bill was printed. A fixed
     * three, not padding to a minimum page height: filling a short invoice
     * down to eight rows pushed the totals a third of the way down the page
     * and made a two-item sale look like a form somebody failed to complete.
     *
     * Deliberately unnumbered: numbers in blank rows read as lines whose
     * detail failed to print.
     */
    for (let i = 0; i < BLANK_ROWS; i += 1) {
      if (y + ROW_MIN > pageLimit()) break;
      drawRowFrame(y, ROW_MIN);
      y += ROW_MIN;
    }

    // Table footer: the column sums, as on the reference.
    const FOOT_H = 20;
    doc.rect(MARGIN, y, contentW, FOOT_H).fill("#F9FAFB");
    doc.rect(MARGIN, y, contentW, FOOT_H).lineWidth(0.6).strokeColor(LINE).stroke();
    const footMid = y + (FOOT_H - 8) / 2;
    /**
     * "Total" then its Arabic, side by side and right-aligned against the
     * first figure — measured rather than guessed, because writing both at
     * the same y with overlapping widths printed one through the other.
     */
    const arTotalW = hasArabic ? 34 : 0;
    doc.font("Helvetica-Bold").fontSize(8).fillColor(INK).text(L.sumTotal[0], x.no + PAD, footMid, {
      width: w.no + w.description + w.qty - PAD * 2 - arTotalW - 4,
      align: "right",
    });
    ar(L.sumTotal[1], x.unitPrice - arTotalW - 2, footMid - 0.5, {
      size: 7,
      width: arTotalW,
      align: "right",
      color: INK,
    });
    doc.font("Helvetica-Bold").fontSize(8).fillColor(INK);
    doc.text(money(input.subtotal), x.beforeTax + PAD, footMid, { width: w.beforeTax - PAD * 2, align: "right" });
    doc.text(money(input.taxAmount), x.tax + PAD, footMid, { width: w.tax - PAD * 2, align: "right" });
    doc.text(money(input.total), x.total + PAD, footMid, { width: w.total - PAD * 2, align: "right" });
    y += FOOT_H + 10;

    // ── Summary ──────────────────────────────────────────────────────────
    const boxW = 240;
    const boxX = right - boxW;
    const sumRow = (label: string, value: string, opts: { band?: boolean; strong?: boolean } = {}) => {
      const h = opts.band ? 24 : 18;
      if (opts.band) doc.rect(boxX, y, boxW, h).fill(ACCENT_BAND);
      doc
        .font(opts.strong ? "Helvetica-Bold" : "Helvetica")
        .fontSize(opts.strong ? 10.5 : 8.5)
        .fillColor(opts.strong ? ACCENT : MUTED)
        .text(label, boxX + 10, y + (h - (opts.strong ? 11 : 9)) / 2, { width: boxW * 0.45 });
      doc
        .font("Helvetica-Bold")
        .fontSize(opts.strong ? 11.5 : 9)
        .fillColor(opts.strong ? ACCENT : INK)
        .text(`${input.currency} ${money(value)}`, boxX + boxW * 0.45, y + (h - (opts.strong ? 12 : 9)) / 2, {
          width: boxW * 0.55 - 10,
          align: "right",
        });
      y += h;
    };

    sumRow("Subtotal", input.subtotal);
    if (Number(input.discountAmount || "0") > 0) sumRow("Discount", `-${input.discountAmount}`);
    sumRow(`${input.taxLabel} (${Number(input.lines[0]?.taxPercent ?? "5")}%)`, input.taxAmount);
    sumRow("TOTAL", input.total, { band: true, strong: true });

    /**
     * How the customer paid is NOT printed.
     *
     * "Cash 86.63" on the face of a tax invoice tells the reader nothing they
     * need — they were there when they paid — while committing the document
     * to a tender split that a later part-refund or a corrected payment makes
     * wrong. What the paper has to state is what is still owed, and that is
     * the one line kept below.
     */
    // Only when actually outstanding — "Balance due 0.00" invites a second payment.
    if (Number(input.dueAmount ?? "0") > 0) {
      sumRow("Balance due", input.dueAmount!, { strong: true });
    }

    y += 12;
    if (input.notes) {
      doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(input.notes, MARGIN, y, { width: contentW * 0.6 });
      y = Math.max(y + 12, doc.y + 4);
    }

    // ── Footer ───────────────────────────────────────────────────────────
    const footY = Math.max(y + 16, doc.page.height - MARGIN - 54);
    doc.font("Helvetica").fontSize(8).fillColor(INK).text(L.receiverSign[0], MARGIN, footY);
    const signW = doc.widthOfString(L.receiverSign[0]);
    ar(L.receiverSign[1], MARGIN + signW + 6, footY + 1, { size: 7 });
    doc
      .moveTo(MARGIN, footY + 26)
      .lineTo(MARGIN + 190, footY + 26)
      .dash(2, { space: 2 })
      .lineWidth(0.6)
      .strokeColor("#9CA3AF")
      .stroke()
      .undash();

    doc
      .font("Helvetica-Bold")
      .fontSize(8.5)
      .fillColor(INK)
      .text(`For ${input.business.legalName}`, MARGIN, footY + 18, { width: contentW, align: "right" });

    doc.end();
  });
}
