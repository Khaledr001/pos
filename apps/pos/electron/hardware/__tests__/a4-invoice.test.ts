import { describe, expect, it } from "vitest";
import { renderA4Invoice } from "../a4-invoice.js";
import type { ReceiptBusiness, ReceiptSale } from "../receipt-template.js";

/**
 * Same posture as apps/api's invoice-pdf.spec.ts, which this module now
 * shares a layout with: pdfkit's output stream is compressed, so a rendered
 * word cannot be grepped back out of the buffer — only that a real,
 * well-formed PDF comes out for every input shape a real sale on this
 * terminal can actually take.
 */

const BUSINESS: ReceiptBusiness = {
  legalName: "DevsFleet Trading LLC",
  trn: "100234567800003",
  phone: "+971501234567",
  email: null,
  addressLines: ["Shop 4, Al Wahda Street", "Abu Dhabi, UAE"],
  currency: "AED",
  taxLabel: "VAT",
  branchName: "Sharjah Main Branch",
  timezone: "Asia/Dubai",
};

const SALE: ReceiptSale = {
  saleNumber: "INV-AUH-2026-000123",
  localId: "11111111-2222-3333-4444-555555555555",
  occurredAt: "2026-01-15T10:30:00Z",
  lines: [
    {
      productName: "PVC 90° Elbow",
      variantName: "1 Inch",
      productSku: "PVC-ELB-90-1IN",
      quantity: "10",
      unitPrice: "2.75",
      discountPercent: "0",
      taxPercent: "5",
      lineSubtotal: "27.50",
      taxAmount: "1.38",
      total: "28.88",
    },
  ],
  subtotal: "27.50",
  taxAmount: "1.38",
  discountAmount: "0.00",
  total: "28.88",
  payments: [{ method: "bank_transfer", amount: "28.88" }],
};

describe("renderA4Invoice", () => {
  it("produces a real PDF buffer", async () => {
    const buffer = await renderA4Invoice(SALE, BUSINESS);
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(buffer.length).toBeGreaterThan(500);
  });

  it("does not throw with a customer and duplicate marker set", async () => {
    const buffer = await renderA4Invoice(SALE, BUSINESS, {
      duplicate: true,
      customer: {
        name: "Al Manar Construction",
        company: "Al Manar LLC",
        phone: "0501234567",
        trn: "100999888700003",
        address: null,
      },
    });
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("does not throw with a discount, multiple lines and multiple tenders", async () => {
    const buffer = await renderA4Invoice(
      {
        ...SALE,
        lines: [
          ...SALE.lines,
          { ...SALE.lines[0]!, productName: "PVC Elbow", variantName: "Default", discountPercent: "10" },
        ],
        discountAmount: "5.00",
        payments: [
          { method: "card", amount: "20.00" },
          { method: "cash", amount: "8.88" },
        ],
      },
      BUSINESS,
    );
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("handles an unsynced sale (no sale number yet) and no customer", async () => {
    const buffer = await renderA4Invoice({ ...SALE, saleNumber: null }, BUSINESS);
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("handles a sale paid exactly, with no balance due", async () => {
    const buffer = await renderA4Invoice(
      { ...SALE, payments: [{ method: "cash", amount: "28.88" }] },
      BUSINESS,
    );
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("handles a business with no branch, TRN or address configured yet", async () => {
    const buffer = await renderA4Invoice(SALE, {
      legalName: "Corner Shop",
      trn: null,
      phone: null,
      email: null,
      addressLines: [],
      currency: "AED",
      taxLabel: "VAT",
      branchName: null,
      timezone: "Asia/Dubai",
    });
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
