import {
  UAE_SUBDIVISIONS,
  ZONE_TO_UAE_SUBDIVISION,
  resolveTenantSettings,
  type PartyAddress,
  type TenantSettings,
} from "@devsfleet/shared-types";
import { fieldError, isUaeTenant } from "./tenant-region.js";

/** The emirate a staff member typed, as PINT AE's subdivision code: "dubai", "DXB" and "DUBAI" all mean DXB. */
export function uaeSubdivision(value: string): string | null {
  const v = value.trim().toUpperCase().replace(/\s+/g, "_");
  if ((UAE_SUBDIVISIONS as readonly string[]).includes(v)) return v;
  return ZONE_TO_UAE_SUBDIVISION[v] ?? null;
}

/**
 * A subdivision (emirate, region, state) as stored. In the UAE it must be one
 * of the seven emirates — PINT AE rejects anything else — and is normalised to
 * its code; elsewhere free text is kept as written.
 */
export function checkedSubdivision(
  value: string | null | undefined,
  country: string,
  path: string,
): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  if (country.toUpperCase() !== "AE") return raw;
  const code = uaeSubdivision(raw);
  if (!code) {
    throw fieldError(path, `Choose an emirate: ${UAE_SUBDIVISIONS.join(", ")}`);
  }
  return code;
}

/** A tenant's own structured address, validated the same way a customer's is. */
export function checkedLegalAddress(address: PartyAddress, path = "legalAddress"): PartyAddress {
  const country = address.countryCode.toUpperCase();
  const subdivision = checkedSubdivision(address.subdivision, country, `${path}.subdivision`);
  if (!subdivision) throw fieldError(`${path}.subdivision`, "Choose the emirate or region");
  return {
    line1: address.line1.trim(),
    ...(address.line2?.trim() ? { line2: address.line2.trim() } : {}),
    city: address.city.trim(),
    subdivision,
    ...(address.postalCode?.trim() ? { postalCode: address.postalCode.trim() } : {}),
    countryCode: country,
  };
}

/** The tenant settings a party check needs, read from whatever the caller already loaded. */
export function partySettings(stored: unknown): Pick<TenantSettings, "currency" | "locale"> {
  return resolveTenantSettings(stored);
}

export { isUaeTenant };
