import { describe, expect, it, vi } from "vitest";
import { PriceResolverService } from "./price-resolver.service.js";

/**
 * Same chainable-promise stub as pricing.service.spec.ts: every builder
 * method returns the same object, which IS the eventual result — so
 * `await tx.select(...).from(...).where(...)` resolves to `result` no matter
 * how many links the code under test chains.
 */
function chain(result: unknown) {
  const promise = Promise.resolve(result) as Promise<unknown> & Record<string, ReturnType<typeof vi.fn>>;
  for (const method of ["from", "where", "innerJoin", "leftJoin"]) {
    promise[method] = vi.fn(() => promise);
  }
  return promise;
}

const DEFAULT_LIST_ID = "list-default";

/**
 * resolveMany calls tx.select() ONCE for productPrices always, and a SECOND
 * time for customerPrices only when a customerId was actually passed in —
 * so the call sequence to mock depends on that, not just on which rows a
 * test wants back. `expectCustomerPriceQuery` mirrors whichever the test is
 * about to pass to `resolveMany`.
 */
function makeTx(options: {
  customer?: { id: string; priceListId: string | null } | null;
  productPriceRows: unknown[];
  customerPriceRows?: unknown[];
  expectCustomerPriceQuery?: boolean;
}) {
  const sequence = options.expectCustomerPriceQuery
    ? [options.customerPriceRows ?? [], options.productPriceRows]
    : [options.productPriceRows];
  let callIndex = 0;

  return {
    query: {
      customers: { findFirst: vi.fn(async () => options.customer ?? null) },
      priceLists: { findFirst: vi.fn(async () => ({ id: DEFAULT_LIST_ID })) },
    },
    select: vi.fn(() => chain(sequence[callIndex++] ?? [])),
  };
}

describe("PriceResolverService.resolveMany", () => {
  const service = new PriceResolverService();

  it("resolves the base (untiered) price when no quantity is given", async () => {
    const tx = makeTx({
      productPriceRows: [
        { variantId: "v1", sellingPrice: "10.00", minSellingPrice: "5.00", purchasePrice: "6.00", minQuantity: "1" },
      ],
    });

    const [result] = await service.resolveMany(tx as never, { variantIds: ["v1"] });

    expect(result).toMatchObject({ unitPrice: "10.00", minSellingPrice: "5.00", source: "default" });
  });

  it("picks the higher-quantity tier once the requested quantity reaches it", async () => {
    const tx = makeTx({
      productPriceRows: [
        { variantId: "v1", sellingPrice: "10.00", minSellingPrice: "5.00", purchasePrice: "6.00", minQuantity: "1" },
        { variantId: "v1", sellingPrice: "8.50", minSellingPrice: null, purchasePrice: "6.00", minQuantity: "10" },
      ],
    });

    const belowTier = await service.resolveMany(tx as never, {
      variantIds: ["v1"],
      quantities: { v1: "9" },
    });
    expect(belowTier[0]?.unitPrice).toBe("10.00");

    const tx2 = makeTx({
      productPriceRows: [
        { variantId: "v1", sellingPrice: "10.00", minSellingPrice: "5.00", purchasePrice: "6.00", minQuantity: "1" },
        { variantId: "v1", sellingPrice: "8.50", minSellingPrice: null, purchasePrice: "6.00", minQuantity: "10" },
      ],
    });
    const atTier = await service.resolveMany(tx2 as never, {
      variantIds: ["v1"],
      quantities: { v1: "10" },
    });
    expect(atTier[0]?.unitPrice).toBe("8.50");
  });

  it("falls back to the base tier's floor when the selected tier has none of its own", async () => {
    const tx = makeTx({
      productPriceRows: [
        { variantId: "v1", sellingPrice: "10.00", minSellingPrice: "5.00", purchasePrice: "6.00", minQuantity: "1" },
        { variantId: "v1", sellingPrice: "8.50", minSellingPrice: null, purchasePrice: "6.00", minQuantity: "10" },
      ],
    });

    const [result] = await service.resolveMany(tx as never, {
      variantIds: ["v1"],
      quantities: { v1: "50" },
    });

    // Bulk tier answered the selling price, but the floor still comes from
    // tier 1 — a bulk discount must not also switch cost protection off.
    expect(result).toMatchObject({ unitPrice: "8.50", minSellingPrice: "5.00" });
  });

  it("a negotiated customer price wins outright, regardless of quantity tier", async () => {
    const tx = makeTx({
      customer: { id: "c1", priceListId: null },
      productPriceRows: [
        { variantId: "v1", sellingPrice: "10.00", minSellingPrice: "5.00", purchasePrice: "6.00", minQuantity: "1" },
        { variantId: "v1", sellingPrice: "8.50", minSellingPrice: null, purchasePrice: "6.00", minQuantity: "10" },
      ],
      customerPriceRows: [{ variantId: "v1", price: "7.00" }],
      expectCustomerPriceQuery: true,
    });

    const [result] = await service.resolveMany(tx as never, {
      variantIds: ["v1"],
      customerId: "c1",
      quantities: { v1: "50" },
    });

    expect(result).toMatchObject({ unitPrice: "7.00", source: "customer", minSellingPrice: "5.00" });
  });

  it("skips a variant that has no price on any tier reaching this quantity", async () => {
    const tx = makeTx({
      productPriceRows: [
        { variantId: "v1", sellingPrice: "8.50", minSellingPrice: null, purchasePrice: "6.00", minQuantity: "10" },
      ],
    });

    // Only a 10+ tier exists; buying 3 has nothing to price it with.
    const results = await service.resolveMany(tx as never, {
      variantIds: ["v1"],
      quantities: { v1: "3" },
    });

    expect(results).toHaveLength(0);
  });
});

describe("PriceResolverService.checkFloor", () => {
  const service = new PriceResolverService();

  it("allows a price at or above the floor", () => {
    const result = service.checkFloor({ unitPrice: "10.00", minSellingPrice: "8.00", canOverrideFloor: false });
    expect(result.allowed).toBe(true);
  });

  it("refuses a discounted price that lands below the floor without override", () => {
    const result = service.checkFloor({
      unitPrice: "10.00",
      discountPercent: "30",
      minSellingPrice: "8.00",
      canOverrideFloor: false,
    });
    expect(result.allowed).toBe(false);
  });

  it("allows the same below-floor price when override is granted", () => {
    const result = service.checkFloor({
      unitPrice: "10.00",
      discountPercent: "30",
      minSellingPrice: "8.00",
      canOverrideFloor: true,
    });
    expect(result.allowed).toBe(true);
  });
});
