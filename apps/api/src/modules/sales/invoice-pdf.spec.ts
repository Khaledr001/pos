import { describe, expect, it } from "vitest";
import { renderInvoicePdf, toTaxDocument, type InvoicePdfInput } from "./invoice-pdf.js";

/**
 * Same posture as quotation-pdf.spec.ts, and for the same reason: pdfkit's
 * output stream is compressed, so a rendered word cannot be grepped back out
 * of the buffer. What is checkable is that a real, well-formed PDF comes out
 * for every input shape a real sale can actually take — which is what stops a
 * download button handing somebody a broken file.
 */
const BASE: InvoicePdfInput = {
  business: {
    legalName: "DevsFleet Trading LLC",
    trn: "100234567800003",
    phone: "+971501234567",
    email: "accounts@devsfleet.com",
    addressLines: ["Shop 4, Al Wahda Street", "Abu Dhabi, UAE"],
  },
  branchName: "Sharjah Main Branch",
  saleNumber: "INV-SHJ-2026-000123",
  occurredAt: new Date("2026-01-15T10:30:00Z"),
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
  cashierName: "Counter Cashier 1",
  lines: [
    {
      productName: "PVC 90° Elbow",
      variantName: "1 Inch",
      productSku: "PVC-ELB-90-1IN",
      quantity: "30",
      unitPrice: "2.75",
      discountPercent: "0",
      taxPercent: "5",
      lineSubtotal: "82.50",
      taxAmount: "4.13",
      total: "86.63",
    },
  ],
  subtotal: "82.50",
  discountAmount: "0.00",
  taxAmount: "4.13",
  total: "86.63",
  paidAmount: "86.63",
  dueAmount: "0.00",
  voided: false,
  notes: null,
};

