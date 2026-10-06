import type { WebQuoteStatus } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";

/**
 * `quoted` past its validity date is `expired` to everyone who looks, whether
 * or not a sweep has written that down. Reading never needs a job to have run.
 */
export function effectiveStatus(status: WebQuoteStatus, validUntil: Date | null, now: Date): WebQuoteStatus {
  return status === "quoted" && validUntil !== null && validUntil.getTime() <= now.getTime() ? "expired" : status;
}

/** The shopper answers a quote that is on the table: quoted, and still valid. Nothing else. */
export function assertShopperMayRespond(status: WebQuoteStatus, validUntil: Date | null, now: Date): void {
  const effective = effectiveStatus(status, validUntil, now);
  if (effective === "expired") {
    throw new AppError(ERROR_CODES.QUOTE_EXPIRED, "This quote has expired. Request a new one and we will price it again.");
  }
  if (effective !== "quoted") {
    throw new AppError(ERROR_CODES.QUOTE_INVALID_STATUS, `A quote that is ${effective} cannot be accepted or declined.`);
  }
}

/** Staff may price (or re-price) a quote until the shopper has answered it. */
export function assertStaffMayPrice(status: WebQuoteStatus): void {
  if (status !== "requested" && status !== "quoted") {
    throw new AppError(ERROR_CODES.QUOTE_INVALID_STATUS, `A quote that is ${status} can no longer be priced.`);
  }
}

/** Staff can withdraw an open quote (decline) or lapse one that was sent (expire). */
export function assertStaffMayClose(status: WebQuoteStatus, to: "declined" | "expired"): void {
  const allowed: WebQuoteStatus[] = to === "declined" ? ["requested", "quoted"] : ["quoted"];
  if (!allowed.includes(status)) {
    throw new AppError(ERROR_CODES.QUOTE_INVALID_STATUS, `A quote that is ${status} cannot be marked ${to}.`);
  }
}
