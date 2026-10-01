import { and, eq, schema, type Transaction } from "@devsfleet/db";
import type { DeliveryMethod, Emirate } from "@devsfleet/shared-types";
import { AppError, calculateLine, ERROR_CODES, Money } from "@devsfleet/shared-utils";
import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { RequestContext } from "../../../common/context/request-context.js";
import { TenantDatabase } from "../../../database/tenant-database.service.js";
import { OrdersService, type ChannelOrderLine } from "../../orders/orders.service.js";
import { CartService, type DeliveryLine, type PricedCart } from "../cart/cart.service.js";
import { CouponsService } from "../cart/coupons.service.js";
import { currentShopper } from "../context/storefront.guard.js";
import { DELIVERY_LINE_NOTE, WebOrdersService } from "../orders/web-orders.service.js";
import { StorefrontPaymentsService } from "../payments/payments.service.js";
import { toWire } from "../wire.js";
import { courierQuote, pickupSlots, type CourierQuote } from "./delivery.js";
import type { PlaceOrderDto, QuoteDto } from "./dto.js";

interface ResolvedDelivery {
  method: DeliveryMethod;
  /** Where the stock is held and the order is fulfilled from. */
  branchId: string;
  line: DeliveryLine | null;
  courier: CourierQuote | null;
  address: Record<string, string> | null;
  pickupSlotStart: Date | null;
  pickupSlotEnd: Date | null;
}

/**
 * Checkout: the moment a cart becomes a POS order.
 *
 * Everything that decides money or stock happens inside ONE transaction —
 * re-price, re-check stock under row locks, redeem the coupon, create the
 * order, reserve the stock, record the web side. Either the shopper has an
 * order that holds its stock, or nothing happened.
 */
