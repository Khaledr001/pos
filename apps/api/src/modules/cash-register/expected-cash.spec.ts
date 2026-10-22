import { describe, expect, it } from "vitest";
import { expectedCash } from "./expected-cash.js";

describe("expectedCash", () => {
  it("adds the float, cash sales and pay-ins, and takes off pay-outs", () => {
    expect(expectedCash({ opening: "500", cashSales: "1240.50", cashIn: "100", cashOut: "60.25" })).toBe(
      "1780.2500",
    );
  });

  it("lets net refunds pull cash sales below zero", () => {
    expect(expectedCash({ opening: "200", cashSales: "-35", cashIn: "0", cashOut: "0" })).toBe("165.0000");
  });

  it("does not drift the way floats do", () => {
    expect(expectedCash({ opening: "0.1", cashSales: "0.2", cashIn: "0", cashOut: "0" })).toBe("0.3000");
  });
});
