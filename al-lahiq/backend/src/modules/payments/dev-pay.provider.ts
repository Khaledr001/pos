import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppConfig } from '../../config/app-config.service.js';
import type { PaymentOrder, PaymentProvider } from './payment-provider.js';

/**
 * Fake card gateway for local development and automated tests
 * (DEV_PAYMENTS=true, never in production). Redirects to a frontend page
 * with "Pay" and "Fail" buttons.
 */
@Injectable()
export class DevPayProvider implements PaymentProvider {
  readonly name = 'devpay';
  readonly methods = ['CARD', 'APPLE_PAY', 'GOOGLE_PAY'] as const satisfies PaymentProvider['methods'];

  constructor(private readonly config: AppConfig) {}

  get enabled() {
    return this.config.get('DEV_PAYMENTS') && !this.config.isProduction;
  }

  async createSession(order: PaymentOrder) {
    const ref = `dev_${randomUUID()}`;
    const url = new URL('/checkout/pay/dev', this.config.get('FRONTEND_URL'));
    url.searchParams.set('ref', ref);
    url.searchParams.set('order', order.trackingToken);
    return { providerRef: ref, redirectUrl: url.toString() };
  }

  async refund() {
    // Nothing to do: no money moved.
  }
}
