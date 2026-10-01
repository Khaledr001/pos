import { EMIRATES } from "@devsfleet/shared-types";
import { normalizePhone } from "@devsfleet/shared-utils";
import { z } from "zod";

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

/** UAE mobile or landline, stored E.164 — the same form the WhatsApp bot matches on. */
export const uaePhone = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const normalized = normalizePhone(value, "971");
    if (!normalized || !/^\+971\d{8,9}$/.test(normalized)) {
      ctx.addIssue({ code: "custom", message: "Enter a UAE number like +971501234567" });
      return z.NEVER;
    }
    return normalized;
  });

/** UAE Tax Registration Number: 15 digits, starting 100. */
export const uaeTrn = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^100\d{12}$/, "A TRN is 15 digits starting with 100"));

export const emirate = z.enum(EMIRATES);

export const AddressSchema = z.object({
  label: z.string().trim().max(60).optional(),
  fullName: z.string().trim().min(2).max(120),
  phone: uaePhone,
  emirate,
  area: z.string().trim().min(2).max(120),
  street: z.string().trim().min(2).max(200),
  building: z.string().trim().max(120).optional(),
  landmark: z.string().trim().max(200).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});
export type AddressInput = z.infer<typeof AddressSchema>;
