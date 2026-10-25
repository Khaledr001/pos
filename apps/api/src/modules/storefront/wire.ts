import { DEFAULT_REGION, ZONE_CODE, type StorefrontRegion } from "@devsfleet/shared-types";
import { normalizePhone } from "@devsfleet/shared-utils";
import { z } from "zod";
import { RequestContext } from "../../common/context/request-context.js";

/**
 * The storefront's wire vocabulary is UPPERCASE ("COURIER", "PENDING_PAYMENT")
 * because that is what the shop's pages are written against; the POS stores
 * lowercase. The names are otherwise identical, so the mapping is exactly
 * this and nothing more — no table to fall out of step.
 */
export const toWire = <T extends string>(value: T): Uppercase<T> => value.toUpperCase() as Uppercase<T>;

/** Accept either case from a client, store lowercase. */
export const wireEnum = <const T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .transform((v) => v.toLowerCase())
    .pipe(z.enum(values as unknown as [T[number], ...T[number][]]));

/**
 * The region of the shop this request is on. Schemas are static but the
 * validation rules are per tenant, so they read the region the guard already
 * put on the request. Outside a storefront request (a unit test, a script) there
 * is none, and the UAE rules the shop launched with apply.
 */
const requestRegion = (): StorefrontRegion => RequestContext.get()?.storefront?.settings.region ?? DEFAULT_REGION;

/**
 * A phone number in the shop's country, stored E.164 — the same form the
 * WhatsApp bot matches on. A number already carrying another country code is
 * kept as typed. UAE numbers keep their exact-length rule.
 */
export const shopperPhone = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const { callingCode } = requestRegion();
    const normalized = normalizePhone(value, callingCode);
    const local = normalized?.startsWith(`+${callingCode}`) && callingCode === "971";
    const valid = normalized && (local ? /^\+971\d{8,9}$/.test(normalized) : /^\+\d{8,15}$/.test(normalized));
    if (!valid) {
      ctx.addIssue({ code: "custom", message: `Enter a phone number like +${callingCode}501234567` });
      return z.NEVER;
    }
    return normalized;
  });

/**
 * A business tax registration number. The UAE's TRN is exactly 15 digits
 * starting 100; every other region gets a lenient shape, because their formats
 * differ and an over-strict rule would stop a real company from applying.
 */
export const shopperTaxId = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const { country, taxIdLabel } = requestRegion();
    const compact = v.replace(/[\s-]/g, "");
    const valid = country === "AE" ? /^100\d{12}$/.test(compact) : /^[A-Za-z0-9]{5,20}$/.test(compact);
    if (!valid) {
      ctx.addIssue({
        code: "custom",
        message: country === "AE" ? "A TRN is 15 digits starting with 100" : `Enter a valid ${taxIdLabel} (5–20 letters or digits)`,
      });
      return z.NEVER;
    }
    return country === "AE" ? compact : compact.toUpperCase();
  });

/** A delivery zone code, checked against the zones the shop's region defines. */
export const emirate = z
  .string()
  .regex(ZONE_CODE, "Choose a valid delivery zone")
  .superRefine((code, ctx) => {
    const { zones, zoneLabel } = requestRegion();
    if (!zones.some((z) => z.code === code)) {
      ctx.addIssue({ code: "custom", message: `Choose a valid ${zoneLabel.toLowerCase()}` });
    }
  });

export const AddressSchema = z.object({
  label: z.string().trim().max(60).optional(),
  fullName: z.string().trim().min(2).max(120),
  phone: shopperPhone,
  emirate,
  area: z.string().trim().min(2).max(120),
  street: z.string().trim().min(2).max(200),
  building: z.string().trim().max(120).optional(),
  landmark: z.string().trim().max(200).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});
export type AddressInput = z.infer<typeof AddressSchema>;
