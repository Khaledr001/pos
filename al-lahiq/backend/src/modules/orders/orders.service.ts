import { Injectable, Logger } from '@nestjs/common';
import { ApiError } from '../../common/api-error.js';
import type { OrderStatus } from '../../generated/prisma/enums.js';
import { PrismaService, Tx } from '../../prisma/prisma.service.js';
import { InventoryService, StockDeduction } from '../inventory/inventory.service.js';
import { InvoicesService } from '../invoices/invoices.service.js';
import { NotificationsService, OrderTemplate } from '../notifications/notifications.service.js';
import { OutboxService } from '../pos-sync/outbox.service.js';
import { canTransition, NOTIFY_ON } from './order-status.js';
import { orderViewInclude } from './order.mapper.js';

export interface TransitionOptions {
  actor: string;
  note?: string | null;
  shipment?: { courier: string; trackingNumber: string; trackingUrl?: string | null };
  /** The change came from the POS, so don't echo it back. */
  fromPos?: boolean;
}

/** Work to run after the transaction commits. */
export interface AfterCommit {
  outboxIds: string[];
  notify: OrderTemplate[];
  orderId: string;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly invoices: InvoicesService,
    private readonly outbox: OutboxService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Post-commit side effects. Never fails the request: the order is already saved. */
  async flush(after: AfterCommit) {
    await this.outbox.kick(after.outboxIds);
    for (const t of after.notify) {
      await this.notifications
        .order(t, after.orderId)
        .catch((err: Error) => this.logger.error(`Could not queue ${t} for ${after.orderId}: ${err.message}`));
    }
  }

  /**
   * PENDING_PAYMENT → PLACED (payment received), or straight to PLACED for COD.
   * Issues the tax invoice and queues order.created for the POS.
   */
  async markPlaced(tx: Tx, orderId: string, actor: string): Promise<AfterCommit> {
    const order = await tx.order.update({
      where: { id: orderId },
      data: {
        status: 'PLACED',
        placedAt: new Date(),
        statusHistory: { create: { status: 'PLACED', actor } },
      },
    });
    await this.invoices.issue(tx, orderId);
    const outboxId = await this.outbox.add(tx, 'order.created', order.id, await this.posPayload(tx, orderId));
    return { outboxIds: [outboxId], notify: ['order_placed'], orderId };
  }

