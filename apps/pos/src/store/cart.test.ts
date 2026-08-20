import { beforeEach, describe, expect, it } from "vitest";
import type { PosProduct, PosVariantUnit } from "../lib/pos-data.js";
import { pickTierPrice, scaledTierPrice, useCart } from "./cart.js";

function product(overrides: Partial<PosProduct> = {}): PosProduct {
  return {
    id: "v1",
    productId: "p1",
    sku: "SKU-1",
    barcode: "123",
    name: "Test Product",
    variantName: null,
    unitAbbr: "pcs",
    sellingPrice: "10.00",
    minSellingPrice: null,
    taxPercent: "5",
    stock: "100",
    categoryName: null,
    ...overrides,
  };
}

const TIERED_PRODUCT = product({
  priceTiers: [
    { minQuantity: "1", sellingPrice: "10.00" },
    { minQuantity: "10", sellingPrice: "8.50" },
  ],
});

describe("pickTierPrice", () => {
  it("returns the base sellingPrice when the product has no tiers", () => {
    expect(pickTierPrice(product(), "50")).toBe("10.00");
  });

  it("stays on the base tier below the threshold", () => {
    expect(pickTierPrice(TIERED_PRODUCT, "9")).toBe("10.00");
  });

  it("switches to the higher tier once the threshold is reached", () => {
    expect(pickTierPrice(TIERED_PRODUCT, "10")).toBe("8.50");
    expect(pickTierPrice(TIERED_PRODUCT, "500")).toBe("8.50");
  });
});

describe("scaledTierPrice", () => {
  const BOX: PosVariantUnit = {
    id: "u1",
    unitId: "unit-box",
    unitName: "Box",
    unitAbbr: "box",
    conversionFactor: "20",
    barcode: null,
    priceOverride: null,
  };

  it("scales the tiered base price by the packaging's conversion factor", () => {
    // 20 pieces at the bulk tier price applies once the LINE'S OWN quantity
    // (here, 1 box = 20 pieces) reaches it — but scaledTierPrice is handed
    // the quantity to check, not the base-unit equivalent (Stage 5.2's
    // documented scope: tiers key off the quantity as entered on the line).
    const line = { product: TIERED_PRODUCT, unit: BOX } as never;
    expect(scaledTierPrice(line, "1")).toBe(Number(10 * 20).toFixed(4));
  });

  it("a packaging with a flat priceOverride is never tiered", () => {
    const flatBox: PosVariantUnit = { ...BOX, priceOverride: "150.00" };
    const line = { product: TIERED_PRODUCT, unit: flatBox } as never;
    expect(scaledTierPrice(line, "50")).toBe("150.00");
  });
});

describe("useCart quantity-tier pricing", () => {
  beforeEach(() => {
    useCart.getState().clear();
  });

  it("adds a product at the tier its initial quantity reaches", () => {
    useCart.getState().addProduct(TIERED_PRODUCT, "12");
    const [line] = useCart.getState().lines;
    expect(line?.unitPrice).toBe("8.50");
  });

  it("re-prices onto the next tier as the quantity is edited up", () => {
    useCart.getState().addProduct(TIERED_PRODUCT, "1");
    const key = useCart.getState().lines[0]!.key;

    useCart.getState().setQuantity(key, "10");
    expect(useCart.getState().lines[0]?.unitPrice).toBe("8.50");

    useCart.getState().setQuantity(key, "2");
    expect(useCart.getState().lines[0]?.unitPrice).toBe("10.00");
  });

  it("does not clobber a manually-overridden price when quantity changes", () => {
    useCart.getState().addProduct(TIERED_PRODUCT, "1");
    const key = useCart.getState().lines[0]!.key;

    useCart.getState().setUnitPrice(key, "7.00");
    useCart.getState().setQuantity(key, "10");

    expect(useCart.getState().lines[0]?.unitPrice).toBe("7.00");
  });

  it("merges a re-scanned item still on its own tier, and re-prices the sum", () => {
    useCart.getState().addProduct(TIERED_PRODUCT, "9");
    expect(useCart.getState().lines[0]?.unitPrice).toBe("10.00");

    useCart.getState().addProduct(TIERED_PRODUCT, "1");

    expect(useCart.getState().lines).toHaveLength(1);
    expect(useCart.getState().lines[0]?.quantity).toBe("10");
    expect(useCart.getState().lines[0]?.unitPrice).toBe("8.50");
  });
});
