import { DEFAULT_TENANT_SETTINGS } from "@devsfleet/shared-types";
import { Money } from "@devsfleet/shared-utils";

/**
 * Display helpers.
 *
 * Every figure on this screen comes through here, and every one of them
 * originates as a `Minor4` bigint from @devsfleet/shared-utils. Nothing in the
 * POS ever does arithmetic on a `number` — a receipt whose lines do not sum to
 * its total is the one bug a cashier cannot talk their way out of.
 */

export const CURRENCY = DEFAULT_TENANT_SETTINGS.currency.base;
export const DECIMALS = DEFAULT_TENANT_SETTINGS.currency.decimals;
export const TAX = DEFAULT_TENANT_SETTINGS.tax;

/** "1,234.50" — no currency code, for use in a column that already has a header. */
export function amount(value: Money.Minor4): string {
  const plain = Money.toDecimalString(value, DECIMALS);
  const [whole = "0", fraction] = plain.replace("-", "").split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sign = plain.startsWith("-") ? "-" : "";
  return fraction ? `${sign}${grouped}.${fraction}` : `${sign}${grouped}`;
}

/** "AED 1,234.50" — for a total that stands alone. */
export function money(value: Money.Minor4): string {
  return `${CURRENCY} ${amount(value)}`;
}

/**
 * Quantities print without trailing zeros: "50", not "50.0000". A cashier
 * reading "50.0000 pcs" has to stop and parse it, and 2.5 metres of cable still
 * has to render as "2.5".
 */
export function quantity(value: string | number): string {
  const text = typeof value === "number" ? String(value) : value;
  if (!text.includes(".")) return text;
  return text.replace(/\.?0+$/, "");
}

/** Parse keypad or field input. Returns null on anything that is not a number. */
export function parseAmount(input: string): Money.Minor4 | null {
  const cleaned = input.replace(/[^0-9.-]/g, "");
  if (cleaned === "" || cleaned === "." || cleaned === "-") return null;
  try {
    return Money.toMinor(cleaned);
  } catch {
    return null;
  }
}

/**
 * Cash rounding for the drawer.
 *
 * The UAE withdrew the 1 and 5 fils coins, so the smallest cash a customer can
 * actually hand over is 25 fils. Card and transfer settle to the exact figure;
 * only physical cash rounds. Getting this wrong means a drawer that never
 * balances by a few fils a day.
 */
export function roundCash(value: Money.Minor4): Money.Minor4 {
  const step = Money.toMinor("0.25");
  return Money.divideRoundHalfUp(value, step) * step;
}
