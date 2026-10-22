import { describe, expect, it } from "vitest";
import { renderStatementDocument, type StatementDocumentInput } from "./statement-document.js";

/**
 * As with the tax document: pdfkit compresses its stream, so words cannot be
 * grepped back out. What is checked is that a real PDF comes out for every
 * shape a real statement takes, and that a long ledger flows onto more pages
 * instead of being cut off at the bottom of the first.
 */

const BASE: StatementDocumentInput = {
  business: {
    legalName: "DevsFleet Trading LLC",
    trn: "100234567800003",
    phone: "+971501234567",
    email: "accounts@devsfleet.com",
    addressLines: ["Shop 4, Al Wahda Street", "Abu Dhabi, UAE"],
  },
  currency: "AED",
  timezone: "Asia/Dubai",
  issuedAt: new Date("2026-10-22T08:00:00Z"),
  periodLabel: "Oct 1, 2026 – Oct 31, 2026",
  customer: { name: "Al Manar Construction", company: "Al Manar LLC", phone: "+971501234567", trn: "100999888700003" },
  openingBalance: "AED 1,200.00",
  totalDebit: "AED 540.75",
  totalCredit: "AED 300.00",
  closingBalance: "AED 1,440.75",
  creditLimit: "AED 5,000.00",
  availableCredit: "AED 3,559.25",
  entries: [
    {
      date: new Date("2026-10-03T09:00:00Z"),
      documentNumber: "INV-SHJ-2026-000143",
      description: "Invoice · Sharjah Main Branch",
      debit: "540.75",
      credit: "",
      balance: "1,740.75",
    },
    {
      date: new Date("2026-10-10T09:00:00Z"),
      documentNumber: "PAY-0001",
      description: "Payment · bank transfer",
      debit: "",
      credit: "300.00",
      balance: "1,440.75",
    },
  ],
};

const pageCount = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;

describe("renderStatementDocument", () => {
  it("produces a real PDF", async () => {
    const pdf = await renderStatementDocument(BASE);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.toString("latin1").trimEnd().endsWith("%%EOF")).toBe(true);
  });

  it("renders an empty period and a customer with no credit facility", async () => {
    const pdf = await renderStatementDocument({
      ...BASE,
      entries: [],
      creditLimit: null,
      availableCredit: null,
      customer: { name: "Walk-in", company: null, phone: null, trn: null },
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("flows a long ledger onto further pages", async () => {
    const entries = Array.from({ length: 120 }, (_, i) => ({ ...BASE.entries[0]!, documentNumber: `INV-${i}` }));
    const one = pageCount(await renderStatementDocument(BASE));
    const many = pageCount(await renderStatementDocument({ ...BASE, entries }));
    expect(one).toBe(1);
    expect(many).toBeGreaterThan(2);
  });
});
