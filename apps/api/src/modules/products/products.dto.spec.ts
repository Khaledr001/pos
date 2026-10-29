import { describe, expect, it } from "vitest";
import { CreateProductSchema, UpdateProductSchema } from "./dto.js";

const variant = { sku: "A-1", variantName: "Default", sellingPrice: "10.00" };
const base = { name: "Elbow", unitId: "11111111-1111-4111-8111-111111111111", variants: [variant] };

describe("product DTOs — VAT", () => {
  it("accepts a category and an exemption reason", () => {
    const dto = CreateProductSchema.parse({ ...base, taxCategory: "E", taxExemptionCode: "DL8.46.3" });
    expect(dto.taxCategory).toBe("E");
    expect(dto.taxExemptionCode).toBe("DL8.46.3");
  });

  it("refuses an unknown category or reason", () => {
    expect(CreateProductSchema.safeParse({ ...base, taxCategory: "X" }).success).toBe(false);
    expect(CreateProductSchema.safeParse({ ...base, taxExemptionCode: "DL9" }).success).toBe(false);
  });

  it("a new product starts with its usual defaults", () => {
    const dto = CreateProductSchema.parse(base);
    expect(dto).toMatchObject({ attributes: {}, nameTranslations: {}, isStockTracked: true, trackSerial: false, trackExpiry: false });
  });
});

describe("UpdateProductSchema", () => {
  it("carries only what was sent: fixing a VAT category must not wipe attributes or translations", () => {
    expect(UpdateProductSchema.parse({ taxCategory: "Z" })).toEqual({ taxCategory: "Z" });
    expect(UpdateProductSchema.parse({ name: "New name" })).toEqual({ name: "New name" });
    expect(UpdateProductSchema.parse({})).toEqual({});
  });

  it("can clear an exemption reason", () => {
    expect(UpdateProductSchema.parse({ taxExemptionCode: null })).toEqual({ taxExemptionCode: null });
  });
});
