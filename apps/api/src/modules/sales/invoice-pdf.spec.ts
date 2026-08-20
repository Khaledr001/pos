import { describe, expect, it } from "vitest";
import { renderInvoicePdf, type InvoicePdfInput } from "./invoice-pdf.js";

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
      total: "86.63",
    },
  ],
  subtotal: "82.50",
  discountAmount: "0.00",
  taxAmount: "4.13",
  total: "86.63",
  paidAmount: "86.63",
  dueAmount: "0.00",
  payments: [{ method: "cash", amount: "86.63" }],
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

  it("renders a discounted, multi-tender, part-paid credit sale", async () => {
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
          total: "255.15",
        },
      ],
      discountAmount: "27.00",
      payments: [
        { method: "card", amount: "200.00" },
        { method: "credit", amount: "141.78" },
      ],
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