describe("renderInvoicePdf", () => {
  it("produces a real PDF buffer", async () => {
    const buffer = await renderInvoicePdf(BASE);
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(buffer.length).toBeGreaterThan(500);
  });

  it("renders a walk-in sale with no customer at all", async () => {
    const buffer = await renderInvoicePdf({ ...BASE, customer: null, cashierName: null });
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("renders a voided sale rather than refusing to produce a document", async () => {
    const buffer = await renderInvoicePdf({ ...BASE, voided: true });
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("renders a discounted, part-paid credit sale", async () => {
    const buffer = await renderInvoicePdf({
      ...BASE,
      lines: [
        ...BASE.lines,
        {
          productName: "Basin Mixer Tap",
          variantName: "Default",
          productSku: "TAP-MIX-CHR",
          quantity: "2",
          unitPrice: "135.00",
          discountPercent: "10",
          taxPercent: "5",
          lineSubtotal: "243.00",
          taxAmount: "12.15",
          total: "255.15",
        },
      ],
      discountAmount: "27.00",
      paidAmount: "200.00",
      dueAmount: "141.78",
      notes: "Balance due in 30 days.",
    });
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("handles a business with no TRN or address configured yet", async () => {
    const buffer = await renderInvoicePdf({
      ...BASE,
      business: { legalName: "Corner Shop", trn: null, phone: null, email: null, addressLines: [] },
      branchName: null,
    });
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  /**
   * A timezone Postgres would accept but `Intl` would throw on must not take
   * the download with it — an unprintable invoice is worse than a UTC one.
   */
  it("falls back rather than throwing on an unusable timezone", async () => {
    const buffer = await renderInvoicePdf({ ...BASE, timezone: "Mars/Olympus_Mons" });
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  /**
   * 60 lines runs past one A4 page. The renderer breaks to a new page rather
   * than drawing off the bottom edge — a truncated tax document is not one.
   */
  it("paginates a long invoice instead of overflowing the page", async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      ...BASE.lines[0]!,
      productSku: `SKU-${i}`,
    }));
    const buffer = await renderInvoicePdf({ ...BASE, lines: many });
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    // More content than the single-line invoice, i.e. the extra rows landed.
    const single = await renderInvoicePdf(BASE);
    expect(buffer.length).toBeGreaterThan(single.length);
  });

  it("handles an empty line list without throwing", async () => {
    const buffer = await renderInvoicePdf({ ...BASE, lines: [] });
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});

describe("toTaxDocument", () => {
  it("an ordinary sale is a tax invoice with no credit-note, foreign-currency or e-invoice parts", () => {
    const doc = toTaxDocument(BASE);
    expect(doc.kind).toBe("invoice");
    expect(doc.creditNote).toBeUndefined();
    expect(doc.foreign).toBeUndefined();
    expect(doc.einvoice).toBeUndefined();
    expect(doc.lines[0]!.taxCategory).toBeUndefined();
  });

  it("a return is a credit note that names the invoice it corrects and says why in words", () => {
    const doc = toTaxDocument({
      ...BASE,
      saleNumber: "CRN-SHJ-2026-000004",
      documentType: "credit_note",
      creditNote: {
        againstNumber: "INV-SHJ-2026-000123",
        againstDate: new Date("2026-01-10T08:00:00Z"),
        reason: "DL8.61.1.D",
        note: "Damaged in transit",
      },
    });
    expect(doc.kind).toBe("credit_note");
    expect(doc.documentNumber).toBe("CRN-SHJ-2026-000004");
    expect(doc.creditNote).toEqual({
      againstNumber: "INV-SHJ-2026-000123",
      againstDate: new Date("2026-01-10T08:00:00Z"),
      reasonLabel: "Goods or services returned",
      note: "Damaged in transit",
    });
  });

  it("a credit note record with no original found still renders as a credit note", () => {
    const doc = toTaxDocument({ ...BASE, documentType: "credit_note" });
    expect(doc.kind).toBe("credit_note");
    expect(doc.creditNote).toBeUndefined();
  });

  it("carries each line's VAT category, and spells out an exemption reason in words", () => {
    const doc = toTaxDocument({
      ...BASE,
      lines: [
        { ...BASE.lines[0]!, taxCategory: "S" },
        { ...BASE.lines[0]!, taxCategory: "Z", taxPercent: "0" },
        { ...BASE.lines[0]!, taxCategory: "E", taxPercent: "0", taxExemptionCode: "DL8.46.3" },
      ],
    });
    expect(doc.lines.map((l) => l.taxCategory)).toEqual(["S", "Z", "E"]);
    expect(doc.lines[2]!.taxCategoryNote).toBe("Bare land");
    expect(doc.lines[1]!.taxCategoryNote).toBeUndefined();
  });

  it("states VAT in the books' currency only when the document's currency differs", () => {
    expect(toTaxDocument({ ...BASE, baseCurrency: "AED", exchangeRate: "1" }).foreign).toBeUndefined();
    expect(toTaxDocument({ ...BASE, currency: "USD", baseCurrency: "AED", exchangeRate: "3.6725" }).foreign).toEqual({
      baseCurrency: "AED",
      exchangeRate: "3.6725",
    });
  });

  it("labels the e-invoice status in words", () => {
    const doc = toTaxDocument({ ...BASE, einvoice: { uuid: "0b2c1d2e-1111-4222-8333-444455556666", status: "delivered" } });
    expect(doc.einvoice).toEqual({ uuid: "0b2c1d2e-1111-4222-8333-444455556666", statusLabel: "Delivered" });
  });
});

describe("renderInvoicePdf — credit note", () => {
  it("renders a credit note PDF with negative lines", async () => {
    const buffer = await renderInvoicePdf({
      ...BASE,
      saleNumber: "CRN-SHJ-2026-000004",
      documentType: "credit_note",
      creditNote: { againstNumber: "INV-SHJ-2026-000123", againstDate: BASE.occurredAt, reason: "VD", note: null },
      lines: [{ ...BASE.lines[0]!, quantity: "-30", lineSubtotal: "-82.50", taxAmount: "-4.13", total: "-86.63" }],
      subtotal: "-82.50",
      taxAmount: "-4.13",
      total: "-86.63",
    });
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
