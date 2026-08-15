import { describe, expect, it } from "vitest";
import { add, toDecimalString, toMinor } from "./money.js";
import { calculateDocument, calculateLine } from "./totals.js";

const money = (m: bigint) => toDecimalString(m, 2);

describe("calculateLine — tax exclusive", () => {
  it("adds VAT on top of the net", () => {
    const line = calculateLine(
      { quantity: 50, unitPrice: "2.20", taxPercent: 5 },
      "exclusive",
    );
    expect(money(line.gross)).toBe("110.00");
    expect(money(line.net)).toBe("110.00");
    expect(money(line.tax)).toBe("5.50");
    expect(money(line.total)).toBe("115.50");
  });

  it("applies the percentage discount before tax", () => {
    const line = calculateLine(
      { quantity: 10, unitPrice: "100", discountPercent: 10, taxPercent: 5 },
      "exclusive",
    );
    expect(money(line.discount)).toBe("100.00");
    expect(money(line.net)).toBe("900.00");
    expect(money(line.tax)).toBe("45.00");
    expect(money(line.total)).toBe("945.00");
  });

  it("stacks a flat discount after the percentage one", () => {
    const line = calculateLine(
      {
        quantity: 1,
        unitPrice: "200",
        discountPercent: 10,
        discountAmount: "5",
        taxPercent: 5,
      },
      "exclusive",
    );
    expect(money(line.discount)).toBe("25.00");
    expect(money(line.net)).toBe("175.00");
  });

  it("charges nothing on an exempt line", () => {
    const line = calculateLine({ quantity: 3, unitPrice: "10", taxPercent: 0 }, "exclusive");
    expect(money(line.tax)).toBe("0.00");
    expect(money(line.total)).toBe("30.00");
  });
});

describe("calculateLine — tax inclusive", () => {
  it("extracts VAT out of the shelf price", () => {
    const line = calculateLine({ quantity: 1, unitPrice: "105", taxPercent: 5 }, "inclusive");
    expect(money(line.net)).toBe("100.00");
    expect(money(line.tax)).toBe("5.00");
    expect(money(line.total)).toBe("105.00");
  });

  it("keeps total equal to the quoted price regardless of mode", () => {
    const line = calculateLine(
      { quantity: 7, unitPrice: "12.35", taxPercent: 5 },
      "inclusive",
    );
    expect(money(line.total)).toBe("86.45");
    expect(add(line.net, line.tax)).toBe(line.total);
  });
});

describe("calculateDocument", () => {
  it("sums lines and breaks tax out by rate", () => {
    const doc = calculateDocument({
      taxMode: "exclusive",
      lines: [
        { quantity: 50, unitPrice: "2.20", taxPercent: 5 },
        { quantity: 2, unitPrice: "15.00", taxPercent: 5 },
        { quantity: 1, unitPrice: "40.00", taxPercent: 0 },
      ],
    });

    expect(money(doc.subtotal)).toBe("180.00");
    expect(money(doc.taxAmount)).toBe("7.00");
    expect(money(doc.total)).toBe("187.00");
    expect(doc.taxBreakdown).toHaveLength(2);
    expect(money(doc.taxBreakdown[0]!.base)).toBe("40.00");
    expect(money(doc.taxBreakdown[1]!.tax)).toBe("7.00");
  });

  it("line totals sum exactly to the document total", () => {
    const doc = calculateDocument({
      taxMode: "exclusive",
      lines: Array.from({ length: 40 }, (_, i) => ({
        quantity: i + 1,
        unitPrice: "3.33",
        taxPercent: 5,
      })),
    });
    expect(add(...doc.lines.map((l) => l.total))).toBe(doc.total);
  });

  it("pushes a document discount down onto the lines so VAT falls too", () => {
    const plain = calculateDocument({
      taxMode: "exclusive",
      lines: [{ quantity: 1, unitPrice: "1000", taxPercent: 5 }],
    });
    const discounted = calculateDocument({
      taxMode: "exclusive",
      documentDiscountPercent: 10,
      lines: [{ quantity: 1, unitPrice: "1000", taxPercent: 5 }],
    });

    expect(money(plain.taxAmount)).toBe("50.00");
    expect(money(discounted.subtotal)).toBe("900.00");
    expect(money(discounted.taxAmount)).toBe("45.00");
    expect(money(discounted.total)).toBe("945.00");
  });

  it("spreads a document discount across lines without drift", () => {
    const doc = calculateDocument({
      taxMode: "exclusive",
      documentDiscountAmount: "100",
      lines: [
        { quantity: 1, unitPrice: "100", taxPercent: 5 },
        { quantity: 1, unitPrice: "200", taxPercent: 5 },
        { quantity: 1, unitPrice: "700", taxPercent: 5 },
      ],
    });
    expect(money(doc.subtotal)).toBe("900.00");
    expect(add(...doc.lines.map((l) => l.net))).toBe(doc.subtotal);
  });

  it("returns zeros for an empty cart", () => {
    const doc = calculateDocument({ taxMode: "exclusive", lines: [] });
    expect(doc.total).toBe(0n);
    expect(doc.taxBreakdown).toEqual([]);
  });
});
