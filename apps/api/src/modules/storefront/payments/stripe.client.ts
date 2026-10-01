import { createHmac, timingSafeEqual } from "node:crypto";
import type { PaymentProvider, PaymentSession, PaymentSessionRequest } from "./payment-provider.js";

const STRIPE_API = "https://api.stripe.com/v1";
/** Stripe's own recommendation: refuse a signature older than five minutes. */
const SIGNATURE_TOLERANCE_S = 300;
/** Unpaid checkout sessions close, and the order's stock hold goes with them. */
export const PAYMENT_WINDOW_MINUTES = 45;

/** Stripe's form encoding: nested keys as `a[b][c]=v`. */
function encode(params: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(params).flatMap(([key, value]) => {
    const name = prefix ? `${prefix}[${key}]` : key;
    if (value === undefined || value === null) return [];
    if (typeof value === "object") return encode(value as Record<string, unknown>, name);
    return [`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`];
  });
}

/**
 * Stripe Checkout for one tenant's own Stripe account, over plain HTTPS.
 *
 * Three calls and a signature check do not justify the SDK. Leaving
 * `payment_method_types` unset lets the tenant's Stripe dashboard decide
 * between cards, Apple Pay and Google Pay.
 */
export class StripeClient implements PaymentProvider {
  readonly name = "stripe";

  constructor(private readonly secretKey: string) {}

  async createSession(request: PaymentSessionRequest): Promise<PaymentSession> {
    const session = await this.call<{ id: string; url: string }>("POST", "/checkout/sessions", {
      mode: "payment",
      currency: request.currency.toLowerCase(),
      customer_email: request.email,
      client_reference_id: request.orderId,
      metadata: { orderId: request.orderId, orderNumber: request.orderNumber, tenantId: request.tenantId },
      line_items: {
        0: {
          quantity: 1,
          price_data: {
            currency: request.currency.toLowerCase(),
            unit_amount: request.amountMinor,
            product_data: { name: `Order ${request.orderNumber}` },
          },
        },
      },
      success_url: request.successUrl,
      cancel_url: request.cancelUrl,
      expires_at: Math.floor(Date.now() / 1000) + PAYMENT_WINDOW_MINUTES * 60,
    });
    return { providerRef: session.id, redirectUrl: session.url };
  }

  async refund(providerRef: string, amountMinor: number): Promise<void> {
    const session = await this.call<{ payment_intent: string | { id: string } | null }>("GET", `/checkout/sessions/${encodeURIComponent(providerRef)}`);
    const intent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
    if (!intent) throw new Error("That Stripe session has no payment to refund.");
    await this.call("POST", "/refunds", { payment_intent: intent, amount: amountMinor });
  }

  private async call<T>(method: "GET" | "POST", path: string, params?: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${STRIPE_API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.secretKey}`,
        ...(params ? { "content-type": "application/x-www-form-urlencoded" } : {}),
      },
      body: params ? encode(params).join("&") : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
    if (!response.ok) throw new Error(`Stripe: ${body.error?.message ?? response.statusText}`);
    return body;
  }
}

/**
 * Verify a `Stripe-Signature` header against the exact bytes Stripe sent.
 * Returns the parsed event, or null — never throws on a forgery.
 */
export function verifyStripeEvent(
  rawBody: Buffer | undefined,
  header: string | undefined,
  secret: string,
  now = Date.now(),
): { id: string; type: string; data: { object: Record<string, unknown> } } | null {
  if (!rawBody || !header) return null;
  const parts = header.split(",").map((p) => p.trim().split("="));
  const timestamp = Number(parts.find(([k]) => k === "t")?.[1]);
  const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v ?? "");
  if (!Number.isFinite(timestamp) || signatures.length === 0) return null;
  if (Math.abs(now / 1000 - timestamp) > SIGNATURE_TOLERANCE_S) return null;

  const expected = createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest();
  const matches = signatures.some((signature) => {
    const given = Buffer.from(signature, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!matches) return null;

  try {
    return JSON.parse(rawBody.toString("utf8"));
  } catch {
    return null;
  }
}
