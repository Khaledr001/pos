import { describe, expect, it } from "vitest";
import {
  add,
  allocate,
  allocateByWeight,
  divideByQuantity,
  divideRoundHalfUp,
  formatMoney,
  multiplyByQuantity,
  percentOf,
  roundTo,
  toDecimalString,
  toMinor,
} from "./money.js";

describe("toMinor", () => {
  it("parses decimal strings exactly", () => {
    expect(toMinor("0")).toBe(0n);
    expect(toMinor("1")).toBe(10_000n);
    expect(toMinor("1.5")).toBe(15_000n);
    expect(toMinor("1234.5678")).toBe(12_345_678n);
    expect(toMinor("-2.25")).toBe(-22_500n);
  });

  it("truncates past 4 decimals, the way DECIMAL(12,4) storage does", () => {
    expect(toMinor("1.99999")).toBe(19_999n);
  });

  it("does not lose the classic float pair", () => {
    // 0.1 + 0.2 as floats is 0.30000000000000004
    expect(add(toMinor(0.1), toMinor(0.2))).toBe(toMinor("0.3"));
  });

  it("handles numbers that stringify to exponent notation", () => {
    expect(toMinor(1e-7)).toBe(0n);
    expect(toMinor(1e3)).toBe(10_000_000n);
  });
});

describe("toDecimalString", () => {
  it("pads to the requested precision", () => {
    expect(toDecimalString(toMinor("1.5"))).toBe("1.5000");
    expect(toDecimalString(toMinor("1.5"), 2)).toBe("1.50");
    expect(toDecimalString(toMinor("1.005"), 2)).toBe("1.01");
    expect(toDecimalString(toMinor("-1.005"), 2)).toBe("-1.01");
    expect(toDecimalString(toMinor("2.5"), 0)).toBe("3");
  });
});

describe("divideRoundHalfUp", () => {
  it("rounds halves away from zero, not to even", () => {
    expect(divideRoundHalfUp(5n, 2n)).toBe(3n);
    expect(divideRoundHalfUp(-5n, 2n)).toBe(-3n);
    expect(divideRoundHalfUp(7n, 2n)).toBe(4n);
    expect(divideRoundHalfUp(4n, 2n)).toBe(2n);
  });
});

describe("multiplyByQuantity", () => {
  it("handles fractional quantities like 2.5 metres of cable", () => {
    expect(multiplyByQuantity(toMinor("12.50"), "2.5")).toBe(toMinor("31.25"));
  });

  it("holds up across a realistic line", () => {
    expect(multiplyByQuantity(toMinor("2.20"), 50)).toBe(toMinor("110"));
  });
});

describe("percentOf", () => {
  it("computes 5% UAE VAT", () => {
    expect(percentOf(toMinor("100"), 5)).toBe(toMinor("5"));
    expect(percentOf(toMinor("110"), 5)).toBe(toMinor("5.5"));
  });

  it("supports fractional rates", () => {
    expect(percentOf(toMinor("200"), "2.5")).toBe(toMinor("5"));
  });
});

describe("allocate", () => {
  it("splits without losing or inventing a minor unit", () => {
    const parts = allocate(toMinor("10"), 3);
    expect(add(...parts)).toBe(toMinor("10"));
    expect(parts.map((p) => toDecimalString(p))).toEqual(["3.3334", "3.3333", "3.3333"]);
  });

  it("handles negative amounts (a discount being pushed down)", () => {
    const parts = allocate(toMinor("-10"), 3);
    expect(add(...parts)).toBe(toMinor("-10"));
  });
});

describe("allocateByWeight", () => {
  it("splits proportionally and still sums exactly", () => {
    const weights = [toMinor("100"), toMinor("200"), toMinor("700")];
    const parts = allocateByWeight(toMinor("100"), weights);
    expect(add(...parts)).toBe(toMinor("100"));
    expect(toDecimalString(parts[0]!, 2)).toBe("10.00");
    expect(toDecimalString(parts[2]!, 2)).toBe("70.00");
  });

  it("falls back to an even split when every weight is zero", () => {
    const parts = allocateByWeight(toMinor("9"), [0n, 0n, 0n]);
    expect(add(...parts)).toBe(toMinor("9"));
  });
});

describe("roundTo", () => {
  it("keeps the value at MONEY_SCALE while zeroing lower places", () => {
    expect(roundTo(toMinor("1.2345"), 2)).toBe(toMinor("1.23"));
    expect(roundTo(toMinor("1.2355"), 2)).toBe(toMinor("1.24"));
  });
});

describe("formatMoney", () => {
  it("renders for display", () => {
    expect(formatMoney(toMinor("1234.5"))).toContain("1,234.50");
  });
});

describe("divideByQuantity", () => {
  it("is the exact inverse of multiplyByQuantity", () => {
    const unit = toMinor("2.8571");
    expect(divideByQuantity(multiplyByQuantity(unit, 100), 100)).toBe(unit);
  });

  it("gives a per-unit landed cost, not a scale-cancelled fraction", () => {
    // 200.00 of goods + 85.7143 of allocated freight over 100 units.
    const landed = divideByQuantity(add(toMinor("200"), toMinor("85.7143")), 100);
    expect(toDecimalString(landed, 4)).toBe("2.8571");
  });

  it("handles a fractional quantity — 12.5 metres of cable", () => {
    expect(toDecimalString(divideByQuantity(toMinor("43.75"), "12.5"), 4)).toBe("3.5000");
  });

  it("refuses to divide by zero units", () => {
    expect(() => divideByQuantity(toMinor("10"), 0)).toThrow(RangeError);
  });
});
