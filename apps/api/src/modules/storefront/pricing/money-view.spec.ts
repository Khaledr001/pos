import { Money } from "@devsfleet/shared-utils";
import { describe, expect, it } from "vitest";
import { listedUnitPrice } from "../../pricing/price-resolver.service.js";
import { moneyView, unitNetGross } from "./money-view.js";

describe("moneyView", () => {
  it("derives whole fils from Minor4 without a float", () => {
    expect(moneyView(Money.toMinor("15.2250"))).toMatchObject({ amount: "15.23", fils: 1523 });
    expect(moneyView(Money.toMinor("0.10"))).toMatchObject({ amount: "0.10", fils: 10 });
  });

  it("formats for display", () => {
    expect(moneyView(Money.toMinor("1234.5")).formatted).toMatch(/AED\s1,234\.50/);
  });
});

describe("unitNetGross", () => {
  it("adds VAT on an exclusive price, the way a receipt line would", () => {
    const { net, gross } = unitNetGross("14.50", "5", "exclusive");
    expect(Money.toDecimalString(net, 2)).toBe("14.50");
    expect(Money.toDecimalString(gross, 2)).toBe("15.23");
  });

  it("extracts VAT from an inclusive price", () => {
    const { net, gross } = unitNetGross("21.00", "5", "inclusive");
    expect(Money.toDecimalString(gross, 2)).toBe("21.00");
    expect(Money.toDecimalString(net, 2)).toBe("20.00");
  });

  it("leaves a zero-rated price alone", () => {
    const { net, gross } = unitNetGross("9.99", "0", "exclusive");
    expect(net).toBe(gross);
  });
});

/** Shared by the till and the shop, so a box costs the same in both. */
describe("listedUnitPrice", () => {
  it("is the base price for the base unit", () => {
    expect(listedUnitPrice({ unitPrice: "2.2000" }, null)).toBe("2.2000");
  });

  it("scales by the packaging's conversion factor", () => {
    expect(listedUnitPrice({ unitPrice: "2.2000" }, { conversionFactor: "50", priceOverride: null })).toBe("110.0000");
  });

  it("lets a flat pack price win outright", () => {
    expect(listedUnitPrice({ unitPrice: "2.2000" }, { conversionFactor: "50", priceOverride: "99.0000" })).toBe("99.0000");
  });

  it("refuses to invent a price for an unpriced variant", () => {
    expect(listedUnitPrice(undefined, null)).toBeNull();
  });
});
