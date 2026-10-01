import { randomUUID } from "node:crypto";
import type { PaymentProvider, PaymentSession, PaymentSessionRequest } from "./payment-provider.js";

/**
 * A pretend card gateway for local development and automated tests. Sends
 * the shopper to the storefront's own test page, which offers "Pay" and
 * "Decline". Refused at boot in production (see env.ts).
 */
export class DevPayProvider implements PaymentProvider {
  readonly name = "devpay";

  async createSession(request: PaymentSessionRequest): Promise<PaymentSession> {
    const providerRef = `dev_${randomUUID()}`;
    const url = new URL(request.successUrl);
    url.pathname = "/checkout/pay/dev";
    url.search = "";
    url.searchParams.set("ref", providerRef);
    url.searchParams.set("order", request.trackingToken);
    return { providerRef, redirectUrl: url.toString() };
  }

  async refund(): Promise<void> {
    // No money moved.
  }
}
