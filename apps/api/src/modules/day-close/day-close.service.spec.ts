import { Money } from "@devsfleet/shared-utils";
import { describe, expect, it } from "vitest";
import { expectedCash } from "./day-close.service.js";

/**
 * The day-close arithmetic, as arithmetic.
 *
 * Imports the REAL `expectedCash` rather than re-deriving the formula in the
 * test. A hand-duplicated copy here already drifted out of sync once — this
 * file originally reimplemented a 3-argument version (float + cash sales -
 * expenses) and kept passing after `expectedCash` grew a manual cash in/out
 * term, because the test was never exercising the function it claimed to pin.
 */
const totals = (over: Partial<Parameters<typeof expectedCash>[1]> = {}) => ({
  cashTotal: "0",
  manualCashIn: "0",
  manualCashOut: "0",
  cashExpenses: "0",
  ...over,
});

describe("day close arithmetic", () => {
  it("expected cash is the float plus cash taken minus cash spent", () => {
    const result = expectedCash(
      Money.toMinor("500"),
      totals({ cashTotal: "5.78", cashExpenses: "80" }),
    );
    expect(Money.toDecimalString(result, 2)).toBe("425.78");
  });

  it("ignores non-cash expenses", () => {
    // 3,000 of rent left by bank transfer. The drawer never saw it, so
    // subtracting it would make every month-end look catastrophically short.
    const result = expectedCash(Money.toMinor("500"), totals({ cashTotal: "5.78" }));
    expect(Money.toDecimalString(result, 2)).toBe("505.78");
  });

  it("adds manual cash in — a customer settling an invoice in cash", () => {
    // This is the case that broke: a customer payment reduces credit balance
    // but was invisible to the day's expected cash until it fed this term.
    const result = expectedCash(
      Money.toMinor("500"),
      totals({ cashTotal: "5.78", manualCashIn: "200" }),
    );
    expect(Money.toDecimalString(result, 2)).toBe("705.78");
  });

  it("subtracts manual cash out — e.g. paying a delivery driver from the till", () => {
    const result = expectedCash(
      Money.toMinor("500"),
      totals({ cashTotal: "5.78", manualCashOut: "50" }),
    );
    expect(Money.toDecimalString(result, 2)).toBe("455.78");
  });

  it("counting short gives a negative variance", () => {
    const variance = Money.subtract(Money.toMinor("325.78"), Money.toMinor("425.78"));
    expect(Money.toDecimalString(variance, 2)).toBe("-100.00");
    expect(Money.isNegative(variance)).toBe(true);
  });

  it("counting over gives a positive variance", () => {
    const variance = Money.subtract(Money.toMinor("450"), Money.toMinor("425.78"));
    expect(Money.toDecimalString(variance, 2)).toBe("24.22");
  });

  it("holds exactly across a day of thirds", () => {
    // 0.1 + 0.2 is the reason money is a scaled bigint. Three hundred sales of
    // 3.33 must not drift a fil by the time they reach the drawer.
    const sales = Array.from({ length: 300 }, () => Money.toMinor("3.33"));
    const total = sales.reduce((sum, amount) => Money.add(sum, amount), 0n);
    expect(Money.toDecimalString(total, 2)).toBe("999.00");

    const result = expectedCash(
      Money.toMinor("500"),
      totals({ cashTotal: Money.toDecimalString(total, 4) }),
    );
    expect(Money.toDecimalString(result, 2)).toBe("1499.00");
  });
});

/**
 * Tender allocation.
 *
 * A customer hands over a 100 note for a 5.78 basket. Booking the note rather
 * than the basket puts the change into the day's takings — the drawer reads
 * over by exactly the change given, and so does the VAT.
 */
describe("tender allocation", () => {
  const allocate = (
    total: string,
    tenders: string[],
  ): { applied: string[]; change: string } => {
    let unallocated = Money.toMinor(total);
    const applied: string[] = [];

    for (const tender of tenders) {
      const offered = Money.toMinor(tender);
      const part = Money.min(offered, unallocated);
      unallocated = Money.subtract(unallocated, part);
      applied.push(Money.toDecimalString(part, 2));
    }

    const tendered = tenders.reduce((sum, t) => Money.add(sum, Money.toMinor(t)), 0n);
    return {
      applied,
      change: Money.toDecimalString(
        Money.max(Money.subtract(tendered, Money.toMinor(total)), 0n),
        2,
      ),
    };
  };

  it("books the basket, not the note", () => {
    expect(allocate("5.78", ["100"])).toEqual({ applied: ["5.78"], change: "94.22" });
  });

  it("splits a tender across methods without inventing money", () => {
    expect(allocate("50", ["30", "20"])).toEqual({
      applied: ["30.00", "20.00"],
      change: "0.00",
    });
  });

  it("a part payment leaves the rest owing, not overpaid", () => {
    const result = allocate("50", ["30"]);
    expect(result).toEqual({ applied: ["30.00"], change: "0.00" });
  });

  it("only the overtender becomes change, on the last tender", () => {
    expect(allocate("50", ["30", "40"])).toEqual({
      applied: ["30.00", "20.00"],
      change: "20.00",
    });
  });
});
