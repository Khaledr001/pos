import { describe, expect, it } from "vitest";
import { renderQuotationPdf, type QuotationPdfInput } from "./quotation-pdf.js";

const BASE_INPUT: QuotationPdfInput = {
  tenantName: "DevsFleet Trading LLC",
  quotationNumber: "QT-AUH-2026-000001",
  currency: "AED",
  createdAt: new Date("2026-01-15T10:00:00Z"),
  validUntil: "2026-02-14",
  customer: { name: "Al Manar Construction", company: "Al Manar LLC", phone: "0501234567" },
  items: [
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
  notes: "Delivery within 3 working days.",
};

describe("renderQuotationPdf", () => {
  it("produces a real PDF buffer", async () => {
    const buffer = await renderQuotationPdf(BASE_INPUT);
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(buffer.length).toBeGreaterThan(500);
  });

  it("does not throw with no customer, no notes, and multiple lines", async () => {
    const buffer = await renderQuotationPdf({
      ...BASE_INPUT,
      customer: null,
      notes: null,
      validUntil: null,
      items: [
        ...BASE_INPUT.items,
        {
          productName: "PVC Elbow",
          variantName: "Default",
          productSku: "PVC-ELB-34",
          quantity: "1.5",
          unitPrice: "10.00",
          discountPercent: "10",
          taxPercent: "5",
          total: "14.18",
        },
      ],
    });
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("handles an empty line list without throwing", async () => {
    const buffer = await renderQuotationPdf({ ...BASE_INPUT, items: [] });
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
