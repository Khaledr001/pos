import { describe, expect, it } from "vitest";
import {
  amount,
  describeEntry,
  periodLabel,
  renderStatementPdf,
  statementDocumentInput,
  type StatementPdfInput,
} from "./statement-pdf.js";

const BASE: StatementPdfInput = {
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
  from: "2026-10-01",
  to: "2026-10-31",
  customer: { name: "Al Manar Construction", company: "Al Manar LLC", phone: "+971501234567", trn: null },
  openingBalance: "1200.0000",
  closingBalance: "1440.7500",
  creditLimit: "5000.0000",
  entries: [
    {
      date: new Date("2026-10-03T09:00:00Z"),
      kind: "invoice",
      docNumber: "INV-SHJ-2026-000143",
      branchName: "Sharjah Main Branch",
      method: null,
      debit: "540.7500",
      credit: "0.0000",
      balance: "1740.7500",
    },
    {
      date: new Date("2026-10-10T09:00:00Z"),
      kind: "payment",
      docNumber: "PAY-0001",
      branchName: "Sharjah Main Branch",
      method: "bank_transfer",
      debit: "0",
      credit: "300.0000",
      balance: "1440.7500",
    },
  ],
};

describe("statement PDF mapping", () => {
  it("groups and fixes amounts without floats", () => {
    expect(amount("1234567.0050")).toBe("1,234,567.01");
    expect(amount("-300")).toBe("-300.00");
    expect(amount("0.30000000000000004")).toBe("0.30");
  });

  it("totals the period's debits and credits and works out available credit", () => {
    const doc = statementDocumentInput(BASE);
    expect(doc.totalDebit).toBe("AED 540.75");
    expect(doc.totalCredit).toBe("AED 300.00");
    expect(doc.openingBalance).toBe("AED 1,200.00");
    expect(doc.closingBalance).toBe("AED 1,440.75");
    expect(doc.availableCredit).toBe("AED 3,559.25");
  });

  it("leaves the side a row did not move blank", () => {
    const [invoice, payment] = statementDocumentInput(BASE).entries;
    expect(invoice).toMatchObject({ debit: "540.75", credit: "" });
    expect(payment).toMatchObject({ debit: "", credit: "300.00" });
  });

  it("drops the credit block for a customer with no facility", () => {
    const doc = statementDocumentInput({ ...BASE, creditLimit: "0.0000" });
    expect(doc.creditLimit).toBeNull();
    expect(doc.availableCredit).toBeNull();
  });

  it("describes rows the way a customer reads them", () => {
    expect(describeEntry({ kind: "payment", method: "bank_transfer", branchName: "X" })).toBe("Payment · bank transfer");
    expect(describeEntry({ kind: "invoice", method: null, branchName: "Sharjah" })).toBe("Invoice · Sharjah");
  });

  it("words the period", () => {
    const issued = new Date("2026-10-22T08:00:00Z");
    expect(periodLabel("2026-10-01", "2026-10-31", issued, "Asia/Dubai")).toBe("Oct 1, 2026 – Oct 31, 2026");
    expect(periodLabel(null, null, issued, "Asia/Dubai")).toBe("All activity to Oct 22, 2026");
  });

  it("renders a real PDF", async () => {
    const pdf = await renderStatementPdf(BASE);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
