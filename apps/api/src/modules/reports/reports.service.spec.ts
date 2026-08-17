import { describe, expect, it } from "vitest";
import { marginPercent } from "./reports.service.js";

/**
 * Margin as a percentage.
 *
 * Two mistakes are easy here and both produce a number that still looks like a
 * percentage: dividing two scaled values (off by 10,000) and quoting margin on
 * cost rather than on revenue (markup, a different and larger number).
 */
describe("marginPercent", () => {
  it("is margin over revenue", () => {
    // 55.00 sold, 32.00 cost, 23.00 margin.
    expect(marginPercent("55.0000", "23.0000")).toBe("41.82");
  });

  it("is not markup — margin over COST would be 71.88", () => {
    expect(marginPercent("55.0000", "23.0000")).not.toBe("71.88");
  });

  it("keeps the money scale rather than cancelling it", () => {
    // The bug this guards: dividing two Minor4 values reported 41.82% as 0.42%.
    expect(marginPercent("64.5000", "26.5000")).toBe("41.09");
  });

  it("handles a loss", () => {
    expect(marginPercent("100.0000", "-25.0000")).toBe("-25.00");
  });

  it("reports zero rather than dividing by zero revenue", () => {
    expect(marginPercent("0", "0")).toBe("0.00");
  });

  it("a full-margin sale is 100%", () => {
    expect(marginPercent("40.0000", "40.0000")).toBe("100.00");
  });
});
