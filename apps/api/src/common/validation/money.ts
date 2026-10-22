import { Money } from "@devsfleet/shared-utils";
import { z } from "zod";

const DECIMAL = /^-?(?:\d+(?:\.\d{0,4})?|\.\d{1,4})$/;

/**
 * A money amount in a request body or query, validated and handed to the
 * service as a canonical decimal STRING ("12.5000") — never a JS number.
 *
 * `z.coerce.number()` turned "0.1" into a float before any service saw it,
 * and the rule is that money never passes through one (CLAUDE.md rule 1).
 * Strings are what the admin panel sends. Numbers are still accepted because
 * the POS and older clients send them; one is read through its shortest
 * decimal form, so `0.1` is 0.1 and not 0.1000000000000000055.
 *
 * More than four decimal places is refused rather than silently cut: that is
 * as fine as a DECIMAL(12,4) column goes, and a figure that does not fit is a
 * typo or a float that should never have been sent.
 */
export function zMoney(
  options: {
    /** Refuse zero as well as negatives. Pass a string for a custom message. */
    positive?: boolean | string;
    /** Allow a negative amount. Off by default — almost no money field may go below zero. */
    allowNegative?: boolean;
  } = {},
) {
  return z.union([z.string(), z.number()]).transform((value, ctx): string => {
    const raw = typeof value === "number" ? numberToPlain(value) : value.trim();
    if (raw === null || !DECIMAL.test(raw)) {
      ctx.addIssue({
        code: "custom",
        message: "Enter an amount with at most 4 decimal places, e.g. 12.50",
      });
      return z.NEVER;
    }
    const minor = Money.toMinor(raw);
    if (!options.allowNegative && Money.isNegative(minor)) {
      ctx.addIssue({ code: "custom", message: "The amount cannot be negative" });
      return z.NEVER;
    }
    if (options.positive && !Money.isPositive(minor)) {
      ctx.addIssue({
        code: "custom",
        message: typeof options.positive === "string" ? options.positive : "The amount must be more than zero",
      });
      return z.NEVER;
    }
    return Money.toDecimalString(minor, 4);
  });
}

/** `0.1` → "0.1"; a float carrying noise past four places is rounded to four. */
function numberToPlain(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  const shortest = String(value);
  if (/e/i.test(shortest)) return value.toFixed(4);
  const [, frac = ""] = shortest.split(".");
  return frac.length <= 4 ? shortest : value.toFixed(4);
}

/** The canonical zero, for `.default()`s. */
export const ZERO_MONEY = "0.0000";
