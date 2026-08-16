/**
 * Exact decimal money arithmetic.
 *
 * Every monetary column in the database is DECIMAL(12,4). JavaScript `number`
 * is IEEE-754 binary floating point and cannot represent 0.1 exactly, so
 * `0.1 + 0.2 !== 0.3`. On a single line item that is invisible; across a
 * 40-line wholesale invoice with 5% VAT it produces a receipt whose lines do
 * not add up to its total, and a cashier who has to explain a one-fils gap to
 * a customer.
 *
 * So: amounts are carried as `bigint` scaled by 10^4 ("minor4"). All arithmetic
 * is integer arithmetic. Conversion to `number` happens exactly once, at the
 * edge, for display.
 *
 * The database driver is configured to hand DECIMAL columns back as strings for
 * the same reason — see packages/db/src/client.ts.
 */

export const MONEY_SCALE = 4;
const SCALE_FACTOR = 10_000n; // 10 ** MONEY_SCALE

/** An amount in units of 1/10000. `12.3400` is `123400n`. */
export type Minor4 = bigint;

/** Anything we are willing to accept as money on the way in. */
export type MoneyInput = string | number | bigint;

// -----------------------------------------------------------------------------
// Conversion
// -----------------------------------------------------------------------------

/**
 * Parse a decimal string/number into scaled integer units.
 *
 * Strings are parsed textually — never via `parseFloat` — so a value that came
 * straight out of Postgres as "1234.5678" survives byte-exact. More than 4
 * decimal places is truncated toward zero, matching what Postgres does when it
 * stores into DECIMAL(12,4).
 */
export function toMinor(value: MoneyInput): Minor4 {
  if (typeof value === "bigint") return value;

  const raw = typeof value === "number" ? numberToDecimalString(value) : value.trim();
  if (raw === "" || raw === "-" || raw === "+") return 0n;

  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(raw);
  if (!match) {
    throw new TypeError(`Not a decimal money value: ${JSON.stringify(value)}`);
  }

  const [, sign = "", whole = "", frac = ""] = match;
  const paddedFrac = frac.padEnd(MONEY_SCALE, "0").slice(0, MONEY_SCALE);
  const digits = `${whole || "0"}${paddedFrac}`;
  const magnitude = BigInt(digits);

  return sign === "-" ? -magnitude : magnitude;
}

/**
 * Render scaled units as a plain decimal string with exactly `decimals` places.
 * This is what gets written back to a DECIMAL column and what gets printed.
 */
export function toDecimalString(amount: Minor4, decimals: number = MONEY_SCALE): string {
  if (decimals < 0 || decimals > MONEY_SCALE) {
    throw new RangeError(`decimals must be between 0 and ${MONEY_SCALE}`);
  }

  const rounded = decimals === MONEY_SCALE ? amount : roundTo(amount, decimals);
  const negative = rounded < 0n;
  const magnitude = negative ? -rounded : rounded;

  const whole = magnitude / SCALE_FACTOR;
  const frac = (magnitude % SCALE_FACTOR).toString().padStart(MONEY_SCALE, "0");
  const shown = decimals === 0 ? "" : `.${frac.slice(0, decimals)}`;

  return `${negative ? "-" : ""}${whole}${shown}`;
}

/**
 * For display and for JSON that a chart or a total-in-a-header consumes.
 * Lossy past ~9 trillion; monetary values in this system never get near that.
 */
export function toNumber(amount: Minor4, decimals: number = 2): number {
  return Number(toDecimalString(amount, decimals));
}

// -----------------------------------------------------------------------------
// Arithmetic
// -----------------------------------------------------------------------------

export const ZERO: Minor4 = 0n;

export function add(...amounts: Minor4[]): Minor4 {
  return amounts.reduce<bigint>((sum, a) => sum + a, 0n);
}

export function subtract(a: Minor4, b: Minor4): Minor4 {
  return a - b;
}

export function negate(a: Minor4): Minor4 {
  return -a;
}

export function abs(a: Minor4): Minor4 {
  return a < 0n ? -a : a;
}

/**
 * Multiply money by a plain quantity (which may itself have up to 4 decimals,
 * e.g. 2.5 metres of cable). Both operands are scaled, so the product is scaled
 * twice and must be divided back down once, with rounding.
 */
export function multiplyByQuantity(amount: Minor4, quantity: MoneyInput): Minor4 {
  const q = toMinor(quantity);
  return divideRoundHalfUp(amount * q, SCALE_FACTOR);
}