@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly db: TenantDatabase,
    private readonly carts: CartService,
    private readonly coupons: CouponsService,
    private readonly orders: OrdersService,
    private readonly webOrders: WebOrdersService,
    private readonly payments: StorefrontPaymentsService,
  ) {}

  /** Everything the checkout page shows: options, fees, totals, blocking issues. */
  async quote(guestCartId: string | undefined, dto: QuoteDto) {
    return this.db.run(async (tx) => {
      const cart = await this.carts.find(tx, guestCartId);
      const priced: PricedCart = cart
        ? await this.carts.price(tx, cart)
        : { cart: null as never, lines: [], coupon: null, couponError: null };

      const hasPickupOnly = priced.lines.some((l) => l.priced && l.pickupOnly);
      const method: DeliveryMethod = dto.deliveryMethod ?? (hasPickupOnly ? "pickup" : "courier");
      const courier = await this.courier(tx, priced, dto.emirate, hasPickupOnly);
      const deliveryLine = method === "courier" && courier.available ? await this.deliveryLine(tx, courier.fee) : null;
      const { totals } = this.carts.document(priced, deliveryLine);

      const branchIds =
        method === "pickup"
          ? dto.pickupBranchId
            ? [dto.pickupBranchId]
            : await this.carts.shownBranchIds(tx)
          : [await this.fulfilmentBranchId(tx)];
      const issues = (await this.carts.issues(tx, priced, { branchIds })).filter(
        (issue) => !(issue.code === "PICKUP_ONLY_ITEMS" && method === "pickup"),
      );
      const gateway = await this.payments.gateway(tx);
      const money = this.carts.moneyOf();
      const deliveryNet = deliveryLine ? this.deliveryNet(deliveryLine) : 0n;

      return {
        deliveryMethod: toWire(method),
        itemCount: priced.lines.filter((l) => l.priced).length,
        weightKg: Number(Money.toDecimalString(this.carts.weightKg(priced), 0)),
        courier: {
          available: courier.available,
          ...(courier.reason ? { reason: courier.reason } : {}),
          feeNetFils: Number(Money.roundTo(courier.fee, 2) / 100n),
          etaDays: courier.etaDays,
          freeOverFils: courier.freeOver === null ? null : Number(Money.roundTo(courier.freeOver, 2) / 100n),
          fee: money(courier.available ? await this.deliveryGross(tx, courier.fee) : 0n),
        },
        pickupBranches: await this.pickupBranches(tx),
        couponCode: priced.cart?.couponCode ?? null,
        couponError: priced.couponError,
        totals: this.carts.totalsView(totals, deliveryNet),
        paymentMethods: this.payments.options(totals.total, method, gateway),
        issues,
        canPlace:
          priced.lines.length > 0 &&
          issues.every((i) => i.code === "PRICE_CHANGED") &&
          (method === "pickup" || courier.available),
      };
    });
  }

  async place(guestCartId: string | undefined, dto: PlaceOrderDto) {
    const idempotencyKey = dto.idempotencyKey ?? randomUUID();

    // A retry of an attempt that already went through: the same answer again.
    const previous = await this.db.run((tx) =>
      tx.query.webOrders.findFirst({ where: (t, { eq: e }) => e(t.idempotencyKey, idempotencyKey) }),
    );
    if (previous) return this.result(previous.orderId);

    /**
     * Prices first, in a transaction of their own. If anything moved since the
     * shopper last looked, they see the new figures before paying — and the
     * cart remembers they have now been shown them. That has to commit before
     * the refusal, or the shopper would be refused the same way forever.
     */
    const preview = await this.db.run(async (tx) => {
      const cart = await this.carts.find(tx, guestCartId);
      if (!cart) return { empty: true, changed: false };
      const priced = await this.carts.price(tx, cart);
      if (!priced.lines.length) return { empty: true, changed: false };
      const changed = priced.lines.some(
        (l) => l.priced && l.seenUnitPrice && Money.toMinor(l.seenUnitPrice) !== Money.toMinor(l.priced.unitPrice),
      );
      if (changed) await this.carts.acceptPrices(tx, priced);
      return { empty: false, changed };
    });
    if (preview.empty) throw new AppError(ERROR_CODES.CART_EMPTY, "Your cart is empty.");
    if (preview.changed) throw new AppError(ERROR_CODES.PRICE_CHANGED, "Some prices have changed. Please review your order.");

    const placed = await this.db.run(async (tx) => {
      const cart = await this.carts.find(tx, guestCartId);
      if (!cart) throw new AppError(ERROR_CODES.CART_EMPTY, "Your cart is empty.");
      // Claim it: two tabs submitting one cart must not both become orders.
      const [claimed] = await tx
        .update(schema.carts)
        .set({ status: "converted" })
        .where(and(eq(schema.carts.id, cart.id), eq(schema.carts.status, "active")))
        .returning({ id: schema.carts.id });
      if (!claimed) throw new AppError(ERROR_CODES.CONFLICT, "This cart has already been checked out.");

      const priced = await this.carts.price(tx, cart);
      if (priced.lines.some((l) => !l.priced)) {
        throw new AppError(ERROR_CODES.CHECKOUT_UNAVAILABLE, "Some items in your cart are no longer available.");
      }
      if (priced.lines.some((l) => l.seenUnitPrice && Money.toMinor(l.seenUnitPrice) !== Money.toMinor(l.priced!.unitPrice))) {
        throw new AppError(ERROR_CODES.PRICE_CHANGED, "Some prices have changed. Please review your order.");
      }
      if (cart.couponCode && priced.couponError) throw new AppError(ERROR_CODES.COUPON_INVALID, priced.couponError);

      const delivery = await this.resolveDelivery(tx, dto, priced);
      const { totals } = this.carts.document(priced, delivery.line);
      if (dto.expectedTotalFils !== undefined && Number(Money.roundTo(totals.total, 2) / 100n) !== dto.expectedTotalFils) {
        throw new AppError(ERROR_CODES.PRICE_CHANGED, "Your order total has changed. Please review your order.");
      }

      const option = this.payments.options(totals.total, delivery.method, await this.payments.gateway(tx)).find(
        (o) => o.method === toWire(dto.paymentMethod),
      );
      if (!option?.available) {
        throw new AppError(ERROR_CODES.CHECKOUT_UNAVAILABLE, option?.reason ?? "That payment method is not available.");
      }

      // Under row locks: the counter cannot sell the last unit between this check and the reservation below.
      const shortages = (await this.carts.issues(tx, priced, { branchIds: [delivery.branchId], lock: true })).filter(
        (i) => i.code === "OUT_OF_STOCK",
      );
      if (shortages.length) throw new AppError(ERROR_CODES.INSUFFICIENT_STOCK, shortages.map((s) => s.message).join(" "));

      if (priced.coupon) await this.coupons.redeem(tx, priced.coupon.couponId);

      const lines: ChannelOrderLine[] = priced.lines.map((l) => ({
        variantId: l.variantId,
        unitId: l.isBaseUnit ? null : l.unitId,
        conversionFactor: l.conversionFactor,
        quantity: l.quantity,
        unitPrice: l.priced!.unitPrice,
        discountPercent: priced.coupon?.discountPercent ?? "0",
        taxPercent: l.priced!.taxPercent,
      }));
      if (delivery.line) {
        lines.push({
          variantId: delivery.line.variantId,
          unitId: null,
          conversionFactor: "1",
          quantity: "1",
          unitPrice: delivery.line.unitPrice,
          discountPercent: "0",
          taxPercent: delivery.line.taxPercent,
          notes: DELIVERY_LINE_NOTE,
        });
      }

      const shopper = currentShopper();
      const order = await this.orders.createInTransaction(tx, {
        branchId: delivery.branchId,
        customerId: shopper?.customerId ?? null,
        source: "web",
        lines,
        notes: dto.notes ?? null,
      });
      // The same total the shopper was quoted, or something is badly wrong.
      if (order.totals.total !== totals.total) throw new Error("Order total diverged from the checkout total");
      await this.orders.confirmInTransaction(tx, order.id);

      const isCod = dto.paymentMethod === "cod";
      const tenantId = RequestContext.requireTenantId();
      const { id: storefrontId } = RequestContext.requireStorefront();
      const [web] = await tx
        .insert(schema.webOrders)
        .values({
          orderId: order.id,
          tenantId,
          storefrontId,
          accountId: shopper?.accountId ?? null,
          idempotencyKey,
          status: isCod ? "placed" : "pending_payment",
          paymentMethod: dto.paymentMethod,
          paymentStatus: "pending",
          deliveryMethod: delivery.method,
          contactName: dto.contact.fullName,
          contactEmail: dto.contact.email,
          contactPhone: dto.contact.phone,
          companyName: dto.companyName ?? null,
          trn: dto.trn ?? null,
          shippingAddress: delivery.address,
          pickupBranchId: delivery.method === "pickup" ? delivery.branchId : null,
          pickupSlotStart: delivery.pickupSlotStart,
          pickupSlotEnd: delivery.pickupSlotEnd,
          couponCode: priced.coupon?.code ?? null,
          shippingAmount: delivery.line ? Money.toDecimalString(this.deliveryNet(delivery.line), 4) : "0",
          weightKg: Money.toDecimalString(this.carts.weightKg(priced), 4),
          placedAt: isCod ? new Date() : null,
        })
        .returning();

      await this.webOrders.recordEvent(tx, order.id, isCod ? "placed" : "pending_payment", isCod ? "Order placed online." : "Awaiting online payment.");
      if (isCod) {
        await tx.insert(schema.webPayments).values({
          tenantId,
          orderId: order.id,
          provider: "cod",
          method: "cod",
          amount: Money.toDecimalString(totals.total, 4),
          status: "pending",
        });
      }
      await tx.update(schema.carts).set({ convertedOrderId: order.id }).where(eq(schema.carts.id, cart.id));

      if (dto.saveAddress && shopper && dto.address && !dto.addressId) {
        const hasDefault = await tx.query.shopperAddresses.findFirst({
          where: (t, { and: a, eq: e }) => a(e(t.accountId, shopper.accountId), e(t.isDefault, true)),
          columns: { id: true },
        });
        await tx.insert(schema.shopperAddresses).values({
          tenantId,
          accountId: shopper.accountId,
          ...addressColumns(dto.address),
          isDefault: !hasDefault,
        });
      }
      return web!;
    });

    if (placed.status !== "pending_payment") return this.result(placed.orderId);

    try {
      const url = await this.payments.start(placed.orderId);
      return { ...(await this.result(placed.orderId)), next: { type: "redirect" as const, url } };
    } catch (error) {
      // No gateway session, no way to pay: give the stock back now rather than in 45 minutes.
      this.logger.error({ err: error, orderId: placed.orderId }, "Could not open a payment session");
      await this.db.run(async (tx) => {
        await this.orders.cancelInTransaction(tx, placed.orderId, "The payment page could not be opened.");
        await tx.update(schema.webOrders).set({ status: "cancelled" }).where(eq(schema.webOrders.orderId, placed.orderId));
        await this.webOrders.recordEvent(tx, placed.orderId, "cancelled", "The payment page could not be opened.");
      });
      throw new AppError(ERROR_CODES.PAYMENT_FAILED, "We could not open the payment page. Your order was not placed — please try again.");
    }
  }

  // ---------------------------------------------------------------------------

  private async result(orderId: string) {
    return this.db.run(async (tx) => {
      const view = await this.webOrders.view(tx, orderId);
      return {
        orderId: view.id,
        orderNumber: view.orderNumber,
        trackingToken: view.trackingToken,
        total: view.totals.total,
        next: { type: "confirmation" as const },
      };
    });
  }

  private async resolveDelivery(tx: Transaction, dto: PlaceOrderDto, priced: PricedCart): Promise<ResolvedDelivery> {
    const { settings, tenantSettings } = RequestContext.requireStorefront();

    if (dto.deliveryMethod === "pickup") {
      const branch = settings.branches.find((b) => b.branchId === dto.pickupBranchId && b.pickupEnabled);
      if (!branch) throw new AppError(ERROR_CODES.CHECKOUT_UNAVAILABLE, "This branch is not available for pickup.");
      const start = new Date(dto.pickupSlotStart!);
      const slot = pickupSlots(new Date(), settings.pickup, tenantSettings.locale.timezone).find(
        (s) => new Date(s.start).getTime() === start.getTime(),
      );
      if (!slot) throw new AppError(ERROR_CODES.CHECKOUT_UNAVAILABLE, "This pickup time is no longer available.");
      return {
        method: "pickup",
        branchId: branch.branchId,
        line: null,
        courier: null,
        address: null,
        pickupSlotStart: start,
        pickupSlotEnd: new Date(slot.end),
      };
    }

    let address: Record<string, string> | null = null;
    if (dto.addressId) {
      const shopper = currentShopper();
      const saved = shopper
        ? await tx.query.shopperAddresses.findFirst({
            where: (t, { and: a, eq: e }) => a(e(t.id, dto.addressId!), e(t.accountId, shopper.accountId)),
          })
        : null;
      if (!saved) throw new AppError(ERROR_CODES.VALIDATION_FAILED, "That saved address was not found.");
      address = snapshot(saved);
    } else if (dto.address) {
      address = snapshot(addressColumns(dto.address));
    }

    const hasPickupOnly = priced.lines.some((l) => l.priced && l.pickupOnly);
    const courier = await this.courier(tx, priced, address?.emirate as Emirate | undefined, hasPickupOnly);
    if (!courier.available) {
      const messages: Record<string, string> = {
        PICKUP_ONLY_ITEMS: "Some items can only be collected from the store.",
        EMIRATE_NOT_SERVED: "We do not deliver to this emirate yet.",
        OVERWEIGHT: "This order is too heavy for courier delivery. Please choose store pickup.",
        NO_ADDRESS: "A delivery address is required.",
        NOT_OFFERED: "Courier delivery is not offered yet. Please choose store pickup.",
      };
      throw new AppError(ERROR_CODES.CHECKOUT_UNAVAILABLE, messages[courier.reason!] ?? "Courier delivery is not available.");
    }

    return {
      method: "courier",
      branchId: await this.fulfilmentBranchId(tx),
      line: await this.deliveryLine(tx, courier.fee),
      courier,
      address,
      pickupSlotStart: null,
      pickupSlotEnd: null,
    };
  }

  private async courier(tx: Transaction, priced: PricedCart, emirate: Emirate | undefined, hasPickupOnly: boolean) {
    const { settings } = RequestContext.requireStorefront();
    return courierQuote({
      rates: settings.shipping.rates,
      emirate,
      weightKg: this.carts.weightKg(priced),
      // Free delivery is earned on what the goods cost after the coupon.
      goodsNetAfterDiscount: this.carts.document(priced).totals.subtotal,
      hasPickupOnlyItems: hasPickupOnly,
      freeShipping: priced.coupon?.freeShipping ?? false,
      deliveryConfigured: !!settings.checkout.deliveryVariantId && (await this.deliveryVariantExists(tx)),
    });
  }

  /**
   * The delivery fee as an order line, so it is taxed and invoiced by the
   * same calculateDocument call as the goods. The rate table is VAT-exclusive;
   * a tenant whose prices include VAT gets the fee grossed up to match.
   */
  private async deliveryLine(tx: Transaction, netFee: bigint): Promise<DeliveryLine | null> {
    if (!Money.isPositive(netFee)) return null;
    const { settings, tenantSettings } = RequestContext.requireStorefront();
    const variant = await tx.query.productVariants.findFirst({
      where: (t, { eq: e }) => e(t.id, settings.checkout.deliveryVariantId!),
      with: { product: { columns: { taxRate: true } } },
    });
    if (!variant) return null;
    const taxPercent = variant.product.taxRate ?? String(tenantSettings.tax.defaultRate);
    const unitPrice =
      tenantSettings.tax.mode === "inclusive" ? Money.add(netFee, Money.percentOf(netFee, taxPercent)) : netFee;
    return { variantId: variant.id, unitPrice: Money.toDecimalString(unitPrice, 4), taxPercent };
  }

  private deliveryNet(line: DeliveryLine): bigint {
    const { tenantSettings } = RequestContext.requireStorefront();
    return calculateLine({ quantity: "1", unitPrice: line.unitPrice, taxPercent: line.taxPercent }, tenantSettings.tax.mode, tenantSettings.currency.decimals).net;
  }

  private async deliveryGross(tx: Transaction, netFee: bigint): Promise<bigint> {
    const line = await this.deliveryLine(tx, netFee);
    if (!line) return 0n;
    const { tenantSettings } = RequestContext.requireStorefront();
    return calculateLine({ quantity: "1", unitPrice: line.unitPrice, taxPercent: line.taxPercent }, tenantSettings.tax.mode, tenantSettings.currency.decimals).total;
  }

  private async deliveryVariantExists(tx: Transaction): Promise<boolean> {
    const { settings } = RequestContext.requireStorefront();
    const variant = await tx.query.productVariants.findFirst({
      where: (t, { eq: e }) => e(t.id, settings.checkout.deliveryVariantId!),
      columns: { id: true },
    });
    return !!variant;
  }

  private async fulfilmentBranchId(tx: Transaction): Promise<string> {
    const { settings } = RequestContext.requireStorefront();
    if (settings.checkout.fulfilmentBranchId) return settings.checkout.fulfilmentBranchId;
    const [first] = await this.carts.shownBranchIds(tx);
    if (!first) throw new AppError(ERROR_CODES.CHECKOUT_UNAVAILABLE, "This shop has no branch to ship from.");
    return first;
  }

  private async pickupBranches(tx: Transaction) {
    const { settings, tenantSettings } = RequestContext.requireStorefront();
    const pickup = settings.branches.filter((b) => b.pickupEnabled);
    if (pickup.length === 0) return [];
    const rows = await tx.query.branches.findMany({
      where: (t, { and: a, eq: e, isNull: n, inArray: i }) =>
        a(i(t.id, pickup.map((b) => b.branchId)), e(t.isActive, true), n(t.deletedAt)),
      columns: { id: true, code: true, name: true, address: true, phone: true },
      orderBy: (t, { asc }) => asc(t.name),
    });
    const slots = pickupSlots(new Date(), settings.pickup, tenantSettings.locale.timezone);
    return rows.map((b) => ({
      id: b.id,
      code: b.code,
      name: b.name,
      emirate: pickup.find((p) => p.branchId === b.id)!.emirate,
      address: b.address ?? "",
      phone: b.phone,
      slots,
    }));
  }
}

function addressColumns(address: NonNullable<PlaceOrderDto["address"]>) {
  return {
    label: address.label ?? null,
    fullName: address.fullName,
    phone: address.phone,
    emirate: address.emirate,
    area: address.area,
    street: address.street,
    building: address.building ?? null,
    landmark: address.landmark ?? null,
    lat: address.lat != null ? String(address.lat) : null,
    lng: address.lng != null ? String(address.lng) : null,
  };
}

/** What the order keeps of an address. Editing the saved one later must not move a parcel. */
function snapshot(address: Record<string, unknown>): Record<string, string> {
  const keep = ["label", "fullName", "phone", "emirate", "area", "street", "building", "landmark", "lat", "lng"];
  return Object.fromEntries(
    keep.filter((k) => address[k] != null && address[k] !== "").map((k) => [k, String(address[k])]),
  );
}
