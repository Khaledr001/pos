import { describe, expect, it } from "vitest";
import { openingBalance, summariseLedger } from "./statement.js";

describe("summariseLedger", () => {
  it("nets invoices, counter payments, returns, refunds and account payments", () => {
    const s = summariseLedger({
      invoiceCount: "3",
      invoiced: "1000.0000",
      paidAtSale: "400.0000",
      returned: "150.0000",
      refunded: "50.0000",
      accountPayments: "200.0000",
      entryCount: "6",
    });
    // owed = 1000 − 400 − 150 + 50 − 200
    expect(s.balance).toBe("300.0000");
    // paid = 400 at the counter + 200 on account − 50 handed back
    expect(s.paid).toBe("550.0000");
    expect(s.invoiceCount).toBe(3);
    expect(s.entryCount).toBe(6);
  });

  it("treats a customer with no documents as owing nothing", () => {
    const s = summariseLedger({
      invoiceCount: 0,
      invoiced: null,
      paidAtSale: null,
      returned: null,
      refunded: null,
      accountPayments: null,
      entryCount: 0,
    });
    expect(s.balance).toBe("0.0000");
    expect(s.invoiced).toBe("0.0000");
  });

  it("does not drift over many small amounts", () => {
    const s = summariseLedger({
      invoiceCount: 1,
      invoiced: "0.3000",
      paidAtSale: "0.1000",
      returned: null,
      refunded: null,
      accountPayments: "0.2000",
      entryCount: 2,
    });
    expect(s.balance).toBe("0.0000");
  });
});

describe("openingBalance", () => {
  it("is the running balance before the page's oldest row", () => {
    // Oldest row on the page: an invoice of 100 with 30 paid, leaving 570.
    expect(openingBalance({ balance: "570.0000", debit: "100.0000", credit: "30.0000" }, "900")).toBe(
      "500.0000",
    );
  });

  it("is the closing balance when the page is empty", () => {
    expect(openingBalance(undefined, "123.45")).toBe("123.4500");
  });
});
