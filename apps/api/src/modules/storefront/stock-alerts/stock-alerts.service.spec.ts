import { describe, expect, it } from "vitest";
import { backInStock } from "./stock-alerts.service.js";
import { SubscribeStockAlertSchema } from "./dto.js";

describe("backInStock", () => {
  const rows = [{ variantId: "a" }, { variantId: "b" }, { variantId: "c" }];

  it("keeps only variants whose storefront availability is no longer sold out", () => {
    const availability = new Map([
      ["a", { label: "OUT_OF_STOCK" as const }],
      ["b", { label: "LOW_STOCK" as const }],
      ["c", { label: "IN_STOCK" as const }],
    ]);
    expect(backInStock(rows, availability).map((r) => r.variantId)).toEqual(["b", "c"]);
  });

  it("does not fire for a variant the availability lookup did not return", () => {
    expect(backInStock(rows, new Map())).toEqual([]);
  });
});

describe("SubscribeStockAlertSchema", () => {
  const variantId = "11111111-1111-4111-8111-111111111111";

  it("lowercases the email so repeats collide on the unique index", () => {
    expect(SubscribeStockAlertSchema.parse({ variantId, email: "  Buyer@Example.COM " }).email).toBe("buyer@example.com");
  });

  it("treats an empty phone box as no phone", () => {
    expect(SubscribeStockAlertSchema.parse({ variantId, email: "a@b.co", phone: "" }).phone).toBeUndefined();
  });

  it("rejects a malformed phone and a malformed email", () => {
    expect(SubscribeStockAlertSchema.safeParse({ variantId, email: "a@b.co", phone: "12" }).success).toBe(false);
    expect(SubscribeStockAlertSchema.safeParse({ variantId, email: "nope" }).success).toBe(false);
  });
});
