import type { PaymentMethod } from '../../generated/prisma/enums.js';

export interface PaymentOrder {
  id: string;
  orderNumber: string;
  totalFils: number;
  email: string;
  trackingToken: string;
}

export interface PaymentSession {
  providerRef: string;
  redirectUrl: string;
}

/**
 * Card/wallet gateway boundary. Stripe is implemented; Checkout.com, Telr,
 * Network International, Tabby and Tamara plug in the same way.
 */
export interface PaymentProvider {
  readonly name: string;
  readonly methods: PaymentMethod[];
  createSession(order: PaymentOrder, urls: { success: string; cancel: string }): Promise<PaymentSession>;
  refund(providerRef: string, amountFils: number): Promise<void>;
}
