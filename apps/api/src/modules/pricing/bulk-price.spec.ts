import { describe, expect, it } from "vitest";
import {
  bulkPriceFingerprint,
  evaluateBulkPrice,
  roundToStep,
  type BulkPriceChange,
  type CurrentPrices,
} from "./bulk-price.js";
import { Money } from "@devsfleet/shared-utils";

const prices = (selling: string, purchase: string | null = null, floor: string | null = null): CurrentPrices => ({
  sellingPrice: selling,
  purchasePrice: purchase,
  minSellingPrice: floor,
});

const change = (over: Partial<BulkPriceChange> = {}): BulkPriceChange => ({
  field: "sellingPrice",
  mode: "percent",
  direction: "increase",
  value: "10",
  rounding: "none",
  ...over,
});

const allow = { allowBelowFloor: false };

describe("roundToStep", () => {
  it("rounds half-up to the step", () => {
    expect(Money.toDecimalString(roundToStep(Money.toMinor("10.12"), "0.05"), 2)).toBe("10.10");
    expect(Money.toDecimalString(roundToStep(Money.toMinor("10.125"), "0.05"), 2)).toBe("10.15");
    expect(Money.toDecimalString(roundToStep(Money.toMinor("10.124"), "0.25"), 2)).toBe("10.00");
    expect(Money.toDecimalString(roundToStep(Money.toMinor("10.125"), "0.25"), 2)).toBe("10.25");
    expect(Money.toDecimalString(roundToStep(Money.toMinor("10.50"), "1.00"), 2)).toBe("11.00");
  });

  it("leaves the amount alone with no rounding", () => {
    expect(roundToStep(Money.toMinor("10.1234"), "none")).toBe(Money.toMinor("10.1234"));
  });
});

describe("evaluateBulkPrice", () => {
  it("raises by a percentage without float drift", () => {
    const out = evaluateBulkPrice(prices("2.20"), change({ value: "7.5" }), allow);
    expect(out.new).toBe("2.3650");
    expect(out.skip).toBeNull();
  });

  it("lowers by a fixed amount", () => {
    const out = evaluateBulkPrice(prices("10.00"), change({ mode: "amount", direction: "decrease", value: "1.50" }), allow);
    expect(out.new).toBe("8.5000");
  });

  it("rounds the result, not the change", () => {
    const out = evaluateBulkPrice(prices("9.99"), change({ value: "10", rounding: "0.50" }), allow);
    // 9.99 * 1.10 = 10.989 → nearest 0.50 is 11.00
    expect(out.new).toBe("11.0000");
  });

  it("marks a change that rounds back to the old price as unchanged", () => {
    const out = evaluateBulkPrice(prices("10.00"), change({ value: "0.1", rounding: "1.00" }), allow);
    expect(out.unchanged).toBe(true);
  });

  it("skips a selling price driven to zero", () => {
    const out = evaluateBulkPrice(prices("1.00"), change({ mode: "amount", direction: "decrease", value: "1.00" }), allow);
    expect(out.skip).toBe("not_positive");
  });

  it("skips a cut below the floor unless overriding", () => {
    const cut = change({ direction: "decrease", value: "20" });
    expect(evaluateBulkPrice(prices("10.00", null, "9.00"), cut, allow).skip).toBe("below_floor");
    expect(evaluateBulkPrice(prices("10.00", null, "9.00"), cut, { allowBelowFloor: true }).skip).toBeNull();
  });

  it("lets a price already under its floor be raised, and flags it", () => {
    const out = evaluateBulkPrice(prices("8.00", null, "9.00"), change({ value: "5" }), allow);
    expect(out.skip).toBeNull();
    expect(out.belowFloor).toBe(true);
  });

  it("does not hold a cost change hostage to an existing floor breach", () => {
    const out = evaluateBulkPrice(prices("8.00", "5.00", "9.00"), change({ field: "purchasePrice", value: "5" }), allow);
    expect(out.skip).toBeNull();
  });

  it("checks the floor after raising the floor itself", () => {
    const out = evaluateBulkPrice(prices("10.00", null, "9.50"), change({ field: "minSellingPrice", value: "10" }), allow);
    // 9.50 → 10.45, above the 10.00 selling price
    expect(out.belowFloor).toBe(true);
    expect(out.skip).toBe("below_floor");
  });

  it("flags selling under cost without refusing it", () => {
    const out = evaluateBulkPrice(prices("10.00", "9.80"), change({ direction: "decrease", value: "5" }), allow);
    expect(out.belowCost).toBe(true);
    expect(out.skip).toBeNull();
  });

  it("scales the purchase price and keeps the others", () => {
    const out = evaluateBulkPrice(prices("10.00", "6.00", "7.00"), change({ field: "purchasePrice", value: "10" }), allow);
    expect(out.next).toEqual({ sellingPrice: "10.00", purchasePrice: "6.6000", minSellingPrice: "7.00" });
  });

  it("cannot scale a field the row does not hold", () => {
    expect(evaluateBulkPrice(prices("10.00"), change({ field: "purchasePrice" }), allow).skip).toBe("no_current_value");
  });
});

describe("bulkPriceFingerprint", () => {
  it("ignores row order but not values", () => {
    const a = { priceId: "a", current: prices("1.00") };
    const b = { priceId: "b", current: prices("2.00") };
    expect(bulkPriceFingerprint([a, b])).toBe(bulkPriceFingerprint([b, a]));
    expect(bulkPriceFingerprint([a, b])).not.toBe(
      bulkPriceFingerprint([a, { priceId: "b", current: prices("2.01") }]),
    );
  });
});
