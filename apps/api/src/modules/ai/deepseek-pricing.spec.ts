import { describe, expect, it } from "vitest";
import { calculateDeepSeekCost, isDeepSeekModel, isPeakHours } from "./deepseek-pricing.js";

describe("isPeakHours", () => {
  // A known Wednesday, so time-of-day cases aren't accidentally hitting the
  // weekend-is-always-off-peak rule.
  const wed = (hour: number) => new Date(Date.UTC(2026, 7, 26, hour, 0, 0)); // 2026-08-26 is a Wednesday

  it("is peak inside 01:00-04:00 UTC", () => {
    expect(isPeakHours(wed(1))).toBe(true);
    expect(isPeakHours(wed(2))).toBe(true);
    expect(isPeakHours(wed(3))).toBe(true);
  });

  it("is off-peak at the 04:00 boundary — end-exclusive", () => {
    expect(isPeakHours(wed(4))).toBe(false);
  });

  it("is off-peak between the two peak windows", () => {
    expect(isPeakHours(wed(5))).toBe(false);
  });

  it("is peak inside 06:00-10:00 UTC", () => {
    expect(isPeakHours(wed(6))).toBe(true);
    expect(isPeakHours(wed(9))).toBe(true);
  });

  it("is off-peak at the 10:00 boundary — end-exclusive", () => {
    expect(isPeakHours(wed(10))).toBe(false);
  });

  it("is off-peak overnight and mid-afternoon", () => {
    expect(isPeakHours(wed(0))).toBe(false);
    expect(isPeakHours(wed(14))).toBe(false);
    expect(isPeakHours(wed(23))).toBe(false);
  });

  it("is off-peak all weekend, even during what would be a peak hour on a weekday", () => {
    const sat2am = new Date(Date.UTC(2026, 7, 29, 2, 0, 0)); // Saturday
    const sun7am = new Date(Date.UTC(2026, 7, 30, 7, 0, 0)); // Sunday
    expect(isPeakHours(sat2am)).toBe(false);
    expect(isPeakHours(sun7am)).toBe(false);
  });
});

describe("calculateDeepSeekCost", () => {
  const offPeak = new Date(Date.UTC(2026, 7, 26, 14, 0, 0)); // Wednesday 14:00 UTC
  const peak = new Date(Date.UTC(2026, 7, 26, 7, 0, 0)); // Wednesday 07:00 UTC

  it("prices a flash call at off-peak rates", () => {
    // 1,000,000 cache-hit + 1,000,000 cache-miss + 1,000,000 completion,
    // at flash's off-peak rates: 0.007 + 0.22 + 0.66 = 0.887
    const cost = calculateDeepSeekCost({
      model: "deepseek-v4-flash",
      cacheHitTokens: 1_000_000,
      cacheMissTokens: 1_000_000,
      completionTokens: 1_000_000,
      at: offPeak,
    });
    expect(cost).toBe("0.887000");
  });

  it("doubles to peak rates for the same call", () => {
    const cost = calculateDeepSeekCost({
      model: "deepseek-v4-flash",
      cacheHitTokens: 1_000_000,
      cacheMissTokens: 1_000_000,
      completionTokens: 1_000_000,
      at: peak,
    });
    expect(cost).toBe("1.774000");
  });

  it("prices a realistic small call — a few hundred tokens, off-peak", () => {
    // 400 cache-miss prompt tokens + 150 completion tokens, flash, off-peak:
    // (400/1e6)*0.22 + (150/1e6)*0.66 = 0.000088 + 0.000099 = 0.000187
    const cost = calculateDeepSeekCost({
      model: "deepseek-v4-flash",
      cacheHitTokens: 0,
      cacheMissTokens: 400,
      completionTokens: 150,
      at: offPeak,
    });
    expect(cost).toBe("0.000187");
  });

  it("prices pro at its own, higher rate card", () => {
    const cost = calculateDeepSeekCost({
      model: "deepseek-v4-pro",
      cacheHitTokens: 1_000_000,
      cacheMissTokens: 1_000_000,
      completionTokens: 1_000_000,
      at: offPeak,
    });
    // 0.022 + 0.66 + 1.98 = 2.662
    expect(cost).toBe("2.662000");
  });

  it("returns zero rather than throwing for a model it doesn't recognise", () => {
    const cost = calculateDeepSeekCost({
      model: "deepseek-v5-hypothetical",
      cacheHitTokens: 1000,
      cacheMissTokens: 1000,
      completionTokens: 1000,
    });
    expect(cost).toBe("0.000000");
  });
});

describe("isDeepSeekModel", () => {
  it("recognises the three published models", () => {
    expect(isDeepSeekModel("deepseek-v4-flash")).toBe(true);
    expect(isDeepSeekModel("deepseek-v4-pro")).toBe(true);
    expect(isDeepSeekModel("deepseek-v4-flash-vision-exp")).toBe(true);
  });

  it("rejects an OpenAI model name someone left in LLM_MODEL by habit", () => {
    expect(isDeepSeekModel("gpt-4o")).toBe(false);
  });
});