/** Multiply by a percentage, e.g. `percentOf(total, 5)` for 5% VAT. */
export function percentOf(amount: Minor4, percent: MoneyInput): Minor4 {
  const p = toMinor(percent);
  return divideRoundHalfUp(amount * p, SCALE_FACTOR * 100n);
}

/** Divide by a plain (unscaled) integer count, e.g. splitting a bill 3 ways. */
export function divideBy(amount: Minor4, divisor: number): Minor4 {
  if (divisor === 0) throw new RangeError("Division by zero");
  return divideRoundHalfUp(amount, BigInt(divisor));
}

// -----------------------------------------------------------------------------
// Rounding
// -----------------------------------------------------------------------------

/**
 * Half-up away from zero, the convention used on UAE tax invoices.
 * Banker's rounding would be wrong here: it is not what a customer checking the
 * receipt with a calculator expects.
 */
export function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError("Division by zero");

  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;

  const quotient = n / d;
  const remainder = n % d;
  const roundUp = remainder * 2n >= d;
  const magnitude = roundUp ? quotient + 1n : quotient;

  return negative ? -magnitude : magnitude;
}

/** Round a scaled amount to `decimals` places, still expressed at MONEY_SCALE. */
export function roundTo(amount: Minor4, decimals: number): Minor4 {
  if (decimals >= MONEY_SCALE) return amount;
  const step = 10n ** BigInt(MONEY_SCALE - decimals);
  return divideRoundHalfUp(amount, step) * step;
}

/**
 * Distribute an amount across `parts` without losing or inventing a fils.
 * The remainder is spread one minor unit at a time over the earliest parts, so
 * `allocate(toMinor("10"), 3)` gives 3.3334 / 3.3333 / 3.3333 — summing exactly
 * back to 10. Use for splitting an invoice-level discount over its lines.
 */
export function allocate(amount: Minor4, parts: number): Minor4[] {
  if (parts <= 0) throw new RangeError("parts must be > 0");

  const n = BigInt(parts);
  const base = amount / n;
  let remainder = amount - base * n;
  const step = remainder < 0n ? -1n : 1n;

  const result: Minor4[] = [];
  for (let i = 0; i < parts; i += 1) {
    if (remainder !== 0n) {
      result.push(base + step);
      remainder -= step;
    } else {
      result.push(base);
    }
  }
  return result;
}

/** Weighted variant — split by line subtotal rather than evenly. */
export function allocateByWeight(amount: Minor4, weights: Minor4[]): Minor4[] {
  const totalWeight = add(...weights);
  if (totalWeight === 0n) return allocate(amount, weights.length);

  const result: Minor4[] = [];
  let distributed = 0n;

  for (let i = 0; i < weights.length; i += 1) {
    const weight = weights[i] ?? 0n;
    if (i === weights.length - 1) {
      result.push(amount - distributed); // last part absorbs the rounding drift
    } else {
      const share = divideRoundHalfUp(amount * weight, totalWeight);
      result.push(share);
      distributed += share;
    }
  }
  return result;
}

// -----------------------------------------------------------------------------
// Comparison
// -----------------------------------------------------------------------------

export const isZero = (a: Minor4): boolean => a === 0n;
export const isNegative = (a: Minor4): boolean => a < 0n;
export const isPositive = (a: Minor4): boolean => a > 0n;
export const equals = (a: Minor4, b: Minor4): boolean => a === b;
export const lessThan = (a: Minor4, b: Minor4): boolean => a < b;
export const greaterThan = (a: Minor4, b: Minor4): boolean => a > b;
export const max = (a: Minor4, b: Minor4): Minor4 => (a > b ? a : b);
export const min = (a: Minor4, b: Minor4): Minor4 => (a < b ? a : b);

// -----------------------------------------------------------------------------
// Formatting
// -----------------------------------------------------------------------------

/** Locale-aware display string, e.g. "AED 1,234.56". Display only. */
export function formatMoney(
  amount: Minor4,
  options: { currency?: string; locale?: string; decimals?: number } = {},
): string {
  const { currency = "AED", locale = "en-AE", decimals = 2 } = options;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number(toDecimalString(amount, decimals)));
}

// -----------------------------------------------------------------------------
// Internal
// -----------------------------------------------------------------------------

/** Expand exponent notation ("1e-7") so the textual parser never sees an "e". */
function numberToDecimalString(value: number): string {
  if (!Number.isFinite(value)) {
    throw new TypeError(`Not a finite money value: ${value}`);
  }
  // 20 is the maximum toFixed accepts, and is well past our 4 places of interest.
  return value.toFixed(20).replace(/0+$/, "").replace(/\.$/, "");
}
