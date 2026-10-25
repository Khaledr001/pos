import { REGION_PRESETS } from "@devsfleet/shared-types";
import { describe, expect, it } from "vitest";
import { assertZonesConsistent, defaultRegionCode, defaultShippingRates, regionPreset } from "./region.js";

describe("defaultRegionCode", () => {
  it("prefers the timezone, then the currency, then the UAE", () => {
    expect(defaultRegionCode("AED", "Asia/Riyadh")).toBe("SA");
    expect(defaultRegionCode("PKR", "UTC")).toBe("PK");
    expect(defaultRegionCode("USD", "Europe/Paris")).toBe("AE");
  });
});

describe("defaultShippingRates", () => {
  it("keeps the UAE launch rates", () => {
    const rates = defaultShippingRates(regionPreset("AE"));
    expect(rates).toHaveLength(7);
    expect(rates.find((r) => r.emirate === "DUBAI")?.baseFee).toBe("20.00");
  });

  it.each(Object.keys(REGION_PRESETS).filter((c) => c !== "AE"))("gives every %s zone one flat rate", (code) => {
    const region = regionPreset(code);
    const rates = defaultShippingRates(region);
    expect(rates.map((r) => r.emirate)).toEqual(region.zones.map((z) => z.code));
    expect(new Set(rates.map((r) => r.baseFee))).toEqual(new Set(["15.00"]));
  });
});

describe("assertZonesConsistent", () => {
  const region = regionPreset("SA");
  const rate = (emirate: string) => ({ emirate });

  it("accepts rates and branches inside the region", () => {
    expect(() => assertZonesConsistent(region, [rate("RIYADH")], [rate("MAKKAH")])).not.toThrow();
  });

  it("names a rate for a zone the region does not have", () => {
    expect(() => assertZonesConsistent(region, [rate("DUBAI")], [])).toThrow(/"DUBAI".*region/);
  });

  it("names a branch in a zone the region does not have", () => {
    expect(() => assertZonesConsistent(region, [], [rate("DUBAI")])).toThrow(/branch.*"DUBAI"/);
  });

  it("refuses two rates for one zone", () => {
    expect(() => assertZonesConsistent(region, [rate("RIYADH"), rate("RIYADH")], [])).toThrow(/two delivery rates/);
  });
});
