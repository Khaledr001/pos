import { schema, sql, type Transaction } from "@devsfleet/db";
import { AppError, ERROR_CODES, Money } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { RequestContext } from "../../../common/context/request-context.js";

export interface CouponEffect {
  couponId: string;
  code: string;
  /** Applied to every goods line, never to delivery. "0" for a free-shipping code. */
  discountPercent: string;
  freeShipping: boolean;
}

/**
 * Online promo codes.
 *
 * A percentage, applied per goods line. Not a document-level amount, and that
 * is a constraint, not a preference: when the order is handed over, the POS
 * turns it into a sale through SalesService, which reproduces line discount
 * percentages exactly and nothing else. A fixed "AED 20 off" spread across
 * lines would not survive that trip to the fils, so `fixed` codes are refused
 * online until the sale can carry a line discount amount.
 */
@Injectable()
export class CouponsService {
  async evaluate(tx: Transaction, code: string, goodsNetSubtotal: bigint): Promise<CouponEffect> {
    const coupon = await tx.query.coupons.findFirst({
      where: (t, { eq: e }) => e(t.code, code.trim().toUpperCase()),
    });
    const now = new Date();
    if (!coupon || !coupon.isActive) throw invalid("This promo code is not valid.");
    if ((coupon.validFrom && coupon.validFrom > now) || (coupon.validTo && coupon.validTo < now)) {
      throw invalid("This promo code has expired.");
    }
    if (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses) {
      throw invalid("This promo code has been fully used.");
    }
    if (coupon.type === "fixed") throw invalid("This promo code cannot be used online.");

    const minimum = Money.toMinor(coupon.minSubtotal);
    if (goodsNetSubtotal < minimum) {
      const { tenantSettings } = RequestContext.requireStorefront();
      throw invalid(
        `Spend at least ${Money.formatMoney(minimum, { currency: tenantSettings.currency.base })} (excl. VAT) to use this code.`,
      );
    }

    return {
      couponId: coupon.id,
      code: coupon.code,
      discountPercent: coupon.type === "percent" ? Money.toDecimalString(Money.min(Money.toMinor(coupon.value), Money.toMinor("100")), 2) : "0",
      freeShipping: coupon.type === "free_shipping",
    };
  }

  /** Inside the order transaction. The conditional update is what enforces maxUses under concurrency. */
  async redeem(tx: Transaction, couponId: string): Promise<void> {
    const updated = await tx
      .update(schema.coupons)
      .set({ usedCount: sql`${schema.coupons.usedCount} + 1` })
      .where(sql`${schema.coupons.id} = ${couponId} AND (${schema.coupons.maxUses} IS NULL OR ${schema.coupons.usedCount} < ${schema.coupons.maxUses})`)
      .returning({ id: schema.coupons.id });
    if (updated.length !== 1) throw invalid("This promo code has been fully used.");
  }
}

function invalid(message: string): AppError {
  return new AppError(ERROR_CODES.COUPON_INVALID, message);
}
