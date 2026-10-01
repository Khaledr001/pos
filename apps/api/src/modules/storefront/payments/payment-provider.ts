/** A card gateway, as checkout sees it. Stripe and the dev test gateway implement it. */
export interface PaymentSessionRequest {
  orderId: string;
  orderNumber: string;
  tenantId: string;
  /** Whole minor units (fils). Exact: the order total is already rounded to the currency's decimals. */
  amountMinor: number;
  currency: string;
  email: string;
  trackingToken: string;
  successUrl: string;
  cancelUrl: string;
}

export interface PaymentSession {
  providerRef: string;
  redirectUrl: string;
}

export interface PaymentProvider {
  readonly name: string;
  createSession(request: PaymentSessionRequest): Promise<PaymentSession>;
  refund(providerRef: string, amountMinor: number): Promise<void>;
}
