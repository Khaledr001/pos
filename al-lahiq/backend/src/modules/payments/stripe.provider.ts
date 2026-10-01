import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { AppConfig } from '../../config/app-config.service.js';
import type { PaymentOrder, PaymentProvider } from './payment-provider.js';

/**
 * Stripe Checkout in AED. Leaving payment_method_types unset lets Stripe show
 * cards, Apple Pay and Google Pay as enabled in the dashboard.
 */
@Injectable()
export class StripeProvider implements PaymentProvider {
  readonly name = 'stripe';
  readonly methods = ['CARD', 'APPLE_PAY', 'GOOGLE_PAY'] as const satisfies PaymentProvider['methods'];
  private client: Stripe | null = null;

  constructor(private readonly config: AppConfig) {}

  get configured() {
    return !!this.config.get('STRIPE_SECRET_KEY');
  }

  private get stripe() {
    if (!this.client) {
      const key = this.config.get('STRIPE_SECRET_KEY');
      if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
      this.client = new Stripe(key);
    }
    return this.client;
  }

  async createSession(order: PaymentOrder, urls: { success: string; cancel: string }) {
    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      currency: 'aed',
      customer_email: order.email,
      client_reference_id: order.id,
      metadata: { orderId: order.id, orderNumber: order.orderNumber },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'aed',
            unit_amount: order.totalFils, // AED minor unit = fils
            product_data: { name: `Order ${order.orderNumber}` },
          },
        },
      ],
      success_url: urls.success,
      cancel_url: urls.cancel,
      expires_at: Math.floor(Date.now() / 1000) + 45 * 60,
    });
    return { providerRef: session.id, redirectUrl: session.url! };
  }

  async refund(providerRef: string, amountFils: number) {
    const session = await this.stripe.checkout.sessions.retrieve(providerRef);
    const intent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
    if (!intent) throw new Error('Stripe session has no payment intent');
    await this.stripe.refunds.create({ payment_intent: intent, amount: amountFils });
  }

  /** Verifies and parses a webhook. Throws on a bad signature. */
  parseWebhook(rawBody: Buffer, signature: string | undefined) {
    const secret = this.config.get('STRIPE_WEBHOOK_SECRET');
    if (!secret || !signature) throw new Error('Stripe webhook secret or signature missing');
    return this.stripe.webhooks.constructEvent(rawBody, signature, secret);
  }
}
