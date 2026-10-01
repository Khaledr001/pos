import { DEFAULT_SHIPPING_RATES } from "@devsfleet/shared-types";
import { Money } from "@devsfleet/shared-utils";
import { describe, expect, it } from "vitest";
import { courierQuote, pickupSlots } from "./delivery.js";

describe("courierQuote", () => {
  const base = {
    rates: DEFAULT_SHIPPING_RATES,
    emirate: "DUBAI" as const,
    weightKg: Money.toMinor("3"),
    goodsNetAfterDiscount: Money.toMinor("100"),
    hasPickupOnlyItems: false,
    freeShipping: false,
    deliveryConfigured: true,
  };
  const fee = (overrides: Partial<typeof base>) => Money.toDecimalString(courierQuote({ ...base, ...overrides }).fee, 2);

  it("charges the base fee up to the base weight", () => {
    expect(fee({})).toBe("20.00");
    expect(fee({ weightKg: Money.toMinor("5") })).toBe("20.00");
  });

  it("charges each STARTED kilogram above it", () => {
    expect(fee({ weightKg: Money.toMinor("5.2") })).toBe("22.00");
    expect(fee({ weightKg: Money.toMinor("7") })).toBe("24.00");
  });

  it("is free at the threshold, measured after the discount", () => {
    expect(fee({ goodsNetAfterDiscount: Money.toMinor("300") })).toBe("0.00");
    expect(fee({ goodsNetAfterDiscount: Money.toMinor("299.99") })).toBe("20.00");
  });

  it("is free with a free-shipping code", () => {
    expect(fee({ freeShipping: true })).toBe("0.00");
  });

  it.each([
    ["no address", { emirate: undefined }, "NO_ADDRESS"],
    ["pickup-only goods", { hasPickupOnlyItems: true }, "PICKUP_ONLY_ITEMS"],
    ["too heavy", { weightKg: Money.toMinor("30.5") }, "OVERWEIGHT"],
    ["no delivery line configured", { deliveryConfigured: false }, "NOT_OFFERED"],
  ])("is unavailable for %s", (_label, overrides, reason) => {
    expect(courierQuote({ ...base, ...overrides })).toMatchObject({ available: false, reason, fee: 0n });
  });

  it("is unavailable to an emirate whose rate is switched off", () => {
    const rates = DEFAULT_SHIPPING_RATES.map((r) => (r.emirate === "DUBAI" ? { ...r, active: false } : r));
    expect(courierQuote({ ...base, rates }).reason).toBe("EMIRATE_NOT_SERVED");
  });
});

describe("pickupSlots", () => {
  const config = { slotMinutes: 120, leadTimeHours: 2, daysAhead: 2, opensAt: "08:00", closesAt: "20:00" };

  it("starts at least the lead time from now, in the shop's own timezone", () => {
    // 09:30 in Dubai (UTC+4). Earliest slot is 12:00 local.
    const slots = pickupSlots(new Date("2026-10-01T05:30:00Z"), config, "Asia/Dubai");
    expect(slots[0]).toMatchObject({ start: "2026-10-01T08:00:00.000Z", label: "Thu 1 Oct, 12:00–14:00" });
  });

  it("rolls to the next day once today is over, and covers daysAhead days", () => {
    const slots = pickupSlots(new Date("2026-10-01T15:30:00Z"), config, "Asia/Dubai"); // 19:30 local
    const days = new Set(slots.map((s) => s.label.split(",")[0]));
    expect(slots[0]!.label).toBe("Fri 2 Oct, 08:00–10:00");
    expect(days.size).toBe(2);
  });

  it("never offers a slot that runs past closing", () => {
    const slots = pickupSlots(new Date("2026-10-01T03:00:00Z"), { ...config, slotMinutes: 90 }, "Asia/Dubai");
    expect(slots.every((s) => !s.label.endsWith("20:30"))).toBe(true);
  });
});
