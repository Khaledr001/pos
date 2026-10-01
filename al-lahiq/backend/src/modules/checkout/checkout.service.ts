import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../../common/api-error.js';
import { money } from '../../common/money.js';
import { computeTotals } from '../../common/totals.js';
import type { Cart } from '../../generated/prisma/client.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { Emirate } from '../../generated/prisma/enums.js';
import { PrismaService, Tx } from '../../prisma/prisma.service.js';
import { CartService, PricedLine } from '../cart/cart.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { AfterCommit, OrdersService } from '../orders/orders.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { PromotionsService } from '../promotions/promotions.service.js';
import { CountersService } from '../settings/counters.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { ShippingService } from '../shipping/shipping.service.js';
import { PlaceOrderDto, QuoteDto } from './dto/checkout.dto.js';

interface Pricing {
  lines: PricedLine[];
  subtotalNetFils: number;
  discountNetFils: number;
  freeShipping: boolean;
  couponId: string | null;
  couponError: string | null;
  weightGrams: number;
  hasPickupOnly: boolean;
}

@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly carts: CartService,
    private readonly inventory: InventoryService,
    private readonly shipping: ShippingService,
    private readonly promotions: PromotionsService,
    private readonly payments: PaymentsService,
    private readonly orders: OrdersService,
    private readonly counters: CountersService,
    private readonly settings: SettingsService,
  ) {}

  private async price(cart: Cart, customerId: string | undefined, tx?: Tx): Promise<Pricing> {
    const { lines } = await this.carts.priced(cart.id, customerId, tx);
    const sellable = lines.filter((l) => l.price);
    const subtotalNetFils = sellable.reduce((s, l) => s + l.price!.lineNetFils, 0);

    let discountNetFils = 0;
    let freeShipping = false;
    let couponId: string | null = null;
    let couponError: string | null = null;
    if (cart.couponCode) {
      try {
        const r = await this.promotions.evaluate(cart.couponCode, subtotalNetFils, tx);
        discountNetFils = r.discountNetFils;
        freeShipping = r.freeShipping;
        couponId = r.coupon.id;
      } catch (err) {
        couponError = (err as Error).message;
      }
    }
    return {
      lines,
      subtotalNetFils,
      discountNetFils,
      freeShipping,
      couponId,
      couponError,
      weightGrams: sellable.reduce((s, l) => s + Math.round(l.item.variant.weightGrams * l.baseQty), 0),
      hasPickupOnly: sellable.some((l) => l.item.variant.product.pickupOnly),
    };
  }

  private totals(p: Pricing, shippingNetFils: number) {
    const sellable = p.lines.filter((l) => l.price);
    return computeTotals(
      sellable.map((l) => ({ lineNetFils: l.price!.lineNetFils, vatRateBps: l.price!.vatRateBps })),
      p.discountNetFils,
      shippingNetFils,
    );
  }

  /** Everything the checkout page needs: options, fees, totals and blocking issues. */
  async quote(cart: Cart, customerId: string | undefined, dto: QuoteDto) {
    const p = await this.price(cart, customerId);
    const method = dto.deliveryMethod ?? (p.hasPickupOnly ? 'PICKUP' : 'COURIER');

    const courier = await this.shipping.courierOption({
      emirate: dto.emirate,
      weightGrams: p.weightGrams,
      subtotalNetFils: p.subtotalNetFils - p.discountNetFils,
      hasPickupOnlyItems: p.hasPickupOnly,
      freeShipping: p.freeShipping,
    });
    const shippingNetFils = method === 'COURIER' && courier.available ? courier.feeNetFils : 0;
    const totals = this.totals(p, shippingNetFils);
    const issues = await this.carts.issues(p.lines, {
      pickupBranchId: method === 'PICKUP' ? dto.pickupBranchId : undefined,
    });

    return {
      deliveryMethod: method,
      itemCount: p.lines.filter((l) => l.price).length,
      weightKg: Math.ceil(p.weightGrams / 1000),
      courier: { ...courier, fee: money(courier.feeNetFils + Math.round(courier.feeNetFils * 0.05)) },
      pickupBranches: await this.shipping.pickupBranches(),
      couponCode: cart.couponCode,
      couponError: p.couponError,
      totals: {
        subtotalNet: money(totals.subtotalNetFils),
        discountNet: money(totals.discountNetFils),
        shippingNet: money(totals.shippingNetFils),
        vat: money(totals.vatFils),
        total: money(totals.totalFils),
      },
      paymentMethods: await this.payments.methods(totals.totalFils, method),
      issues,
      canPlace:
        p.lines.length > 0 &&
        issues.every((i) => i.code === 'PRICE_CHANGED') &&
        (method === 'PICKUP' || courier.available),
    };
  }

  async place(cart: Cart, customerId: string | undefined, dto: PlaceOrderDto) {
    // 1. Re-price outside the transaction. If anything changed since the
    //    customer last saw it, show them the new prices before charging.
    const preview = await this.price(cart, customerId);
    if (!preview.lines.length) throw ApiError.badRequest('CART_EMPTY', 'Your cart is empty');
    const changed = preview.lines.filter((l) => l.price && l.price.unitNetFils !== l.item.seenUnitNetFils);
    if (changed.length) {
      await this.prisma.$transaction((tx) => this.carts.acceptPrices(tx, preview.lines));
      throw new ApiError(HttpStatus.CONFLICT, 'PRICE_CHANGED', 'Some prices have changed. Please review your order.', {
        skus: changed.map((l) => l.item.variant.sku),
      });
    }
    if (preview.lines.some((l) => !l.price)) {
      throw ApiError.conflict('ITEM_UNAVAILABLE', 'Some items in your cart are no longer available');
    }
    if (cart.couponCode && preview.couponError) {
      throw ApiError.badRequest('COUPON_INVALID', preview.couponError);
    }

    const delivery = await this.resolveDelivery(dto, customerId, preview);
    const shippingNetFils = delivery.shippingNetFils;
    const previewTotals = this.totals(preview, shippingNetFils);
    if (dto.expectedTotalFils != null && dto.expectedTotalFils !== previewTotals.totalFils) {
      throw ApiError.conflict('TOTAL_CHANGED', 'Your order total has changed. Please review your order.', {
        totalFils: previewTotals.totalFils,
      });
    }
    await this.payments.assertAvailable(dto.paymentMethod, previewTotals.totalFils, dto.deliveryMethod);

    // 2. Place the order atomically: fresh prices, stock, coupon, cart.
    const result = await this.prisma.$transaction(
      async (tx) => {
        const claimed = await tx.cart.updateMany({
          where: { id: cart.id, status: 'ACTIVE' },
          data: { status: 'CONVERTED' },
        });
        if (claimed.count !== 1) {
          throw ApiError.conflict('CART_ALREADY_CHECKED_OUT', 'This cart has already been checked out');
        }

        const p = await this.price(cart, customerId, tx);
        const drift = p.lines.some((l, i) => l.price?.unitNetFils !== preview.lines[i]?.price?.unitNetFils);
        if (drift || p.lines.length !== preview.lines.length) {
          throw ApiError.conflict('PRICE_CHANGED', 'Some prices have changed. Please review your order.');
        }
        const totals = this.totals(p, shippingNetFils);

        const deductions = await this.inventory.deductForOrder(
          tx,
          p.lines.map((l) => ({ variantId: l.item.variantId, sku: l.item.variant.sku, baseQty: l.baseQty })),
          delivery.pickupBranchId ?? undefined,
        );
        if (p.couponId) await this.promotions.redeem(tx, p.couponId);

        const isCod = dto.paymentMethod === 'COD';
        const order = await tx.order.create({
          data: {
            orderNumber: await this.counters.orderNumber(tx),
            customerId: customerId ?? null,
            email: dto.contact.email,
            phone: dto.contact.phone,
            fullName: dto.contact.fullName,
            status: 'PENDING_PAYMENT',
            paymentStatus: 'PENDING',
            paymentMethod: dto.paymentMethod,
            deliveryMethod: dto.deliveryMethod,
            shippingAddress: (delivery.address as Prisma.InputJsonValue | null) ?? Prisma.DbNull,
            pickupBranchId: delivery.pickupBranchId,
            pickupSlotStart: delivery.slotStart,
            pickupSlotEnd: delivery.slotEnd,
            companyName: dto.companyName ?? null,
            trn: dto.trn ?? null,
            couponCode: p.couponId ? cart.couponCode : null,
            notes: dto.notes ?? null,
            subtotalNetFils: totals.subtotalNetFils,
            discountNetFils: totals.discountNetFils,
            shippingNetFils: totals.shippingNetFils,
            vatFils: totals.vatFils,
            totalFils: totals.totalFils,
            weightGrams: p.weightGrams,
            stockDeductions: deductions as unknown as Prisma.InputJsonValue,
            // COD orders go straight to PLACED (below); only card orders wait for payment.
            ...(dto.paymentMethod === 'COD'
              ? {}
              : { statusHistory: { create: { status: 'PENDING_PAYMENT' as const, actor: 'customer' } } }),
            lines: {
              create: p.lines.map((l, i) => {
                const pr = l.price!;
                return {
                  variantId: l.item.variantId,
                  sku: l.item.variant.sku,
                  name: variantDisplayName(l),
                  uom: l.item.uom,
                  quantity: new Prisma.Decimal(l.quantity),
                  unitNetFils: pr.unitNetFils,
                  unitRetailNetFils: pr.retailUnitNetFils,
                  priceListId: pr.priceListId,
                  priceListCode: pr.priceListCode,
                  priceVersion: pr.priceVersion,
                  vatRateBps: pr.vatRateBps,
                  lineNetFils: pr.lineNetFils,
                  lineVatFils: totals.lineVatFils[i],
                  lineTotalFils: pr.lineGrossFils,
                };
              }),
            },
          },
        });

        if (dto.saveAddress && customerId && dto.address && !dto.addressId) {
          await tx.address.create({ data: { customerId, ...dto.address } });
        }

        let after: AfterCommit | null = null;
        if (isCod) {
          await tx.payment.create({
            data: { orderId: order.id, provider: 'cod', method: 'COD', amountFils: order.totalFils, status: 'PENDING' },
          });
          after = await this.orders.markPlaced(tx, order.id, 'customer');
        }
        return { order, after };
      },
      { timeout: 20_000 },
    );

    if (result.after) await this.orders.flush(result.after);
    const { order } = result;
    const base = {
      orderId: order.id,
      orderNumber: order.orderNumber,
      trackingToken: order.trackingToken,
      total: money(order.totalFils),
    };
    if (dto.paymentMethod === 'COD') return { ...base, next: { type: 'confirmation' as const } };
    return { ...base, next: { type: 'redirect' as const, url: await this.payments.start(order.id) } };
  }

  private async resolveDelivery(dto: PlaceOrderDto, customerId: string | undefined, p: Pricing) {
    if (dto.deliveryMethod === 'PICKUP') {
      if (!dto.pickupBranchId || !dto.pickupSlotStart) {
        throw ApiError.badRequest('PICKUP_DETAILS_REQUIRED', 'Choose a branch and a pickup time');
      }
      const branch = await this.prisma.branch.findFirst({
        where: { id: dto.pickupBranchId, active: true, pickupEnabled: true },
      });
      if (!branch) throw ApiError.badRequest('BRANCH_INVALID', 'This branch is not available for pickup');
      const slotStart = new Date(dto.pickupSlotStart);
      if (!(await this.shipping.isValidSlot(slotStart))) {
        throw ApiError.badRequest('SLOT_INVALID', 'This pickup time is no longer available');
      }
      const { slotMinutes } = await this.settings.get('pickup');
      return {
        shippingNetFils: 0,
        address: null,
        pickupBranchId: branch.id,
        slotStart,
        slotEnd: new Date(slotStart.getTime() + slotMinutes * 60_000),
      };
    }

    let address: Record<string, unknown> | null = null;
    if (dto.addressId) {
      if (!customerId) throw ApiError.badRequest('ADDRESS_INVALID', 'Saved addresses require login');
      const saved = await this.prisma.address.findFirst({ where: { id: dto.addressId, customerId } });
      if (!saved) throw ApiError.badRequest('ADDRESS_INVALID', 'Address not found');
      const { id: _id, customerId: _c, createdAt: _a, updatedAt: _u, isDefault: _d, ...rest } = saved;
      address = rest;
    } else if (dto.address) {
      address = { ...dto.address };
    }
    if (!address) throw ApiError.badRequest('ADDRESS_REQUIRED', 'A delivery address is required');

    const courier = await this.shipping.courierOption({
      emirate: address.emirate as Emirate,
      weightGrams: p.weightGrams,
      subtotalNetFils: p.subtotalNetFils - p.discountNetFils,
      hasPickupOnlyItems: p.hasPickupOnly,
      freeShipping: p.freeShipping,
    });
    if (!courier.available) {
      const messages: Record<string, string> = {
        PICKUP_ONLY_ITEMS: 'Some items can only be collected from the store',
        EMIRATE_NOT_SERVED: 'We do not deliver to this emirate yet',
        OVERWEIGHT: 'This order is too heavy for courier delivery. Please choose store pickup.',
        NO_ADDRESS: 'A delivery address is required',
      };
      throw ApiError.badRequest(`COURIER_${courier.reason}`, messages[courier.reason!] ?? 'Courier delivery is not available');
    }
    return { shippingNetFils: courier.feeNetFils, address, pickupBranchId: null, slotStart: null, slotEnd: null };
  }
}

function variantDisplayName(l: PricedLine) {
  const product = l.item.variant.product.name;
  const variant = l.item.variant.name;
  return variant && variant !== product ? `${product} — ${variant}` : product;
}
