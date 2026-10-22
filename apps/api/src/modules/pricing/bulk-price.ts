import { Money } from "@devsfleet/shared-utils";
import { createHash } from "node:crypto";

export const BULK_PRICE_FIELDS = ["sellingPrice", "purchasePrice", "minSellingPrice"] as const;
export type BulkPriceField = (typeof BULK_PRICE_FIELDS)[number];

/** Steps a result may be rounded to — what a shelf price actually ends in. */
export const BULK_PRICE_ROUNDING = ["none", "0.05", "0.25", "0.50", "1.00"] as const;
export type BulkPriceRounding = (typeof BULK_PRICE_ROUNDING)[number];

export interface BulkPriceChange {
  field: BulkPriceField;
  mode: "percent" | "amount";
  direction: "increase" | "decrease";
  /** A percent ("7.5") or an amount ("2.00"), as a decimal string. */
  value: string;
  rounding: BulkPriceRounding;
}

/** The current base-tier row, as stored. */
export interface CurrentPrices {
  sellingPrice: string;
  purchasePrice: string | null;
  minSellingPrice: string | null;
}

export type BulkPriceSkip =
  /** The chosen field has no value on this row — nothing to scale. */
  | "no_current_value"
  /** The change would take the price to zero or below. */
  | "not_positive"
  /** The change would push the selling price under its floor, or further below it. */
  | "below_floor"
  /** The current price only takes effect after today; re-pricing it today would be a backdate. */
  | "scheduled";

export interface BulkPriceOutcome {
  old: string;
  new: string;
  /** All three fields as they would be written. */
  next: CurrentPrices;
  unchanged: boolean;
  belowFloor: boolean;
  /** Selling under cost. Shown, not refused — a clearance price is a decision. */
  belowCost: boolean;
  /** Set when this line will NOT be written, and why. */
  skip: BulkPriceSkip | null;
}

/** Half-up to a multiple of `step`, entirely in scaled integers. */
export function roundToStep(amount: Money.Minor4, rounding: BulkPriceRounding): Money.Minor4 {
  if (rounding === "none") return amount;
  const step = Money.toMinor(rounding);
  return Money.divideRoundHalfUp(amount, step) * step;
}

/**
 * One variant's prices after the change, and whether it may be written.
 *
 * Pure, so the preview and the apply cannot disagree: both run every row
 * through this, and the apply re-runs it against the rows as they are at
 * that moment, not as they were when the preview was drawn.
 */
export function evaluateBulkPrice(
  current: CurrentPrices,
  change: BulkPriceChange,
  options: { allowBelowFloor: boolean },
): BulkPriceOutcome {
  const oldRaw = current[change.field];
  const base: Omit<BulkPriceOutcome, "skip"> = {
    old: oldRaw ?? "",
    new: oldRaw ?? "",
    next: { ...current },
    unchanged: true,
    belowFloor: false,
    belowCost: false,
  };
  if (oldRaw === null) return { ...base, skip: "no_current_value" };

  const old = Money.toMinor(oldRaw);
  const delta =
    change.mode === "percent" ? Money.percentOf(old, change.value) : Money.toMinor(change.value);
  const moved = change.direction === "increase" ? Money.add(old, delta) : Money.subtract(old, delta);
  const result = roundToStep(moved, change.rounding);

  const newValue = Money.toDecimalString(result, 4);
  const next: CurrentPrices = { ...current, [change.field]: newValue };

  const selling = Money.toMinor(next.sellingPrice);
  const floor = next.minSellingPrice === null ? null : Money.toMinor(next.minSellingPrice);
  const cost = next.purchasePrice === null ? null : Money.toMinor(next.purchasePrice);

  const outcome = {
    old: Money.toDecimalString(old, 4),
    new: newValue,
    next,
    unchanged: result === old,
    belowFloor: floor !== null && selling < floor,
    belowCost: cost !== null && selling < cost,
  };

  // A purchase price or floor of zero is legal; a selling price of zero is not.
  const mustBePositive = change.field === "sellingPrice";
  if (mustBePositive ? !Money.isPositive(result) : Money.isNegative(result)) {
    return { ...outcome, skip: "not_positive" };
  }
  // Refused only when THIS change pushes the price under its floor or further
  // below it — a cut to the selling price, or a raise of the floor. A line
  // already under its floor that is being raised, or whose cost is moving,
  // is no worse for the change; it is written and still flagged.
  const worsens =
    (change.field === "sellingPrice" && result < old) ||
    (change.field === "minSellingPrice" && result > old);
  if (outcome.belowFloor && worsens && !outcome.unchanged && !options.allowBelowFloor) {
    return { ...outcome, skip: "below_floor" };
  }
  return { ...outcome, skip: null };
}

/**
 * Identifies exactly which rows a preview showed and what they held. Apply
 * recomputes it and refuses on a mismatch, so a preview left open while
 * someone else re-prices, or a filter whose product set moved, cannot apply
 * to rows the user never saw.
 */
export function bulkPriceFingerprint(
  rows: Array<{ priceId: string; current: CurrentPrices }>,
): string {
  const hash = createHash("sha256");
  for (const row of [...rows].sort((a, b) => a.priceId.localeCompare(b.priceId))) {
    hash.update(
      `${row.priceId}|${row.current.sellingPrice}|${row.current.purchasePrice ?? ""}|${row.current.minSellingPrice ?? ""}\n`,
    );
  }
  return hash.digest("hex").slice(0, 32);
}
