import { describe, expect, it } from "vitest";
import { COLS, renderTaxDocument, summariseTax, type TaxDocumentInput } from "./tax-document.js";

/**
 * pdfkit's output stream is compressed, so a rendered word cannot be grepped
 * back out of the buffer. What is checkable here is what every consumer of
 * this layout — the API's sales invoices and quotations, and the POS
 * terminal's own A4 invoice — actually depends on: a real, well-formed PDF
 * comes out for the input shapes a real document can take, and the column
 * geometry a customer-facing invoice must have.
 */

const BASE: TaxDocumentInput = {
  kind: "invoice",
  business: {
    legalName: "DevsFleet Trading LLC",
    trn: "100234567800003",
    phone: "+971501234567",
    email: "accounts@devsfleet.com",
    addressLines: ["Shop 4, Al Wahda Street", "Abu Dhabi, UAE"],
  },
  branchName: "Sharjah Main Branch",
  documentNumber: "INV-SHJ-2026-000123",
  issuedAt: new Date("2026-01-15T10:30:00Z"),
  currency: "AED",
  taxLabel: "VAT",
  timezone: "Asia/Dubai",
  customer: {
    name: "Al Manar Construction",
    company: "Al Manar LLC",
    phone: "0501234567",
    trn: "100999888700003",
    address: "Industrial Area 12, Sharjah",
  },
  lines: [
    {
      productName: "PVC 90° Elbow",
      variantName: "1 Inch",
      productSku: "PVC-ELB-90-1IN",
      quantity: "30",
      unitPrice: "2.75",
      beforeTax: "82.50",
      taxAmount: "4.13",
      taxPercent: "5",
      total: "86.63",
    },
  ],
  subtotal: "82.50",
  discountAmount: "0.00",
  taxAmount: "4.13",
  total: "86.63",
  dueAmount: "0.00",
  voided: false,
  notes: null,
};

