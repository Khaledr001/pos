import { describe, expect, it } from "vitest";
import { AppError } from "./result.js";
import { categoryForResolvedRate, lineTaxFor, resolveProductTax, type ProductTax } from "./tax-category.js";

const standard: ProductTax = { taxRate: null, taxCategory: "S", taxExemptionCode: null };
const zero: ProductTax = { taxRate: "0", taxCategory: "Z", taxExemptionCode: null };
const exempt: ProductTax = { taxRate: "0", taxCategory: "E", taxExemptionCode: "DL8.46.3" };

describe("resolveProductTax", () => {
  it("a new product with nothing said is standard-rated and inherits the tenant rate", () => {
    expect(resolveProductTax({})).toEqual(standard);
  });

  it("naming only a non-standard category makes the rate 0", () => {
    expect(resolveProductTax({ taxCategory: "Z" })).toEqual(zero);
    expect(resolveProductTax({ taxCategory: "O" })).toEqual({ taxRate: "0", taxCategory: "O", taxExemptionCode: null });
  });

  it("naming only a rate of 0 means zero-rated; a positive rate means standard", () => {
    expect(resolveProductTax({ taxRate: 0 })).toEqual(zero);
    expect(resolveProductTax({ taxRate: 5 })).toEqual({ taxRate: "5", taxCategory: "S", taxExemptionCode: null });
    expect(resolveProductTax({ taxRate: "12.5" }).taxCategory).toBe("S");
  });

  it("naming a rate of 0 on an exempt product keeps it exempt", () => {
    expect(resolveProductTax({ taxRate: 0 }, exempt)).toEqual(exempt);
  });

  it("refuses a contradiction the caller spelled out", () => {
    expect(() => resolveProductTax({ taxCategory: "S", taxRate: 0 })).toThrow(AppError);
    expect(() => resolveProductTax({ taxCategory: "Z", taxRate: 5 })).toThrow(/0% VAT/);
    expect(() => resolveProductTax({ taxCategory: "E", taxRate: 5 })).toThrow(AppError);
    expect(() => resolveProductTax({ taxCategory: "Z", taxExemptionCode: "DL8.46.1" })).toThrow(/Exempt/);
  });

  it("moving a 0% product back to standard clears the rate so it inherits again", () => {
    expect(resolveProductTax({ taxCategory: "S" }, zero)).toEqual(standard);
  });

  it("moving a product off standard zeroes its rate even when it had one", () => {
    expect(resolveProductTax({ taxCategory: "E" }, { taxRate: "5", taxCategory: "S", taxExemptionCode: null })).toEqual({
      taxRate: "0",
      taxCategory: "E",
      taxExemptionCode: null,
    });
  });

  it("an exemption reason is kept on E, dropped when the category changes", () => {
    expect(resolveProductTax({ taxExemptionCode: "DL8.46.2" }, exempt).taxExemptionCode).toBe("DL8.46.2");
    expect(resolveProductTax({ taxCategory: "Z" }, exempt).taxExemptionCode).toBeNull();
    expect(resolveProductTax({ taxCategory: "E", taxExemptionCode: "DL8.46.4" }).taxExemptionCode).toBe("DL8.46.4");
  });

  it("an update that changes only the exemption reason leaves the rate alone", () => {
    const next = resolveProductTax({ taxExemptionCode: null }, exempt);
    expect(next).toEqual({ ...exempt, taxExemptionCode: null });
  });
});

describe("lineTaxFor", () => {
  it("a standard product with no rate takes the tenant default", () => {
    expect(lineTaxFor(standard, 5)).toEqual({ taxPercent: "5", taxCategory: "S", taxExemptionCode: null });
  });

  it("a product's own rate wins over the tenant default", () => {
    expect(lineTaxFor({ ...standard, taxRate: "10" }, 5).taxPercent).toBe("10");
  });

  it("non-standard categories are 0% whatever the tenant default is", () => {
    expect(lineTaxFor(zero, 5)).toEqual({ taxPercent: "0", taxCategory: "Z", taxExemptionCode: null });
    expect(lineTaxFor(exempt, 5)).toEqual({ taxPercent: "0", taxCategory: "E", taxExemptionCode: "DL8.46.3" });
  });

  it("a standard product with nothing to charge is reported zero-rated, not 'standard at 0%'", () => {
    expect(lineTaxFor(standard, 0)).toEqual({ taxPercent: "0", taxCategory: "Z", taxExemptionCode: null });
  });
});

describe("categoryForResolvedRate", () => {
  it("keeps the product's category when it agrees with the rate", () => {
    expect(categoryForResolvedRate(exempt, "0")).toEqual({ taxCategory: "E", taxExemptionCode: "DL8.46.3" });
    expect(categoryForResolvedRate(standard, "5")).toEqual({ taxCategory: "S", taxExemptionCode: null });
  });

  it("falls back to what the rate implies when they disagree", () => {
    expect(categoryForResolvedRate(zero, "5")).toEqual({ taxCategory: "S", taxExemptionCode: null });
    expect(categoryForResolvedRate(standard, "0")).toEqual({ taxCategory: "Z", taxExemptionCode: null });
  });
});
