import { isValidTrn, normalizeTrn, type TenantSettings } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";

/**
 * Is this business a UAE one? The UAE's VAT and e-invoicing rules apply to it,
 * and its Tax Registration Number has a fixed shape — other countries' tax ids
 * differ, so they are not held to it.
 *
 * Timezone first (it is where the business sits), then books currency: the
 * same order the online store uses to pick a region.
 */
export function isUaeTenant(settings: Pick<TenantSettings, "currency" | "locale">): boolean {
  if (settings.locale.timezone === "Asia/Dubai") return true;
  return settings.currency.base === "AED";
}

/**
 * A field-level validation failure raised from a service. The exception filter
 * turns it into `details: { "<path>": ["<message>"] }`, the shape the admin
 * forms already render for a schema failure.
 *
 * An AppError, not a ZodError, on purpose: the offline sync classifies a
 * business refusal (AppError) as permanent and a stray exception as "try
 * again later", so a till that pushed an invalid TRN is told no once instead
 * of retrying it forever. Needed at all because tenant-dependent rules (is a
 * TRN required to be 15 digits here?) cannot live in a static schema.
 */
export function fieldError(path: string, message: string): AppError {
  return new AppError(ERROR_CODES.VALIDATION_FAILED, message, { fields: { [path]: [message] } });
}

/**
 * Validate (and normalise) a tax registration number a staff member typed.
 *
 * Blank is allowed — most customers are not businesses. A UAE tenant's TRN
 * must be 15 digits starting 100; elsewhere only a sane shape is demanded.
 * Spaces and dashes are removed; letters upper-cased outside the UAE.
 */
export function checkedTaxId(
  value: string | null | undefined,
  settings: Pick<TenantSettings, "currency" | "locale">,
  path: string,
): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  if (isUaeTenant(settings)) {
    if (!isValidTrn(raw)) throw fieldError(path, "A UAE TRN is 15 digits starting with 100");
    return normalizeTrn(raw);
  }
  const compact = raw.replace(/[\s-]/g, "");
  if (!/^[A-Za-z0-9]{5,20}$/.test(compact)) {
    throw fieldError(path, "Enter a valid tax registration number (5–20 letters or digits)");
  }
  return compact.toUpperCase();
}
