import { describe, expect, it } from "vitest";
import { formatMoney } from "./format";

describe("formatMoney", () => {
  it("groups thousands and fixes two places", () => {
    expect(formatMoney("12500.5")).toBe("12,500.50");
    expect(formatMoney("1234567.0000")).toBe("1,234,567.00");
  });

  it("adds the currency when asked", () => {
    expect(formatMoney("42", { currency: "AED" })).toBe("AED 42.00");
  });

  it("keeps the sign on negatives", () => {
    expect(formatMoney("-1500.25")).toBe("-1,500.25");
  });

  it("does not drift the way floats do", () => {
    expect(formatMoney("0.30000000000000004")).toBe("0.30");
    expect(formatMoney("1.005")).toBe("1.01");
  });

  it("shows a dash for nothing and the raw value for garbage", () => {
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney("")).toBe("—");
    expect(formatMoney("n/a")).toBe("n/a");
  });
});
