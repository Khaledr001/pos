import { describe, expect, it } from "vitest";
import * as Money from "./money.js";
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

describe("calculateDocument — tax categories", () => {
  const mixed = {
    lines: [
      { quantity: 2, unitPrice: "50.00", taxPercent: 5, taxCategory: "S" as const },
      { quantity: 1, unitPrice: "30.00", taxPercent: 0, taxCategory: "Z" as const },
      { quantity: 1, unitPrice: "20.00", taxPercent: 0, taxCategory: "E" as const },
      { quantity: 3, unitPrice: "10.00", taxPercent: 0, taxCategory: "O" as const },
    ],
  };

  it("keeps zero-rated, exempt and out-of-scope lines in separate groups", () => {
    const doc = calculateDocument({ taxMode: "exclusive", ...mixed });
    expect(doc.taxBreakdown.map((b) => [b.category, b.rate, money(b.base), money(b.tax)])).toEqual([
      ["Z", "0", "30.00", "0.00"],
      ["E", "0", "20.00", "0.00"],
      ["O", "0", "30.00", "0.00"],
      ["S", "5", "100.00", "5.00"],
    ]);
    expect(money(doc.total)).toBe("185.00");
  });

  it("derives the category from the rate when none is given", () => {
    const doc = calculateDocument({
      taxMode: "exclusive",
      lines: [
        { quantity: 1, unitPrice: "100", taxPercent: 5 },
        { quantity: 1, unitPrice: "10", taxPercent: 0 },
        { quantity: 1, unitPrice: "10" },
      ],
    });
    expect(doc.taxBreakdown.map((b) => b.category)).toEqual(["Z", "S"]);
    expect(money(doc.taxBreakdown[0]!.base)).toBe("20.00");
  });

  it("treats 5 and 5.0000 as the same rate", () => {
    const doc = calculateDocument({
      taxMode: "exclusive",
      lines: [
        { quantity: 1, unitPrice: "10", taxPercent: 5 },
        { quantity: 1, unitPrice: "10", taxPercent: "5.0000" },
      ],
    });
    expect(doc.taxBreakdown).toHaveLength(1);
    expect(money(doc.taxBreakdown[0]!.base)).toBe("20.00");
  });

  it("does not change the arithmetic: category is reporting only", () => {
    const withCategory = calculateDocument({ taxMode: "exclusive", ...mixed });
    const without = calculateDocument({
      taxMode: "exclusive",
      lines: mixed.lines.map(({ taxCategory: _c, ...l }) => l),
    });
    expect(withCategory.total).toBe(without.total);
    expect(withCategory.taxAmount).toBe(without.taxAmount);
  });

  it.each(["exclusive", "inclusive"] as const)("breakdown bases and taxes sum to the document in %s mode with a document discount", (taxMode) => {
    const doc = calculateDocument({ taxMode, ...mixed, documentDiscountPercent: 10 });
    expect(add(...doc.taxBreakdown.map((b) => b.base))).toBe(doc.subtotal);
    expect(add(...doc.taxBreakdown.map((b) => b.tax))).toBe(doc.taxAmount);
    expect(add(...doc.lines.map((l) => l.total))).toBe(doc.total);
    expect(doc.subtotal + doc.taxAmount).toBe(doc.total);
  });

  it("line totals still sum to the document total to the fils across many mixed lines", () => {
    const lines = Array.from({ length: 37 }, (_, i) => ({
      quantity: i + 1,
      unitPrice: "3.33",
      taxPercent: i % 3 === 0 ? 5 : 0,
      taxCategory: (i % 3 === 0 ? "S" : i % 3 === 1 ? "Z" : "E") as "S" | "Z" | "E",
    }));
    const doc = calculateDocument({ taxMode: "inclusive", lines, documentDiscountAmount: "7.77" });
    expect(add(...doc.lines.map((l) => l.total))).toBe(doc.total);
    expect(add(...doc.taxBreakdown.map((b) => b.base + b.tax))).toBe(doc.total);
  });
});

