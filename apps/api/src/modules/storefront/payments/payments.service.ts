import { and, eq, schema, sql, type Transaction } from "@devsfleet/db";
import type { DeliveryMethod, WebPaymentMethod } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES, Money } from "@devsfleet/shared-utils";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../../config/env.js";
import { RequestContext } from "../../../common/context/request-context.js";
import { TenantDatabase } from "../../../database/tenant-database.service.js";
import { OrdersService } from "../../orders/orders.service.js";
import { StorefrontResolver } from "../context/storefront-resolver.service.js";
import { WebOrdersService } from "../orders/web-orders.service.js";
import { toWire } from "../wire.js";
import { DevPayProvider } from "./dev-pay.provider.js";
import type { PaymentProvider } from "./payment-provider.js";
import { StripeClient, verifyStripeEvent } from "./stripe.client.js";

export interface PaymentMethodOption {
  method: Uppercase<WebPaymentMethod>;
  label: string;
  available: boolean;
  reason?: string;
}

const CARD_METHODS: WebPaymentMethod[] = ["card", "apple_pay", "google_pay"];
const LABELS: Record<WebPaymentMethod, string> = {
  card: "Credit / debit card",
  apple_pay: "Apple Pay",
  google_pay: "Google Pay",
  cod: "Cash on delivery",
};

/**
 * Online payment for web orders.
 *
 * A gateway only ever moves a web order from `pending_payment` to `placed`.
 * The stock was already held when the order was placed, and the POS order is
 * the same row either way — paying does not create anything, it releases the
 * order to the warehouse.
 */
@Injectable()
export class StorefrontPaymentsService {
  private readonly logger = new Logger(StorefrontPaymentsService.name);
  private readonly devPayments: boolean;

  constructor(
    private readonly db: TenantDatabase,
    private readonly orders: OrdersService,
    private readonly webOrders: WebOrdersService,
    private readonly resolver: StorefrontResolver,
    config: ConfigService<Env, true>,
  ) {
    this.devPayments =
      config.get("STOREFRONT_DEV_PAYMENTS", { infer: true }) && config.get("NODE_ENV", { infer: true }) !== "production";
  }

  /** The tenant's card gateway: its own Stripe account, else the dev gateway when enabled. */
  async gateway(tx: Transaction): Promise<PaymentProvider | null> {
    const { settings } = RequestContext.requireStorefront();
    if (!settings.checkout.card.enabled && !this.devPayments) return null;
    const account = await tx.query.storefrontPaymentAccounts.findFirst({
      where: (t, { and: a, eq: e }) => a(e(t.provider, "stripe"), e(t.isActive, true)),
    });
    if (account && settings.checkout.card.enabled) return new StripeClient(account.secretKey);
    return this.devPayments ? new DevPayProvider() : null;
  }

  options(total: bigint, deliveryMethod: DeliveryMethod, gateway: PaymentProvider | null): PaymentMethodOption[] {
    const { settings, tenantSettings } = RequestContext.requireStorefront();
    const card = CARD_METHODS.map((method) => ({
      method: toWire(method),
      label: LABELS[method] ?? method,
      available: !!gateway,
      ...(gateway ? {} : { reason: "Online payment is not set up yet" }),
    }));

    const cod = settings.checkout.cod;
    const codMax = Money.toMinor(cod.maxTotal);
    const codAvailable = cod.enabled && total <= codMax;
    return [
      ...card,
      {
        method: "COD",
        label: deliveryMethod === "pickup" ? "Pay at the store" : (LABELS.cod ?? "Cash on delivery"),
        available: codAvailable,
        ...(codAvailable
          ? {}
          : {
              reason: !cod.enabled
                ? "Not available"
                : `Available for orders up to ${Money.formatMoney(codMax, { currency: tenantSettings.currency.base })}`,
            }),
      },
    ];
  }

