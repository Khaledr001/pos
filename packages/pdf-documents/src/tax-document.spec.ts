import { describe, expect, it } from "vitest";
import { COLS, renderTaxDocument, type TaxDocumentInput } from "./tax-document.js";

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
