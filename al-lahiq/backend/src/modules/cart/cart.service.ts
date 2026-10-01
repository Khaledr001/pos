import { Injectable } from '@nestjs/common';
import { ApiError } from '../../common/api-error.js';
import { money } from '../../common/money.js';
import { computeTotals } from '../../common/totals.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { Cart } from '../../generated/prisma/client.js';
import { PrismaService, Tx } from '../../prisma/prisma.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import type { ResolvedPrice } from '../pricing/price-resolver.js';
import { PricingService } from '../pricing/pricing.service.js';
import { PromotionsService } from '../promotions/promotions.service.js';

export const cartItemInclude = {
  variant: {
    include: {
      uomConversions: true,
      product: {
        select: {
          id: true,
          slug: true,
          name: true,
          published: true,
          pickupOnly: true,
          images: { orderBy: { sortOrder: 'asc' }, take: 1, select: { url: true } },
        },
      },
    },
  },
} satisfies Prisma.CartItemInclude;

type CartItemRow = Prisma.CartItemGetPayload<{ include: typeof cartItemInclude }>;

export interface PricedLine {
  item: CartItemRow;
  quantity: number;
  baseQty: number;
  factor: number;
  price: ResolvedPrice | null;
}

export type CartIssueCode = 'PRICE_CHANGED' | 'OUT_OF_STOCK' | 'UNAVAILABLE' | 'PICKUP_ONLY_ITEMS';

export interface CartIssue {
  code: CartIssueCode;
  sku?: string;
  message: string;
}