describe("renderTaxDocument", () => {
  it("produces a real PDF buffer for an invoice", async () => {
    const buffer = await renderTaxDocument(BASE);
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(buffer.length).toBeGreaterThan(500);
  });

  it("produces a real PDF buffer for a quotation", async () => {
    const buffer = await renderTaxDocument({
      ...BASE,
      kind: "quotation",
      documentNumber: "QT-AUH-2026-000001",
      validUntil: "2026-02-14",
      dueAmount: undefined,
      voided: undefined,
    });
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("renders with no customer, no branch, and no business TRN", async () => {
    const buffer = await renderTaxDocument({
      ...BASE,
      customer: null,
      branchName: null,
      business: { legalName: "Corner Shop", trn: null, phone: null, email: null, addressLines: [] },
    });
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("falls back rather than throwing on an unusable timezone", async () => {
    const buffer = await renderTaxDocument({ ...BASE, timezone: "Mars/Olympus_Mons" });
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("handles an empty line list without throwing", async () => {
    const buffer = await renderTaxDocument({ ...BASE, lines: [] });
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  /**
   * The billed party. A company is who the invoice is FOR; the contact's
   * personal name only stands in when no company is on record. Asserted by
   * byte length rather than by reading the PDF's text: the two names differ
   * in length, so rendering the wrong one is detectable without a parser.
   */
  it("bills a company by its name, not the contact's", async () => {
    const contactOnly = await renderTaxDocument({
      ...BASE,
      customer: { name: "A", company: null, phone: null, trn: null, address: null },
    });
    const withCompany = await renderTaxDocument({
      ...BASE,
      customer: {
        name: "A",
        company: "Gulf Contracting & Trading LLC",
        phone: null,
        trn: null,
        address: null,
      },
    });
    expect(withCompany.length).toBeGreaterThan(contactOnly.length);
  });

  it("falls back to the personal name when there is no company", async () => {
    const buffer = await renderTaxDocument({
      ...BASE,
      customer: { name: "Khaled Rahman", company: null, phone: null, trn: null, address: null },
    });
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  /**
   * A blank company string is not a company. Without the trim it would win
   * over the real name and the invoice would be addressed to nobody.
   */
  it("treats a whitespace-only company as absent", async () => {
    const blank = await renderTaxDocument({
      ...BASE,
      customer: { name: "Khaled Rahman", company: "   ", phone: null, trn: null, address: null },
    });
    const none = await renderTaxDocument({
      ...BASE,
      customer: { name: "Khaled Rahman", company: null, phone: null, trn: null, address: null },
    });
    expect(blank.length).toBe(none.length);
  });

  /**
   * 60 lines runs past one A4 page. The renderer breaks to a new page rather
   * than drawing off the bottom edge — a truncated tax document is not one.
   */
  it("paginates a long document instead of overflowing the page", async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      ...BASE.lines[0]!,
      productSku: `SKU-${i}`,
    }));
    const buffer = await renderTaxDocument({ ...BASE, lines: many });
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const single = await renderTaxDocument(BASE);
    expect(buffer.length).toBeGreaterThan(single.length);
  });
});

describe("table geometry", () => {
  /**
   * The description holds the only unbounded content on the row, so it gets
   * the majority of the width by requirement, not by accident. Widening a
   * numeric column at its expense wraps product names to three lines.
   */
  it("gives DESCRIPTION more than 45% of the table", () => {
    expect(COLS.description).toBeGreaterThan(0.45);
  });

  it("spends the whole table width and no more", () => {
    const total = Object.values(COLS).reduce((sum, share) => sum + share, 0);
    expect(total).toBeCloseTo(1, 5);
  });
});


/**
 * Words read back out of an UNCOMPRESSED render. pdfkit writes standard-font
 * text as hex strings inside TJ operators, so what was printed can be asserted
 * exactly — the Arabic labels (embedded glyph ids) are the one part that cannot.
 */
// pdfkit's standard fonts are WinAnsi: an em dash is byte 0x97, which Latin-1 (and
// Node's TextDecoder, for this label) reads as a control code. The few
// punctuation bytes this layout uses are mapped by hand.
const WIN_ANSI = {
  decode: (bytes: Uint8Array) =>
    Array.from(bytes, (b) => ({ 0x95: "•", 0x96: "–", 0x97: "—", 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”" })[b] ?? String.fromCharCode(b)).join(""),
};

async function printedText(input: TaxDocumentInput): Promise<string> {
  const buffer = await renderTaxDocument(input, { compress: false });
  const out: string[] = [];
  // A TJ array is `[<hex> kerning <hex> …] TJ`; read every hex run inside it.
  for (const [, body] of buffer.toString("latin1").matchAll(/\[([^\]]*)\]\s*TJ/g)) {
    out.push([...body!.matchAll(/<([0-9a-fA-F]*)>/g)].map(([, hex]) => WIN_ANSI.decode(Buffer.from(hex!, "hex"))).join(""));
  }
  return out.join("\n");
}

describe("what the document says", () => {
  it("an invoice is a Tax Invoice with an Invoice No and a Buyer TRN", async () => {
    const text = await printedText(BASE);
    expect(text).toContain("TAX INVOICE");
    expect(text).toContain("Invoice No");
    expect(text).toContain("Buyer TRN: ");
    expect(text).not.toContain("CREDIT NOTE");
    expect(text).not.toContain("E-invoice ID");
    expect(text).not.toContain("Date of supply");
    expect(text).not.toContain("VAT:");
  });

  it("a credit note has its own title and number, says what it corrects and why", async () => {
    const text = await printedText({
      ...BASE,
      kind: "credit_note",
      documentNumber: "CRN-SHJ-2026-000007",
      creditNote: {
        againstNumber: "INV-SHJ-2026-000123",
        againstDate: new Date("2026-01-10T08:00:00Z"),
        reasonLabel: "Goods or services returned",
        note: "Two boxes were damaged",
      },
      lines: [{ ...BASE.lines[0]!, quantity: "-30", beforeTax: "-82.50", taxAmount: "-4.13", total: "-86.63" }],
      subtotal: "-82.50",
      taxAmount: "-4.13",
      total: "-86.63",
    });
    expect(text).toContain("TAX CREDIT NOTE");
    expect(text).toContain("Credit Note No");
    expect(text).toContain("CRN-SHJ-2026-000007");
    expect(text).toContain("Against invoice INV-SHJ-2026-000123 dated Jan 10, 2026");
    expect(text).toContain("Reason: Goods or services returned — Two boxes were damaged");
    expect(text).toContain("-86.63");
    expect(text).not.toContain("TAX INVOICE");
  });

  it("a credit note without a known original date still names the invoice", async () => {
    const text = await printedText({
      ...BASE,
      kind: "credit_note",
      creditNote: { againstNumber: "INV-2025-000009", againstDate: null, reasonLabel: null, note: null },
    });
    expect(text).toContain("Against invoice INV-2025-000009");
    expect(text).not.toContain("Reason:");
  });

  it("explains a zero-rated, exempt or out-of-scope line on its face, and leaves standard lines alone", async () => {
    const text = await printedText({
      ...BASE,
      lines: [
        BASE.lines[0]!,
        { ...BASE.lines[0]!, productSku: "Z-1", taxPercent: "0", taxAmount: "0.00", taxCategory: "Z", total: "82.50" },
        { ...BASE.lines[0]!, productSku: "E-1", taxPercent: "0", taxAmount: "0.00", taxCategory: "E", taxCategoryNote: "Bare land", total: "82.50" },
        { ...BASE.lines[0]!, productSku: "O-1", taxPercent: "0", taxAmount: "0.00", taxCategory: "O", total: "82.50" },
      ],
    });
    expect(text).toContain("VAT: Zero-rated");
    expect(text).toContain("VAT: Exempt — Bare land");
    expect(text).toContain("VAT: Out of scope");
    expect(text.match(/VAT: Standard/g)).toBeNull();
  });

  it("prints a tax summary by treatment, with exact sums, only when treatments are mixed", async () => {
    const mixed = await printedText({
      ...BASE,
      lines: [
        { ...BASE.lines[0]!, beforeTax: "100.10", taxAmount: "5.01", total: "105.11" },
        { ...BASE.lines[0]!, beforeTax: "30.20", taxAmount: "1.51", total: "31.71" },
        { ...BASE.lines[0]!, productSku: "Z-1", taxPercent: "0", taxCategory: "Z", beforeTax: "40.00", taxAmount: "0.00", total: "40.00" },
      ],
    });
    expect(mixed).toContain("S · Standard rated");
    expect(mixed).toContain("130.30"); // 100.10 + 30.20, not a float's 130.29999…
    expect(mixed).toContain("6.52"); // 5.01 + 1.51
    expect(mixed).toContain("Z · Zero-rated");
    expect(mixed).toContain("VAT TREATMENT");

    const plain = await printedText(BASE);
    expect(plain).not.toContain("VAT TREATMENT");
  });

  it("labels the tax column with the rate only when there is one rate", async () => {
    expect(await printedText(BASE)).toContain("TAX 5%");
    const mixed = await printedText({
      ...BASE,
      lines: [BASE.lines[0]!, { ...BASE.lines[0]!, productSku: "Z-1", taxPercent: "0", taxCategory: "Z" }],
    });
    expect(mixed).not.toContain("TAX 5%");
    expect(mixed).toContain("\nTAX");
  });

  it("prints the date of supply only when it differs from the issue date", async () => {
    const same = await printedText({ ...BASE, supplyDate: new Date("2026-01-15T05:00:00Z") });
    expect(same).not.toContain("Date of supply");
    const different = await printedText({ ...BASE, supplyDate: new Date("2026-01-02T05:00:00Z") });
    expect(different).toContain("Date of supply");
    expect(different).toContain("Jan 2, 2026");
  });

  it("states VAT in the books' currency, at the rate used, for a foreign-currency document", async () => {
    const text = await printedText({
      ...BASE,
      currency: "USD",
      taxAmount: "5.00",
      foreign: { baseCurrency: "AED", exchangeRate: "3.6725" },
    });
    expect(text).toContain("Total VAT in AED: AED 18.36"); // 5.00 × 3.6725 = 18.3625
    expect(text).toContain("Exchange rate: 1 USD = 3.6725 AED");
  });

  it("a credit note's foreign VAT is negative, never a float artefact", async () => {
    const text = await printedText({
      ...BASE,
      kind: "credit_note",
      currency: "USD",
      taxAmount: "-0.10",
      foreign: { baseCurrency: "AED", exchangeRate: "3.6725" },
    });
    expect(text).toContain("AED -0.37"); // -0.10 × 3.6725 = -0.36725
  });

  it("does not print a foreign-currency block when the document is in the books' currency", async () => {
    const text = await printedText({ ...BASE, foreign: { baseCurrency: "AED", exchangeRate: "1" } });
    expect(text).not.toContain("Exchange rate");
  });

  it("shows the e-invoice id and status when there is one", async () => {
    const text = await printedText({
      ...BASE,
      einvoice: { uuid: "0b2c1d2e-1111-4222-8333-444455556666", statusLabel: "Delivered" },
    });
    expect(text).toContain("E-invoice ID 0b2c1d2e-1111-4222-8333-444455556666 · Delivered");
  });
});

describe("summariseTax", () => {
  it("groups by category and rate, S before Z before E before O, with exact sums", () => {
    const line = BASE.lines[0]!;
    const groups = summariseTax([
      { ...line, taxCategory: "E", taxPercent: "0", beforeTax: "10.0001", taxAmount: "0" },
      { ...line, taxCategory: "S", taxPercent: "5", beforeTax: "0.1", taxAmount: "0.005" },
      { ...line, taxCategory: "S", taxPercent: "5.0000", beforeTax: "0.2", taxAmount: "0.010" },
      { ...line, taxCategory: "Z", taxPercent: "0", beforeTax: "3", taxAmount: "0" },
    ]);
    expect(groups.map((g) => [g.category, g.rate, g.base, g.tax])).toEqual([
      ["S", "5", 3000n, 150n],
      ["Z", "0", 30000n, 0n],
      ["E", "0", 100001n, 0n],
    ]);
  });

  it("treats a line with no category as standard-rated", () => {
    expect(summariseTax([BASE.lines[0]!])[0]!.category).toBe("S");
  });
});