  /**
   * Open a gateway session for an order that has just been placed and
   * committed. Outside any transaction: it is a network call, and a slow
   * gateway must not hold row locks on the stock it reserved.
   */
  async start(orderId: string): Promise<string> {
    const { siteUrl, tenantSettings } = RequestContext.requireStorefront();
    const tenantId = RequestContext.requireTenantId();

    const { order, web, gateway } = await this.db.run(async (tx) => {
      const order = await tx.query.orders.findFirst({ where: (t, { eq: e }) => e(t.id, orderId) });
      const web = await tx.query.webOrders.findFirst({ where: (t, { eq: e }) => e(t.orderId, orderId) });
      return { order, web, gateway: await this.gateway(tx) };
    });
    if (!order || !web || !gateway) throw new AppError(ERROR_CODES.PAYMENT_FAILED, "Online payment is not available.");

    const amountMinor = Number(Money.roundTo(Money.toMinor(order.total), tenantSettings.currency.decimals) / 100n);
    const session = await gateway.createSession({
      orderId,
      orderNumber: order.orderNumber,
      tenantId,
      amountMinor,
      currency: tenantSettings.currency.base,
      email: web.contactEmail,
      trackingToken: web.trackingToken,
      successUrl: `${siteUrl}/checkout/success?order=${web.trackingToken}`,
      cancelUrl: `${siteUrl}/checkout?cancelled=${web.trackingToken}`,
    });

    await this.db.run((tx) =>
      tx.insert(schema.webPayments).values({
        tenantId,
        orderId,
        provider: gateway.name,
        providerRef: session.providerRef,
        method: web.paymentMethod,
        amount: order.total,
        status: "pending",
      }),
    );
    return session.redirectUrl;
  }

  /**
   * The gateway says paid. Idempotent — a webhook arrives at least once —
   * and the amount must match to the fils, or nothing moves.
   */
  async confirmPaid(provider: string, providerRef: string, amountMinor: number, raw: Record<string, unknown>): Promise<void> {
    await this.db.run(async (tx) => {
      const payment = await tx.query.webPayments.findFirst({
        where: (t, { and: a, eq: e }) => a(e(t.provider, provider), e(t.providerRef, providerRef)),
      });
      if (!payment) throw new AppError(ERROR_CODES.NOT_FOUND, "Unknown payment.");
      if (payment.status === "paid") return;

      const expected = Number(Money.roundTo(Money.toMinor(payment.amount), 2) / 100n);
      if (amountMinor !== expected) {
        this.logger.error({ providerRef, amountMinor, expected }, "Paid amount does not match the order");
        throw new AppError(ERROR_CODES.PAYMENT_FAILED, "The amount paid does not match the order.");
      }

      await tx.update(schema.webPayments).set({ status: "paid", raw }).where(eq(schema.webPayments.id, payment.id));
      const web = await tx.query.webOrders.findFirst({ where: (t, { eq: e }) => e(t.orderId, payment.orderId) });
      if (!web) return;

      if (web.status === "pending_payment") {
        await tx
          .update(schema.webOrders)
          .set({ status: "placed", paymentStatus: "paid", placedAt: new Date() })
          .where(eq(schema.webOrders.orderId, web.orderId));
        await this.webOrders.recordEvent(tx, web.orderId, "placed", `Paid online (${provider}).`);
      } else {
        // Paid after the order lapsed. The money is real; staff refund it.
        await tx.update(schema.webOrders).set({ paymentStatus: "paid" }).where(eq(schema.webOrders.orderId, web.orderId));
        await this.webOrders.recordEvent(tx, web.orderId, web.status, "Payment received after the order was cancelled — refund required.");
        this.logger.warn({ orderId: web.orderId }, "Late payment on a cancelled web order");
      }
    });
  }

  async markFailed(provider: string, providerRef: string): Promise<void> {
    await this.db.run((tx) =>
      tx
        .update(schema.webPayments)
        .set({ status: "failed" })
        .where(and(eq(schema.webPayments.provider, provider), eq(schema.webPayments.providerRef, providerRef), eq(schema.webPayments.status, "pending"))),
    );
  }