  /** The order as the POS receives it. The POS keeps these prices as charged. */
  async posPayload(tx: Tx, orderId: string) {
    const o = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { lines: true, pickupBranch: true, customer: true, invoice: true },
    });
    return {
      orderNumber: o.orderNumber,
      invoiceNumber: o.invoice?.invoiceNumber ?? null,
      placedAt: (o.placedAt ?? o.createdAt).toISOString(),
      status: o.status,
      customer: {
        email: o.email,
        phone: o.phone,
        fullName: o.fullName,
        companyName: o.companyName,
        trn: o.trn,
        posCustomerCode: o.customer?.posCustomerCode ?? null,
      },
      deliveryMethod: o.deliveryMethod,
      pickupBranchCode: o.pickupBranch?.code ?? null,
      pickupSlot: o.pickupSlotStart
        ? { start: o.pickupSlotStart.toISOString(), end: o.pickupSlotEnd?.toISOString() ?? null }
        : null,
      shippingAddress: o.shippingAddress ?? null,
      payment: { method: o.paymentMethod, status: o.paymentStatus, amountFils: o.totalFils },
      lines: o.lines.map((l) => ({
        sku: l.sku,
        name: l.name,
        uom: l.uom,
        quantity: Number(l.quantity),
        unitNetPriceFils: l.unitNetFils,
        priceListId: l.priceListId,
        priceListCode: l.priceListCode,
        priceVersion: l.priceVersion,
        vatRateBps: l.vatRateBps,
        lineNetFils: l.lineNetFils,
        lineVatFils: l.lineVatFils,
      })),
      discount: o.discountNetFils ? { code: o.couponCode, netFils: o.discountNetFils } : null,
      shippingNetFils: o.shippingNetFils,
      vatFils: o.vatFils,
      totalFils: o.totalFils,
    };
  }

  async transition(orderId: string, to: OrderStatus, opts: TransitionOptions) {
    const after = await this.prisma.$transaction(async (tx) => {
      // Lock the row so two changes to one order (double click, staff + POS) run one after another.
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) throw ApiError.notFound('Order');
      if (!canTransition(order.status, to, order.deliveryMethod, order.paymentStatus === 'PAID')) {
        throw ApiError.conflict(
          'INVALID_STATUS_CHANGE',
          `Order ${order.orderNumber} can't go from ${order.status} to ${to}`,
        );
      }

      await tx.order.update({
        where: { id: orderId },
        data: {
          status: to,
          ...(to === 'CANCELLED' && order.paymentStatus === 'PENDING' ? { paymentStatus: 'FAILED' } : {}),
          statusHistory: { create: { status: to, note: opts.note ?? null, actor: opts.actor } },
        },
      });

      if (to === 'SHIPPED' && opts.shipment) {
        await tx.shipment.create({
          data: {
            orderId,
            courier: opts.shipment.courier,
            trackingNumber: opts.shipment.trackingNumber,
            trackingUrl: opts.shipment.trackingUrl ?? null,
            status: 'SHIPPED',
          },
        });
      }
      if (to === 'CANCELLED' && order.stockDeductions) {
        await this.inventory.restore(tx, order.stockDeductions as unknown as StockDeduction[]);
      }

      const outboxIds: string[] = [];
      // Orders the POS never heard of (unpaid) don't need a status event.
      const posKnows = order.status !== 'PENDING_PAYMENT';
      if (!opts.fromPos && posKnows) {
        outboxIds.push(
          await this.outbox.add(tx, to === 'CANCELLED' ? 'order.cancelled' : 'order.status_changed', orderId, {
            orderNumber: order.orderNumber,
            status: to,
            note: opts.note ?? null,
            trackingNumber: opts.shipment?.trackingNumber ?? null,
          }),
        );
      }
      const template = NOTIFY_ON[to] as OrderTemplate | undefined;
      const notify = template && (posKnows || to !== 'CANCELLED') ? [template] : [];
      return { outboxIds, notify, orderId } satisfies AfterCommit;
    }, { timeout: 15_000 });
    await this.flush(after);
    return this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: orderViewInclude });
  }

  /** POS → website status updates (e.g. marked packed at the counter). */
  async applyPosStatus(d: {
    orderNumber: string;
    status: OrderStatus;
    note?: string | null;
    trackingNumber?: string | null;
    trackingUrl?: string | null;
  }): Promise<'applied' | 'skipped'> {
    const order = await this.prisma.order.findUnique({ where: { orderNumber: d.orderNumber } });
    if (!order) return 'skipped';
    if (!canTransition(order.status, d.status, order.deliveryMethod, order.paymentStatus === 'PAID')) {
      this.logger.warn(`POS status ${d.status} for ${d.orderNumber} ignored (currently ${order.status})`);
      return 'skipped';
    }
    await this.transition(order.id, d.status, {
      actor: 'pos',
      note: d.note,
      fromPos: true,
      shipment: d.trackingNumber
        ? { courier: 'pos', trackingNumber: d.trackingNumber, trackingUrl: d.trackingUrl }
        : undefined,
    });
    return 'applied';
  }

  /** Unpaid card orders give their stock back after a timeout. */
  async expireUnpaid(olderThanMinutes = 60) {
    const stale = await this.prisma.order.findMany({
      where: {
        status: 'PENDING_PAYMENT',
        createdAt: { lt: new Date(Date.now() - olderThanMinutes * 60_000) },
      },
      select: { id: true },
      take: 100,
    });
    for (const o of stale) {
      await this.transition(o.id, 'CANCELLED', { actor: 'system', note: 'Payment not completed' }).catch(
        (err: Error) => this.logger.warn(`Could not expire order ${o.id}: ${err.message}`),
      );
    }
    return stale.length;
  }

  async getView(where: { id?: string; trackingToken?: string; customerId?: string }) {
    const order = await this.prisma.order.findFirst({ where, include: orderViewInclude });
    if (!order) throw ApiError.notFound('Order');
    return order;
  }
}