const MAX_QTY = 100_000;

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly inventory: InventoryService,
    private readonly promotions: PromotionsService,
  ) {}

  /**
   * The active cart for this visitor. Logged-in customers have one cart across
   * devices; guests are identified by the al_cart cookie.
   */
  async resolve(cartId: string | undefined, customerId?: string): Promise<{ cart: Cart; created: boolean }> {
    if (customerId) {
      const existing = await this.prisma.cart.findFirst({
        where: { customerId, status: 'ACTIVE' },
        orderBy: { updatedAt: 'desc' },
      });
      if (existing) return { cart: existing, created: false };
    } else if (cartId && isUuid(cartId)) {
      const guest = await this.prisma.cart.findFirst({
        where: { id: cartId, status: 'ACTIVE', customerId: null },
      });
      if (guest) return { cart: guest, created: false };
    }
    const cart = await this.prisma.cart.create({ data: { customerId: customerId ?? null } });
    return { cart, created: true };
  }

  /** On login: move the guest cart's items into the customer's cart. */
  async adoptGuestCart(guestCartId: string | undefined, customerId: string) {
    if (!guestCartId || !isUuid(guestCartId)) return;
    const guest = await this.prisma.cart.findFirst({
      where: { id: guestCartId, status: 'ACTIVE', customerId: null },
      include: { items: true },
    });
    if (!guest) return;
    const { cart } = await this.resolve(undefined, customerId);
    if (cart.id === guest.id) return;

    await this.prisma.$transaction(async (tx) => {
      for (const it of guest.items) {
        await tx.cartItem.upsert({
          where: { cartId_variantId_uom: { cartId: cart.id, variantId: it.variantId, uom: it.uom } },
          create: {
            cartId: cart.id,
            variantId: it.variantId,
            uom: it.uom,
            quantity: it.quantity,
            seenUnitNetFils: it.seenUnitNetFils,
          },
          update: { quantity: { increment: it.quantity } },
        });
      }
      if (guest.couponCode && !cart.couponCode) {
        await tx.cart.update({ where: { id: cart.id }, data: { couponCode: guest.couponCode } });
      }
      await tx.cart.update({ where: { id: guest.id }, data: { status: 'CONVERTED' } });
    });
  }

  async addItem(cart: Cart, customerId: string | undefined, input: { variantId: string; uom?: string; quantity: number }) {
    const variant = await this.prisma.variant.findUnique({
      where: { id: input.variantId },
      include: { product: true },
    });
    if (!variant?.active || !variant.product.published) throw ApiError.notFound('Product');
    const uom = input.uom ?? variant.baseUom;

    const existing = await this.prisma.cartItem.findUnique({
      where: { cartId_variantId_uom: { cartId: cart.id, variantId: variant.id, uom } },
    });
    const quantity = Number(existing?.quantity ?? 0) + input.quantity;
    const price = await this.priceOrThrow(variant.sku, uom, quantity, customerId);

    await this.prisma.cartItem.upsert({
      where: { cartId_variantId_uom: { cartId: cart.id, variantId: variant.id, uom } },
      create: {
        cartId: cart.id,
        variantId: variant.id,
        uom,
        quantity: new Prisma.Decimal(quantity),
        seenUnitNetFils: price.unitNetFils,
      },
      update: { quantity: new Prisma.Decimal(quantity), seenUnitNetFils: price.unitNetFils },
    });
    await this.touch(cart.id);
  }

  async updateItem(cart: Cart, customerId: string | undefined, itemId: string, quantity: number) {
    const item = await this.ownedItem(cart, itemId);
    if (quantity <= 0) {
      await this.prisma.cartItem.delete({ where: { id: item.id } });
    } else {
      const price = await this.priceOrThrow(item.variant.sku, item.uom, quantity, customerId);
      await this.prisma.cartItem.update({
        where: { id: item.id },
        data: { quantity: new Prisma.Decimal(Math.min(quantity, MAX_QTY)), seenUnitNetFils: price.unitNetFils },
      });
    }
    await this.touch(cart.id);
  }

  async removeItem(cart: Cart, itemId: string) {
    const item = await this.ownedItem(cart, itemId);
    await this.prisma.cartItem.delete({ where: { id: item.id } });
    await this.touch(cart.id);
  }

  async setCoupon(cart: Cart, customerId: string | undefined, code: string | null) {
    if (code) {
      const { lines } = await this.priced(cart.id, customerId);
      const subtotal = lines.reduce((s, l) => s + (l.price?.lineNetFils ?? 0), 0);
      await this.promotions.evaluate(code, subtotal); // throws a clear error if not usable
    }
    await this.prisma.cart.update({
      where: { id: cart.id },
      data: { couponCode: code ? code.trim().toUpperCase() : null },
    });
  }

  /** Accept current prices: the customer has seen the updated amounts. */
  async acceptPrices(tx: Tx, lines: PricedLine[]) {
    for (const l of lines) {
      if (l.price && l.price.unitNetFils !== l.item.seenUnitNetFils) {
        await tx.cartItem.update({ where: { id: l.item.id }, data: { seenUnitNetFils: l.price.unitNetFils } });
      }
    }
  }

  // ── pricing & view ──

  async priced(cartId: string, customerId?: string, tx?: Tx) {
    const items = await (tx ?? this.prisma).cartItem.findMany({
      where: { cartId },
      include: cartItemInclude,
      orderBy: { createdAt: 'asc' },
    });
    const quotes = await this.pricing.quote(
      items.map((i) => ({ sku: i.variant.sku, uom: i.uom, qty: Number(i.quantity) })),
      customerId,
      new Date(),
      tx,
    );
    const lines: PricedLine[] = items.map((item, i) => {
      const quantity = Number(item.quantity);
      const factor =
        item.uom === item.variant.baseUom
          ? 1
          : Number(item.variant.uomConversions.find((c) => c.uom === item.uom)?.factor ?? 1);
      const sellable = item.variant.active && item.variant.product.published;
      return { item, quantity, factor, baseQty: quantity * factor, price: sellable ? quotes[i] : null };
    });
    return { items, lines };
  }

  async issues(lines: PricedLine[], opts: { pickupBranchId?: string; tx?: Tx } = {}): Promise<CartIssue[]> {
    const issues: CartIssue[] = [];
    for (const l of lines) {
      if (!l.price) {
        issues.push({ code: 'UNAVAILABLE', sku: l.item.variant.sku, message: `${l.item.variant.product.name} is no longer available` });
      } else if (l.price.unitNetFils !== l.item.seenUnitNetFils) {
        issues.push({ code: 'PRICE_CHANGED', sku: l.item.variant.sku, message: `The price of ${l.item.variant.product.name} has changed` });
      }
    }
    const shortages = await this.inventory.shortages(
      lines.filter((l) => l.price).map((l) => ({ variantId: l.item.variantId, sku: l.item.variant.sku, baseQty: l.baseQty })),
      opts.pickupBranchId,
      opts.tx,
    );
    for (const s of shortages) {
      const line = lines.find((l) => l.item.variantId === s.variantId)!;
      issues.push({
        code: 'OUT_OF_STOCK',
        sku: s.sku,
        message: `Only ${Math.floor(s.available / line.factor)} ${line.item.uom} of ${line.item.variant.product.name} available${opts.pickupBranchId ? ' at this branch' : ''}`,
      });
    }
    return issues;
  }

  async view(cart: Cart, customerId?: string) {
    const { lines } = await this.priced(cart.id, customerId);
    const valid = lines.filter((l) => l.price);
    const subtotalNet = valid.reduce((s, l) => s + l.price!.lineNetFils, 0);

    let discountNetFils = 0;
    let couponError: string | null = null;
    let freeShipping = false;
    if (cart.couponCode) {
      try {
        const r = await this.promotions.evaluate(cart.couponCode, subtotalNet);
        discountNetFils = r.discountNetFils;
        freeShipping = r.freeShipping;
      } catch (err) {
        couponError = (err as Error).message;
      }
    }
    const totals = computeTotals(
      valid.map((l) => ({ lineNetFils: l.price!.lineNetFils, vatRateBps: l.price!.vatRateBps })),
      discountNetFils,
      0,
    );
    const issues = await this.issues(lines);
    if (lines.some((l) => l.item.variant.product.pickupOnly)) {
      issues.push({ code: 'PICKUP_ONLY_ITEMS', message: 'Some items are available for store pickup only' });
    }

    return {
      id: cart.id,
      items: lines.map((l) => ({
        id: l.item.id,
        variantId: l.item.variantId,
        sku: l.item.variant.sku,
        productSlug: l.item.variant.product.slug,
        productName: l.item.variant.product.name,
        variantName: l.item.variant.name,
        imageUrl: l.item.variant.product.images[0]?.url ?? null,
        uom: l.item.uom,
        quantity: l.quantity,
        pickupOnly: l.item.variant.product.pickupOnly,
        weightGrams: Math.round(l.item.variant.weightGrams * l.baseQty),
        available: !!l.price,
        unitPrice: l.price ? money(l.price.unitGrossFils) : null,
        retailUnitPrice: l.price ? money(l.price.retailUnitGrossFils) : null,
        lineTotal: l.price ? money(l.price.lineGrossFils) : null,
        priceChanged: !!l.price && l.price.unitNetFils !== l.item.seenUnitNetFils,
        nextTier: nextTier(l.price, l.quantity),
      })),
      itemCount: lines.reduce((s, l) => s + (l.price ? 1 : 0), 0),
      couponCode: cart.couponCode,
      couponError,
      freeShipping,
      totals: {
        subtotalNet: money(totals.subtotalNetFils),
        discountNet: money(totals.discountNetFils),
        vat: money(totals.vatFils),
        total: money(totals.totalFils),
      },
      issues,
    };
  }

  private async priceOrThrow(sku: string, uom: string, qty: number, customerId?: string) {
    if (!(qty > 0) || qty > MAX_QTY) throw ApiError.badRequest('INVALID_QUANTITY', 'Quantity is not valid');
    const price = await this.pricing.quoteOne({ sku, uom, qty }, customerId);
    if (!price) throw ApiError.badRequest('NOT_SELLABLE', `This item can't be bought per ${uom}`);
    return price;
  }

  private async ownedItem(cart: Cart, itemId: string) {
    const item = await this.prisma.cartItem.findFirst({
      where: { id: itemId, cartId: cart.id },
      include: { variant: true },
    });
    if (!item) throw ApiError.notFound('Cart item');
    return item;
  }

  private touch(cartId: string) {
    return this.prisma.cart.update({ where: { id: cartId }, data: { updatedAt: new Date() } });
  }
}

/** "Buy 4 more to pay AED 10.50 each" nudges for quantity breaks. */
function nextTier(price: ResolvedPrice | null, qty: number) {
  const tier = price?.tiers.find((t) => t.minQty > qty);
  if (!tier) return null;
  return { minQty: tier.minQty, unitPrice: money(tier.unitGrossFils) };
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