describe("calculateDocument — VAT settled per category and rate", () => {
  const many = (n: number, unitPrice: string, extra: Partial<Parameters<typeof calculateDocument>[0]["lines"][number]> = {}) =>
    Array.from({ length: n }, () => ({ quantity: 1, unitPrice, taxPercent: 5, ...extra }));

  it("rounds VAT once on the group: 100 lines of 0.30 owe 1.50, not 2.00", () => {
    const doc = calculateDocument({ lines: many(100, "0.30"), taxMode: "exclusive" });
    expect(Money.toDecimalString(doc.subtotal, 2)).toBe("30.00");
    expect(Money.toDecimalString(doc.taxAmount, 2)).toBe("1.50");
    expect(Money.toDecimalString(doc.total, 2)).toBe("31.50");
    expect(doc.taxBreakdown).toHaveLength(1);
    expect(Money.toDecimalString(doc.taxBreakdown[0]!.tax, 2)).toBe("1.50");
  });

  it("keeps the lines adding up to the document, line for line, to the fil", () => {
    const doc = calculateDocument({ lines: many(100, "0.30"), taxMode: "exclusive" });
    expect(doc.lines.reduce((a, l) => a + l.tax, 0n)).toBe(doc.taxAmount);
    expect(doc.lines.reduce((a, l) => a + l.total, 0n)).toBe(doc.total);
  });

  it("tax inclusive: every line total stays the shelf price, the group's VAT is extracted once", () => {
    const doc = calculateDocument({ lines: many(100, "0.30"), taxMode: "inclusive" });
    expect(doc.lines.every((l) => Money.toDecimalString(l.total, 2) === "0.30")).toBe(true);
    // 30.00 gross at 5% -> net 28.57, VAT 1.43
    expect(Money.toDecimalString(doc.subtotal, 2)).toBe("28.57");
    expect(Money.toDecimalString(doc.taxAmount, 2)).toBe("1.43");
    expect(Money.toDecimalString(doc.total, 2)).toBe("30.00");
  });

  it("a one-line document is exactly what calculateLine says", () => {
    const line = { quantity: 3, unitPrice: "12.34", taxPercent: 5 };
    const doc = calculateDocument({ lines: [line], taxMode: "exclusive" });
    expect(doc.lines[0]).toEqual(calculateLine(line, "exclusive"));
  });

  it("settles each category and rate on its own", () => {
    const doc = calculateDocument({
      lines: [
        ...many(10, "0.30"),
        ...many(10, "0.30", { taxPercent: 0, taxCategory: "Z" }),
        ...many(10, "0.30", { taxPercent: 0, taxCategory: "E" }),
      ],
      taxMode: "exclusive",
    });
    const byCategory = Object.fromEntries(doc.taxBreakdown.map((b) => [b.category, b]));
    expect(Money.toDecimalString(byCategory.S!.tax, 2)).toBe("0.15");
    expect(byCategory.Z!.tax).toBe(0n);
    expect(byCategory.E!.tax).toBe(0n);
    expect(Money.toDecimalString(doc.taxAmount, 2)).toBe("0.15");
  });

  it("a credit note (negative lines) settles the same way, mirrored", () => {
    const invoice = calculateDocument({ lines: many(100, "0.30"), taxMode: "exclusive" });
    const credit = calculateDocument({ lines: many(100, "0.30").map((l) => ({ ...l, quantity: -1 })), taxMode: "exclusive" });
    expect(credit.taxAmount).toBe(-invoice.taxAmount);
    expect(credit.subtotal).toBe(-invoice.subtotal);
    expect(credit.lines.reduce((a, l) => a + l.tax, 0n)).toBe(credit.taxAmount);
  });

  it("a document discount still lowers the VAT, and the group stays within half a fil of rate x base", () => {
    const doc = calculateDocument({ lines: many(37, "1.07"), taxMode: "exclusive", documentDiscountPercent: 12.5 });
    const g = doc.taxBreakdown[0]!;
    const expected = Money.roundTo(Money.percentOf(g.base, 5), 2);
    expect(g.tax).toBe(expected);
    expect(doc.lines.reduce((a, l) => a + l.tax, 0n)).toBe(doc.taxAmount);
  });

  it("holds for random documents: groups within rate x base, lines sum to the document, inclusive totals unchanged", () => {
    let seed = 20261029;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    for (let run = 0; run < 300; run++) {
      const n = 1 + Math.floor(rnd() * 60);
      const taxMode = rnd() < 0.5 ? "exclusive" : "inclusive";
      const lines = Array.from({ length: n }, () => {
        const cat = rnd();
        return {
          quantity: 1 + Math.floor(rnd() * 9),
          unitPrice: (rnd() * 40).toFixed(2),
          discountPercent: rnd() < 0.3 ? Math.floor(rnd() * 20) : 0,
          taxPercent: cat < 0.75 ? 5 : 0,
          taxCategory: cat < 0.75 ? ("S" as const) : cat < 0.9 ? ("Z" as const) : ("E" as const),
        };
      });
      const doc = calculateDocument({ lines, taxMode });
      expect(doc.lines.reduce((a, l) => a + l.tax, 0n)).toBe(doc.taxAmount);
      expect(doc.lines.reduce((a, l) => a + l.net, 0n)).toBe(doc.subtotal);
      expect(doc.lines.reduce((a, l) => a + l.total, 0n)).toBe(doc.total);
      for (const g of doc.taxBreakdown) {
        if (Number(g.rate) === 0) { expect(g.tax).toBe(0n); continue; }
        const ideal = taxMode === "exclusive" ? Money.roundTo(Money.percentOf(g.base, g.rate), 2) : undefined;
        if (ideal !== undefined) expect(g.tax).toBe(ideal);
        // within the 0.02 the e-invoice rules allow (here far tighter: one fil of rounding)
        const diff = g.tax - Money.percentOf(g.base, g.rate);
        expect(diff < 0n ? -diff : diff).toBeLessThanOrEqual(150n);
      }
      if (taxMode === "inclusive") {
        lines.forEach((l, i) => {
          const shelf = calculateLine(l, "inclusive").total;
          expect(doc.lines[i]!.total).toBe(shelf);
        });
      }
    }
  });
});
