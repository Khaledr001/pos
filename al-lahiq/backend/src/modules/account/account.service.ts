import { Injectable } from '@nestjs/common';
import { ApiError } from '../../common/api-error.js';
import { money } from '../../common/money.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { toCustomerDto } from '../auth/auth.service.js';
import { CartService } from '../cart/cart.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { toOrderView } from '../orders/order.mapper.js';
import { OrdersService } from '../orders/orders.service.js';
import { OutboxService } from '../pos-sync/outbox.service.js';
import { PricingService } from '../pricing/pricing.service.js';
import {
  CreateListDto,
  ListItemDto,
  SaveAddressDto,
  TradeApplicationDto,
  UpdateAddressDto,
  UpdateProfileDto,
} from './account.dto.js';

@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderService: OrdersService,
    private readonly carts: CartService,
    private readonly pricing: PricingService,
    private readonly outbox: OutboxService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── profile ──

  async updateProfile(customerId: string, dto: UpdateProfileDto) {
    return toCustomerDto(await this.prisma.customer.update({ where: { id: customerId }, data: dto }));
  }

  async applyForTrade(customerId: string, dto: TradeApplicationDto) {
    const customer = await this.prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    if (customer.tradeStatus === 'APPROVED') {
      throw ApiError.conflict('ALREADY_TRADE', 'Your trade account is already active');
    }
    const outboxId = await this.prisma.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id: customerId },
        data: { companyName: dto.companyName, trn: dto.trn, tradeStatus: 'PENDING' },
      });
      return this.outbox.add(tx, 'customer.trade_requested', customerId, {
        email: customer.email,
        name: `${customer.firstName} ${customer.lastName}`,
        phone: customer.phone,
        companyName: dto.companyName,
        trn: dto.trn,
        message: dto.message ?? null,
      });
    });
    await this.outbox.kick([outboxId]);
    await this.notifications.customer('trade_application_received', customerId);
    return { tradeStatus: 'PENDING' as const };
  }

  // ── addresses ──

  addresses(customerId: string) {
    return this.prisma.address.findMany({
      where: { customerId },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
    });
  }

  async addAddress(customerId: string, dto: SaveAddressDto) {
    return this.prisma.$transaction(async (tx) => {
      const count = await tx.address.count({ where: { customerId } });
      const isDefault = dto.isDefault ?? count === 0;
      if (isDefault) await tx.address.updateMany({ where: { customerId }, data: { isDefault: false } });
      return tx.address.create({ data: { ...dto, customerId, isDefault } });
    });
  }

  async updateAddress(customerId: string, id: string, dto: UpdateAddressDto) {
    await this.ownedAddress(customerId, id);
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) await tx.address.updateMany({ where: { customerId }, data: { isDefault: false } });
      return tx.address.update({ where: { id }, data: dto });
    });
  }

  async deleteAddress(customerId: string, id: string) {
    const address = await this.ownedAddress(customerId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.address.delete({ where: { id } });
      if (!address.isDefault) return;
      // Keep one default: promote the most recently used remaining address.
      const next = await tx.address.findFirst({ where: { customerId }, orderBy: { updatedAt: 'desc' } });
      if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
    });
  }

  private async ownedAddress(customerId: string, id: string) {
    const a = await this.prisma.address.findFirst({ where: { id, customerId } });
    if (!a) throw ApiError.notFound('Address');
    return a;
  }

  // ── orders ──

  async orders(customerId: string, page = 1) {
    const where: Prisma.OrderWhereInput = { customerId, status: { not: 'PENDING_PAYMENT' } };
    const [total, rows] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * 20,
        take: 20,
        include: { _count: { select: { lines: true } } },
      }),
    ]);
    return {
      total,
      page,
      pageSize: 20,
      items: rows.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        paymentStatus: o.paymentStatus,
        deliveryMethod: o.deliveryMethod,
        placedAt: o.placedAt,
        itemCount: o._count.lines,
        total: money(o.totalFils),
      })),
    };
  }

  async order(customerId: string, id: string) {
    return toOrderView(await this.orderService.getView({ id, customerId }));
  }

  /** Adds every still-available line of a past order to the cart. */
  async reorder(customerId: string, id: string) {
    const order = await this.orderService.getView({ id, customerId });
    const { cart } = await this.carts.resolve(undefined, customerId);
    const added: string[] = [];
    const skipped: string[] = [];
    for (const line of order.lines) {
      if (!line.variantId) {
        skipped.push(line.sku);
        continue;
      }
      try {
        await this.carts.addItem(cart, customerId, {
          variantId: line.variantId,
          uom: line.uom,
          quantity: Number(line.quantity),
        });
        added.push(line.sku);
      } catch {
        skipped.push(line.sku);
      }
    }
    return { added, skipped };
  }

  // ── project lists & wishlist ──

  async lists(customerId: string) {
    const lists = await this.prisma.projectList.findMany({
      where: { customerId },
      orderBy: [{ isWishlist: 'desc' }, { updatedAt: 'desc' }],
      include: { _count: { select: { items: true } } },
    });
    return lists.map((l) => ({ id: l.id, name: l.name, isWishlist: l.isWishlist, itemCount: l._count.items, updatedAt: l.updatedAt }));
  }

  async list(customerId: string, id: string) {
    const list = await this.prisma.projectList.findFirst({
      where: { id, customerId },
      include: {
        items: {
          include: {
            variant: {
              include: {
                product: {
                  select: { slug: true, name: true, published: true, images: { take: 1, orderBy: { sortOrder: 'asc' } } },
                },
              },
            },
          },
        },
      },
    });
    if (!list) throw ApiError.notFound('List');
    const quotes = await this.pricing.quote(
      list.items.map((i) => ({ sku: i.variant.sku, uom: i.uom, qty: Number(i.quantity) })),
      customerId,
    );
    return {
      id: list.id,
      name: list.name,
      isWishlist: list.isWishlist,
      items: list.items.map((i, idx) => ({
        id: i.id,
        variantId: i.variantId,
        sku: i.variant.sku,
        productSlug: i.variant.product.slug,
        productName: i.variant.product.name,
        variantName: i.variant.name,
        imageUrl: i.variant.product.images[0]?.url ?? null,
        uom: i.uom,
        quantity: Number(i.quantity),
        available: i.variant.active && i.variant.product.published && !!quotes[idx],
        unitPrice: quotes[idx] ? money(quotes[idx].unitGrossFils) : null,
        lineTotal: quotes[idx] ? money(quotes[idx].lineGrossFils) : null,
      })),
    };
  }

  createList(customerId: string, dto: CreateListDto) {
    return this.prisma.projectList.create({ data: { customerId, name: dto.name } });
  }

  async renameList(customerId: string, id: string, dto: CreateListDto) {
    await this.ownedList(customerId, id);
    return this.prisma.projectList.update({ where: { id }, data: { name: dto.name } });
  }

  async deleteList(customerId: string, id: string) {
    const list = await this.ownedList(customerId, id);
    if (list.isWishlist) throw ApiError.badRequest('CANNOT_DELETE_WISHLIST', 'The wishlist cannot be deleted');
    await this.prisma.projectList.delete({ where: { id } });
  }

  /** `listId` may be the literal "wishlist". */
  async addToList(customerId: string, listId: string, dto: ListItemDto) {
    const list =
      listId === 'wishlist'
        ? await this.wishlist(customerId)
        : await this.ownedList(customerId, listId);
    const variant = await this.prisma.variant.findUnique({ where: { id: dto.variantId } });
    if (!variant) throw ApiError.notFound('Product');
    const uom = dto.uom ?? variant.baseUom;
    const quantity = new Prisma.Decimal(dto.quantity ?? 1);
    await this.prisma.projectListItem.upsert({
      where: { listId_variantId_uom: { listId: list.id, variantId: variant.id, uom } },
      create: { listId: list.id, variantId: variant.id, uom, quantity },
      update: { quantity },
    });
    await this.prisma.projectList.update({ where: { id: list.id }, data: { updatedAt: new Date() } });
    return this.list(customerId, list.id);
  }

  async removeFromList(customerId: string, listId: string, itemId: string) {
    await this.ownedList(customerId, listId);
    await this.prisma.projectListItem.deleteMany({ where: { id: itemId, listId } });
    return this.list(customerId, listId);
  }

  /** Adds the whole list to the cart. */
  async listToCart(customerId: string, listId: string) {
    const list = await this.list(customerId, listId);
    const { cart } = await this.carts.resolve(undefined, customerId);
    const added: string[] = [];
    const skipped: string[] = [];
    for (const item of list.items) {
      try {
        await this.carts.addItem(cart, customerId, { variantId: item.variantId, uom: item.uom, quantity: item.quantity });
        added.push(item.sku);
      } catch {
        skipped.push(item.sku);
      }
    }
    return { added, skipped };
  }

  private async wishlist(customerId: string) {
    const existing = await this.prisma.projectList.findFirst({ where: { customerId, isWishlist: true } });
    return existing ?? this.prisma.projectList.create({ data: { customerId, name: 'Wishlist', isWishlist: true } });
  }

  private async ownedList(customerId: string, id: string) {
    const list = await this.prisma.projectList.findFirst({ where: { id, customerId } });
    if (!list) throw ApiError.notFound('List');
    return list;
  }
}
