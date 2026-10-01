import { Global, Injectable, Logger, Module, OnModuleInit } from '@nestjs/common';
import { formatAed } from '../../common/money.js';
import { AppConfig } from '../../config/app-config.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { JobsService } from '../jobs/jobs.service.js';
import { SettingsService } from '../settings/settings.service.js';

export const NOTIFY_QUEUE = 'notifications';

export type OrderTemplate =
  | 'order_placed'
  | 'order_confirmed'
  | 'order_shipped'
  | 'order_ready_for_pickup'
  | 'order_delivered'
  | 'order_collected'
  | 'order_cancelled';

export type CustomerTemplate = 'trade_application_received' | 'trade_approved' | 'trade_rejected';

type Job =
  | { kind: 'order'; template: OrderTemplate; orderId: string }
  | { kind: 'customer'; template: CustomerTemplate; customerId: string };

interface Message {
  to: { email: string; phone?: string | null; name: string };
  subject: string;
  text: string;
  link?: string;
}

/**
 * Email (Resend) and WhatsApp (Cloud API) notifications, sent from a queue so
 * a slow provider never slows checkout. Without credentials, messages are logged.
 *
 * WhatsApp note: business-initiated messages outside a 24h customer window
 * must use Meta-approved templates. Register templates with the same names as
 * OrderTemplate and switch `sendWhatsApp` to template messages in production.
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly config: AppConfig,
    private readonly settings: SettingsService,
  ) {}

  onModuleInit() {
    this.jobs.register(NOTIFY_QUEUE, (job: Job) => this.deliver(job), { attempts: 5, concurrency: 5 });
  }

  async order(template: OrderTemplate, orderId: string) {
    await this.jobs.enqueue(NOTIFY_QUEUE, { kind: 'order', template, orderId } satisfies Job);
  }

  async customer(template: CustomerTemplate, customerId: string) {
    await this.jobs.enqueue(NOTIFY_QUEUE, { kind: 'customer', template, customerId } satisfies Job);
  }

  private async deliver(job: Job) {
    const msg = job.kind === 'order' ? await this.orderMessage(job) : await this.customerMessage(job);
    if (!msg) return;
    await Promise.all([this.sendEmail(msg), this.sendWhatsApp(msg)]);
  }

  private async orderMessage(job: Extract<Job, { kind: 'order' }>): Promise<Message | null> {
    const order = await this.prisma.order.findUnique({
      where: { id: job.orderId },
      include: { pickupBranch: true, shipments: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!order) return null;
    const store = await this.settings.get('store');
    const link = `${this.config.get('FRONTEND_URL')}/track/${order.trackingToken}`;
    const total = formatAed(order.totalFils);
    const n = order.orderNumber;
    const shipment = order.shipments[0];

    const copy: Record<OrderTemplate, [string, string]> = {
      order_placed: [
        `Order ${n} received`,
        `Thank you for your order ${n} (${total}). ${order.paymentMethod === 'COD' ? 'Please keep the amount ready on delivery.' : 'Your payment was received.'} We will let you know when it is on its way.`,
      ],
      order_confirmed: [`Order ${n} confirmed`, `Your order ${n} is confirmed and being prepared.`],
      order_shipped: [
        `Order ${n} is on its way`,
        `Your order ${n} has been handed to the courier.${shipment?.trackingNumber ? ` Tracking number: ${shipment.trackingNumber}.` : ''}`,
      ],
      order_ready_for_pickup: [
        `Order ${n} is ready for pickup`,
        `Your order ${n} is ready at ${order.pickupBranch?.name ?? 'our store'}${order.pickupBranch ? `, ${order.pickupBranch.address}` : ''}. Please bring your order number.`,
      ],
      order_delivered: [`Order ${n} delivered`, `Your order ${n} has been delivered. Thank you for shopping with ${store.name}.`],
      order_collected: [`Order ${n} collected`, `Your order ${n} has been collected. Thank you for shopping with ${store.name}.`],
      order_cancelled: [`Order ${n} cancelled`, `Your order ${n} has been cancelled. If you paid online, the refund is on its way.`],
    };
    const [subject, text] = copy[job.template];
    return { to: { email: order.email, phone: order.phone, name: order.fullName }, subject, text, link };
  }

  private async customerMessage(job: Extract<Job, { kind: 'customer' }>): Promise<Message | null> {
    const c = await this.prisma.customer.findUnique({ where: { id: job.customerId } });
    if (!c) return null;
    const copy: Record<CustomerTemplate, [string, string]> = {
      trade_application_received: [
        'We received your trade account application',
        'Thanks for applying for a trade account. Our team will review it and get back to you shortly.',
      ],
      trade_approved: [
        'Your trade account is approved',
        'Your trade account is active. Log in to see your trade prices.',
      ],
      trade_rejected: [
        'About your trade account application',
        'We could not approve your trade account at this time. Please contact us for details.',
      ],
    };
    const [subject, text] = copy[job.template];
    return { to: { email: c.email, phone: c.phone, name: `${c.firstName} ${c.lastName}` }, subject, text };
  }

  private async sendEmail(msg: Message) {
    const key = this.config.get('RESEND_API_KEY');
    if (!key) {
      this.logger.log(`[email → ${msg.to.email}] ${msg.subject}: ${msg.text}`);
      return;
    }
    const html = `<p>Hi ${escapeHtml(msg.to.name)},</p><p>${escapeHtml(msg.text)}</p>${
      msg.link ? `<p><a href="${msg.link}">View your order</a></p>` : ''
    }`;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: this.config.get('MAIL_FROM'), to: msg.to.email, subject: msg.subject, html }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Resend responded ${res.status}`);
  }

  private async sendWhatsApp(msg: Message) {
    const token = this.config.get('WHATSAPP_TOKEN');
    const phoneId = this.config.get('WHATSAPP_PHONE_NUMBER_ID');
    const to = msg.to.phone?.replace(/\D/g, '');
    if (!to) return;
    if (!token || !phoneId) {
      this.logger.log(`[whatsapp → ${to}] ${msg.text}`);
      return;
    }
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: msg.link ? `${msg.text}\n${msg.link}` : msg.text },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`WhatsApp responded ${res.status}`);
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

@Global()
@Module({ providers: [NotificationsService], exports: [NotificationsService] })
export class NotificationsModule {}
