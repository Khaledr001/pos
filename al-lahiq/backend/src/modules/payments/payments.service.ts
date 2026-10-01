import { Injectable, Logger } from '@nestjs/common';
import { ApiError } from '../../common/api-error.js';
import { formatAed } from '../../common/money.js';
import { AppConfig } from '../../config/app-config.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { PaymentMethod } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { OutboxService } from '../pos-sync/outbox.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { DevPayProvider } from './dev-pay.provider.js';
import type { PaymentProvider } from './payment-provider.js';
import { StripeProvider } from './stripe.provider.js';

export interface PaymentMethodOption {
  method: PaymentMethod;
  label: string;
  available: boolean;
  reason?: string;
}

const LABELS: Record<PaymentMethod, string> = {
  CARD: 'Credit / debit card',
  APPLE_PAY: 'Apple Pay',
  GOOGLE_PAY: 'Google Pay',
  COD: 'Cash on delivery',
  TABBY: 'Tabby — pay in 4',
  TAMARA: 'Tamara — pay later',
};

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly outbox: OutboxService,
    private readonly settings: SettingsService,
    private readonly config: AppConfig,
    private readonly stripe: StripeProvider,
    private readonly devPay: DevPayProvider,
  ) {}

  providerFor(method: PaymentMethod): PaymentProvider | null {
    if (method === 'COD' || method === 'TABBY' || method === 'TAMARA') return null;
    if (this.stripe.configured) return this.stripe;
    if (this.devPay.enabled) return this.devPay;
    return null;
  }

  private providerByName(name: string): PaymentProvider | null {
    if (name === this.stripe.name) return this.stripe;
    if (name === this.devPay.name) return this.devPay;
    return null;
  }

  async methods(totalFils: number, deliveryMethod?: 'COURIER' | 'PICKUP'): Promise<PaymentMethodOption[]> {
    const cod = await this.settings.get('cod');
    const cardProvider = this.providerFor('CARD');
    const options: PaymentMethodOption[] = (['CARD', 'APPLE_PAY', 'GOOGLE_PAY'] as const).map((m) => ({
      method: m,
      label: LABELS[m],
      available: !!cardProvider,
      reason: cardProvider ? undefined : 'Online payment is not set up yet',
    }));
    const codOk = cod.enabled && totalFils <= cod.maxFils;
    options.push({
      method: 'COD',
      label: deliveryMethod === 'PICKUP' ? 'Pay at the store' : LABELS.COD,
      available: codOk,
      reason: !cod.enabled
        ? 'Not available'
        : totalFils > cod.maxFils
          ? `Available for orders up to ${formatAed(cod.maxFils)}`
          : undefined,
    });
    return options;
  }

  async assertAvailable(method: PaymentMethod, totalFils: number, deliveryMethod: 'COURIER' | 'PICKUP') {
    const option = (await this.methods(totalFils, deliveryMethod)).find((o) => o.method === method);
    if (!option?.available) {
      throw ApiError.badRequest('PAYMENT_METHOD_UNAVAILABLE', option?.reason ?? 'This payment method is not available');
    }
  }

  /** Creates the gateway session for a PENDING_PAYMENT order. */
  async start(orderId: string) {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const provider = this.providerFor(order.paymentMethod);
    if (!provider) throw ApiError.badRequest('PAYMENT_METHOD_UNAVAILABLE', 'Online payment is not set up');

    const base = this.config.get('FRONTEND_URL');
    const session = await provider.createSession(order, {
      success: `${base}/checkout/success?order=${order.trackingToken}`,
      cancel: `${base}/checkout?cancelled=${order.trackingToken}`,
    });
    await this.prisma.payment.create({
      data: {
        orderId,
        provider: provider.name,
        providerRef: session.providerRef,
        method: order.paymentMethod,
        amountFils: order.totalFils,
        status: 'PENDING',
      },
    });
    return session.redirectUrl;
  }

  /** Gateway says paid. Idempotent: webhooks can arrive more than once. */
  async confirmPaid(provider: string, providerRef: string, amountFils: number, raw?: Prisma.InputJsonValue) {
    const after = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { provider_providerRef: { provider, providerRef } },
        include: { order: true },
      });
      if (!payment) throw ApiError.notFound('Payment');
      if (payment.status === 'PAID') return null;
      if (amountFils !== payment.amountFils) {
        throw ApiError.conflict('AMOUNT_MISMATCH', `Paid ${amountFils} but expected ${payment.amountFils}`);
      }

      await tx.payment.update({ where: { id: payment.id }, data: { status: 'PAID', raw } });
      await tx.order.update({ where: { id: payment.orderId }, data: { paymentStatus: 'PAID' } });

      if (payment.order.status === 'PENDING_PAYMENT') {
        return this.orders.markPlaced(tx, payment.orderId, `payment:${provider}`);
      }
      // Paid after the order expired: keep the money visible to staff for a refund.
      await tx.orderStatusHistory.create({
        data: {
          orderId: payment.orderId,
          status: payment.order.status,
          actor: `payment:${provider}`,
          note: 'Payment received after the order was cancelled — refund required',
        },
      });
      this.logger.warn(`Late payment for cancelled order ${payment.order.orderNumber}`);
      return null;
    });
    if (after) await this.orders.flush(after);
  }

  async markFailed(provider: string, providerRef: string) {
    await this.prisma.payment.updateMany({
      where: { provider, providerRef, status: 'PENDING' },
      data: { status: 'FAILED' },
    });
  }

  /** Staff refund of the full paid amount. */
  async refund(orderId: string, actor: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { payments: { where: { status: 'PAID' } } },
    });
    if (!order) throw ApiError.notFound('Order');
    const payment = order.payments[0];
    if (!payment) throw ApiError.conflict('NOT_PAID', 'This order has no online payment to refund');
    if (!['CANCELLED', 'DELIVERED', 'COLLECTED'].includes(order.status)) {
      throw ApiError.conflict('CANCEL_FIRST', 'Cancel the order before refunding it');
    }

    const provider = this.providerByName(payment.provider);
    if (!provider) throw ApiError.conflict('REFUND_UNSUPPORTED', `Refunds via ${payment.provider} must be done manually`);
    await provider.refund(payment.providerRef!, payment.amountFils);

    const outboxId = await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({ where: { id: payment.id }, data: { status: 'REFUNDED' } });
      await tx.order.update({
        where: { id: orderId },
        data: {
          paymentStatus: 'REFUNDED',
          status: 'REFUNDED',
          statusHistory: {
            create: {
              status: 'REFUNDED',
              actor,
              note: `Refunded ${formatAed(payment.amountFils)}`,
            },
          },
        },
      });
      // The POS reverses the sale on refund.created; no separate status event.
      return this.outbox.add(tx, 'refund.created', orderId, {
        orderNumber: order.orderNumber,
        amountFils: payment.amountFils,
        provider: payment.provider,
      });
    });
    await this.outbox.kick([outboxId]);
  }
}