  /**
   * A Stripe webhook. It names the payment account in its URL; that account
   * says whose it is and which secret signs it. The tenant is set from the
   * account before anything is read, so the rest runs under RLS like any
   * storefront request.
   */
  async stripeWebhook(accountId: string, rawBody: Buffer | undefined, signature: string | undefined): Promise<void> {
    const account = await this.db.runAsPlatformAdmin(async (tx) =>
      tx.query.storefrontPaymentAccounts.findFirst({
        where: (t, { and: a, eq: e }) => a(e(t.id, accountId), e(t.provider, "stripe"), e(t.isActive, true)),
      }),
    );
    const event = account ? verifyStripeEvent(rawBody, signature, account.webhookSecret) : null;
    // One answer for an unknown account and a bad signature, so neither can be probed.
    if (!account || !event) throw new AppError(ERROR_CODES.VALIDATION_FAILED, "Invalid webhook.");

    const storefront = await this.resolver.forTenant(account.tenantId);
    if (!storefront) return; // A dark shop: nothing to update, and Stripe must not retry forever.
    RequestContext.setStorefront(storefront);

    const session = event.data.object as { id?: string; payment_status?: string; amount_total?: number; payment_intent?: unknown };
    if (!session.id) return;
    if (
      (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") &&
      session.payment_status === "paid"
    ) {
      await this.confirmPaid("stripe", session.id, session.amount_total ?? 0, {
        eventId: event.id,
        paymentIntent: typeof session.payment_intent === "string" ? session.payment_intent : null,
      });
    } else if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
      await this.markFailed("stripe", session.id);
    }
  }

  /** The dev gateway's "Pay" / "Decline" buttons. Refused unless dev payments are on. */
  async devComplete(providerRef: string, outcome: "success" | "fail"): Promise<{ status: string; trackingToken: string }> {
    if (!this.devPayments) throw new AppError(ERROR_CODES.NOT_FOUND, "Not found.");
    const payment = await this.db.run(async (tx) => {
      const found = await tx.query.webPayments.findFirst({
        where: (t, { and: a, eq: e }) => a(e(t.provider, "devpay"), e(t.providerRef, providerRef)),
      });
      const web = found ? await tx.query.webOrders.findFirst({ where: (t, { eq: e }) => e(t.orderId, found.orderId) }) : null;
      return found && web ? { ...found, trackingToken: web.trackingToken } : null;
    });
    if (!payment) throw new AppError(ERROR_CODES.NOT_FOUND, "Unknown payment.");

    if (outcome === "success") {
      await this.confirmPaid("devpay", providerRef, Number(Money.roundTo(Money.toMinor(payment.amount), 2) / 100n), { dev: true });
    } else {
      await this.markFailed("devpay", providerRef);
    }
    return { status: outcome, trackingToken: payment.trackingToken };
  }

  /**
   * Card orders nobody paid for. Their stock hold is released by cancelling
   * the POS order, so an abandoned checkout cannot sit on the last unit.
   * Run across every tenant by the expiry sweep, one order at a time under
   * that order's own tenant.
   */
  async expireUnpaid(olderThanMinutes: number): Promise<number> {
    const stale = await this.db.runAsPlatformAdmin((tx) =>
      tx
        .select({ orderId: schema.webOrders.orderId, tenantId: schema.webOrders.tenantId })
        .from(schema.webOrders)
        .where(
          and(
            eq(schema.webOrders.status, "pending_payment"),
            sql`${schema.webOrders.createdAt} < now() - make_interval(mins => ${olderThanMinutes})`,
          ),
        )
        .limit(200),
    );

    let expired = 0;
    for (const { orderId, tenantId } of stale) {
      const storefront = await this.resolver.forTenant(tenantId);
      if (!storefront) continue;
      await RequestContext.run({ requestId: `expire-${orderId}`, startedAt: Date.now() }, async () => {
        RequestContext.setStorefront(storefront);
        await this.db.run(async (tx) => {
          const web = await tx.query.webOrders.findFirst({ where: (t, { eq: e }) => e(t.orderId, orderId) });
          // Paid between the scan and now: leave it.
          if (web?.status !== "pending_payment" || web.paymentStatus === "paid") return;
          await this.orders.cancelInTransaction(tx, orderId, "Online payment was not completed in time.");
          await tx.update(schema.webOrders).set({ status: "cancelled" }).where(eq(schema.webOrders.orderId, orderId));
          await this.webOrders.recordEvent(tx, orderId, "cancelled", "Payment was not completed in time.");
          expired++;
        });
      });
    }
    return expired;
  }
}
