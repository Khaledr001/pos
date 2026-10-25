import { DEFAULT_STOREFRONT_SETTINGS, type StorefrontSettings } from "@devsfleet/shared-types";
import { describe, expect, it } from "vitest";
import { RequestContext } from "../../common/context/request-context.js";
import { regionPreset } from "./region.js";
import { AddressSchema, emirate, shopperPhone, shopperTaxId } from "./wire.js";

/** Runs `fn` as a request to a shop in `country`. */
const inRegion = <T>(country: string, fn: () => T): T => {
  const settings: StorefrontSettings = { ...DEFAULT_STOREFRONT_SETTINGS, region: regionPreset(country) };
  return RequestContext.run({ requestId: "t", startedAt: 0, storefront: { settings } } as never, fn);
};

describe("shopperPhone", () => {
  it("keeps the UAE rules outside a request and for a UAE shop", () => {
    expect(shopperPhone.parse("050 123 4567")).toBe("+971501234567");
    expect(inRegion("AE", () => shopperPhone.parse("0501234567"))).toBe("+971501234567");
    expect(shopperPhone.safeParse("+97150").success).toBe(false);
  });

  it("uses the shop's own calling code", () => {
    expect(inRegion("SA", () => shopperPhone.parse("0501234567"))).toBe("+966501234567");
    expect(inRegion("PK", () => shopperPhone.parse("0300 1234567"))).toBe("+923001234567");
  });

  it("accepts an international number and rejects junk", () => {
    expect(inRegion("SA", () => shopperPhone.parse("+971501234567"))).toBe("+971501234567");
    expect(inRegion("SA", () => shopperPhone.safeParse("walk-in").success)).toBe(false);
    expect(inRegion("SA", () => shopperPhone.safeParse("+9665").success)).toBe(false);
  });
});

describe("shopperTaxId", () => {
  it("is the strict TRN for the UAE", () => {
    expect(shopperTaxId.parse("100 1234 5678 9012")).toBe("100123456789012");
    expect(shopperTaxId.safeParse("123").success).toBe(false);
  });

  it("is lenient elsewhere", () => {
    expect(inRegion("SA", () => shopperTaxId.parse("3000-1234-5678"))).toBe("300012345678");
    expect(inRegion("PK", () => shopperTaxId.safeParse("12").success)).toBe(false);
  });
});

describe("emirate (delivery zone)", () => {
  it("accepts only the region's zones", () => {
    expect(emirate.safeParse("DUBAI").success).toBe(true);
    expect(emirate.safeParse("RIYADH").success).toBe(false);
    expect(inRegion("SA", () => emirate.safeParse("RIYADH").success)).toBe(true);
    expect(inRegion("SA", () => emirate.safeParse("DUBAI").success)).toBe(false);
  });

  it("names the region's own word for a zone", () => {
    const result = inRegion("SA", () => emirate.safeParse("DUBAI"));
    expect(result.success ? "" : result.error.issues[0]?.message).toBe("Choose a valid region");
  });

  it("is checked inside an address", () => {
    const address = { fullName: "Sam Lee", phone: "0501234567", emirate: "RIYADH", area: "Olaya", street: "King Fahd Rd" };
    expect(inRegion("SA", () => AddressSchema.safeParse(address).success)).toBe(true);
    expect(AddressSchema.safeParse(address).success).toBe(false);
  });
});
