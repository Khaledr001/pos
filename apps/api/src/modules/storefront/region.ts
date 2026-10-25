import {
  DEFAULT_REGION_CODE,
  DEFAULT_SHIPPING_RATES,
  REGION_PRESETS,
  type ShippingRate,
  type StorefrontRegion,
} from "@devsfleet/shared-types";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";

/** Timezone first (it is what a business actually sits in), then books currency. */
const REGION_BY_TIMEZONE: Record<string, string> = {
  "Asia/Dubai": "AE",
  "Asia/Riyadh": "SA",
  "Asia/Qatar": "QA",
  "Asia/Kuwait": "KW",
  "Asia/Bahrain": "BH",
  "Asia/Muscat": "OM",
  "Asia/Karachi": "PK",
  "Asia/Dhaka": "BD",
};
const REGION_BY_CURRENCY: Record<string, string> = { AED: "AE", SAR: "SA", PKR: "PK", BDT: "BD" };

/** The preset a new store starts from, when the caller did not pick one. */
export function defaultRegionCode(currency: string, timezone: string): string {
  const code = REGION_BY_TIMEZONE[timezone] ?? REGION_BY_CURRENCY[currency] ?? DEFAULT_REGION_CODE;
  return code in REGION_PRESETS ? code : DEFAULT_REGION_CODE;
}

export function regionPreset(code: string): StorefrontRegion {
  const { label: _label, ...region } = REGION_PRESETS[code] ?? REGION_PRESETS[DEFAULT_REGION_CODE]!;
  return region;
}

/**
 * One delivery rate per zone. The UAE keeps the rates the shop launched with;
 * elsewhere there is no honest default, so every zone gets the same flat rate
 * for the owner to edit before turning delivery on.
 */
export function defaultShippingRates(region: StorefrontRegion): ShippingRate[] {
  if (region.country === "AE") return DEFAULT_SHIPPING_RATES.map((r) => ({ ...r }));
  return region.zones.map((zone) => ({
    emirate: zone.code,
    baseFee: "15.00",
    baseWeightKg: 5,
    perKgFee: "2.00",
    freeOver: null,
    maxWeightKg: 30,
    etaDays: 3,
    active: true,
  }));
}

/**
 * Delivery rates and branches name a zone by code, so they may only name zones
 * the region defines. Rejecting (rather than silently dropping) keeps an owner
 * who trims the zone list from losing a rate or a branch without noticing.
 */
export function assertZonesConsistent(
  region: StorefrontRegion,
  rates: readonly { emirate: string }[],
  branches: readonly { emirate: string }[],
): void {
  const known = new Set(region.zones.map((z) => z.code));
  const label = region.zoneLabel.toLowerCase();
  for (const rate of rates) {
    if (!known.has(rate.emirate)) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, `A delivery rate names the ${label} "${rate.emirate}", which is not in your list of ${label}s.`);
    }
  }
  const seen = new Set<string>();
  for (const rate of rates) {
    if (seen.has(rate.emirate)) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, `There are two delivery rates for the ${label} "${rate.emirate}".`);
    }
    seen.add(rate.emirate);
  }
  for (const branch of branches) {
    if (!known.has(branch.emirate)) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, `A branch is in the ${label} "${branch.emirate}", which is not in your list of ${label}s.`);
    }
  }
}
