import { Global, Injectable, Module } from '@nestjs/common';
import { ApiError } from '../../common/api-error.js';
import { formatAed, roundFils } from '../../common/money.js';
import type { Coupon } from '../../generated/prisma/client.js';
import { PrismaService, Tx } from '../../prisma/prisma.service.js';

export interface CouponResult {
  coupon: Coupon;
  discountNetFils: number;
  freeShipping: boolean;
}

/** Website-owned promotions. They reach the POS as a discount line on the order. */
@Injectable()
export class PromotionsService {
  constructor(private readonly prisma: PrismaService) {}

  async evaluate(code: string, subtotalNetFils: number, tx?: Tx): Promise<CouponResult> {
    const coupon = await (tx ?? this.prisma).coupon.findUnique({
      where: { code: code.trim().toUpperCase() },
    });
    const now = new Date();
    if (!coupon || !coupon.active) {
      throw ApiError.badRequest('COUPON_INVALID', 'This promo code is not valid');
    }
    if ((coupon.validFrom && coupon.validFrom > now) || (coupon.validTo && coupon.validTo < now)) {
      throw ApiError.badRequest('COUPON_EXPIRED', 'This promo code has expired');
    }
    if (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses) {
      throw ApiError.badRequest('COUPON_EXHAUSTED', 'This promo code has been fully used');
    }
    if (subtotalNetFils < coupon.minSubtotalFils) {
      throw ApiError.badRequest(
        'COUPON_MIN_SUBTOTAL',
        `Spend at least ${formatAed(coupon.minSubtotalFils)} (excl. VAT) to use this code`,
      );
    }

    let discountNetFils = 0;
    if (coupon.type === 'PERCENT') {
      discountNetFils = roundFils((subtotalNetFils * Math.min(coupon.value, 100)) / 100);
    } else if (coupon.type === 'FIXED') {
      discountNetFils = Math.min(coupon.value, subtotalNetFils);
    }
    return { coupon, discountNetFils, freeShipping: coupon.type === 'FREE_SHIPPING' };
  }

  /** Called inside the order transaction; the conditional update enforces maxUses. */
  async redeem(tx: Tx, couponId: string) {
    const res = await tx.$executeRaw`
      UPDATE coupons SET "usedCount" = "usedCount" + 1
      WHERE id = ${couponId}::uuid AND ("maxUses" IS NULL OR "usedCount" < "maxUses")`;
    if (res !== 1) {
      throw ApiError.conflict('COUPON_EXHAUSTED', 'This promo code has been fully used');
    }
  }
}

@Global()
@Module({ providers: [PromotionsService], exports: [PromotionsService] })
export class PromotionsModule {}
