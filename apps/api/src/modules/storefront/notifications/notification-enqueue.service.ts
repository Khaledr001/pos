import { createHash } from "node:crypto";
import { and, desc, eq, schema, type Transaction } from "@devsfleet/db";
import type { NotificationEvent, WebOrderStatus } from "@devsfleet/shared-types";
import { Money } from "@devsfleet/shared-utils";
import { Injectable, Logger } from "@nestjs/common";
import { RequestContext, type StorefrontScope } from "../../../common/context/request-context.js";
import { displayDecimals } from "../quotes/quote-view.js";
import { StorefrontResolver } from "../context/storefront-resolver.service.js";
import { dedupeKey, decideChannels, isMailbox } from "./channel-rules.js";
import { sanitizeDisplayName } from "./mail.service.js";
import { shopLink } from "./email-templates.js";
import type { LeadSnapshot, NotificationPayload, ShopSnapshot } from "./notification-types.js";
import type { NotificationSubjectKind } from "@devsfleet/db";
import { whatsappVariables } from "./whatsapp-variables.js";

/** The web order statuses that tell the shopper something. `packed` is the warehouse's business. */
export const ORDER_EVENT: Partial<Record<WebOrderStatus, NotificationEvent>> = {
  placed: "order_placed",
  confirmed: "order_confirmed",
  shipped: "order_shipped",
  ready_for_pickup: "order_ready_for_pickup",
  delivered: "order_delivered",
  collected: "order_delivered",
  cancelled: "order_cancelled",
  refunded: "order_refunded",
};

interface Subject {
  kind: NotificationSubjectKind;
  id: string;
  label: string;
  /** Separates a legitimate repeat of the same event for the same subject. */
  version?: string | number;
  email: string | null;
  phone: string | null;
  whatsappConsent: boolean;
}

/** `1.0000` -> `1`, `2.5000` -> `2.5`. Quantities only; money stays Minor4. */
function plainQuantity(q: string): string {
  return q.includes(".") ? q.replace(/0+$/, "").replace(/\.$/, "") : q;
}

/**
 * Turns a state change into outbox rows — INSIDE the transaction that made
 * the change, so the message exists if and only if the change committed.
 *
 * It decides, it does not send: the sweep sends. That keeps a slow or
 * failing mail server out of every checkout, status move and quote.
 */
@Injectable()
export class NotificationEnqueueService {
  private readonly logger = new Logger(NotificationEnqueueService.name);

  constructor(private readonly resolver: StorefrontResolver) {}

  /** A storefront request carries its scope; a staff route or a sweep resolves it from the tenant. */
  private async scope(): Promise<StorefrontScope | null> {
    const attached = RequestContext.get()?.storefront;
    if (attached) return attached;
    const tenantId = RequestContext.get()?.tenantId;
    return tenantId ? this.resolver.forTenant(tenantId, { evenIfDark: true }) : null;
  }

  private shop(scope: StorefrontScope): ShopSnapshot {
    const accent = scope.settings.theme.colors.accent;
    return {
      name: scope.settings.displayName ?? scope.name,
      logoUrl: scope.tenantSettings.logoUrl ?? null,
      accent,
      origin: scope.siteUrl.replace(/\/+$/, ""),
      phone: scope.tenantSettings.phone ?? "",
      email: scope.tenantSettings.email ?? "",
    };
  }

  private money(scope: StorefrontScope, decimals: number) {
    const { currency } = scope.tenantSettings;
    return (amount: string) =>
      Money.formatMoney(Money.roundTo(Money.toMinor(amount), decimals), {
        currency: currency.base,
        locale: scope.settings.region.formatLocale,
        decimals,
      });
  }

  // ── order ────────────────────────────────────────────────────────────────

  async enqueueOrder(tx: Transaction, orderId: string, status: WebOrderStatus): Promise<void> {
    const event = ORDER_EVENT[status];
    if (!event) return;
    const scope = await this.scope();
    if (!scope) return;

    const web = await tx.query.webOrders.findFirst({ where: (t, { eq: e }) => e(t.orderId, orderId) });
    // A cancelled order the shopper never completed (an abandoned card checkout) is not news to them.
    if (!web || (event === "order_cancelled" && !web.placedAt)) return;
    const order = await tx.query.orders.findFirst({ where: (t, { eq: e }) => e(t.id, orderId) });
    if (!order) return;

    const decimals = await displayDecimals(tx);
    const fmt = this.money(scope, decimals);
    const items = await tx.query.orderItems.findMany({
      where: (t, { eq: e }) => e(t.orderId, orderId),
      orderBy: (t, { asc }) => asc(t.sortOrder),
    });
    const branch = web.pickupBranchId
      ? await tx.query.branches.findFirst({ where: (t, { eq: e }) => e(t.id, web.pickupBranchId!), columns: { name: true } })
      : null;
    const shipment =
      event === "order_shipped"
        ? await tx.query.webShipments.findFirst({ where: (t, { eq: e }) => e(t.orderId, orderId), orderBy: (t, { desc: d }) => d(t.createdAt) })
        : null;
    let refundAmount: string | null = null;
    if (event === "order_refunded") {
      const [paid] = await tx
        .select({ amount: schema.webPayments.amount })
        .from(schema.webPayments)
        .where(and(eq(schema.webPayments.orderId, orderId), eq(schema.webPayments.status, "refunded")))
        .orderBy(desc(schema.webPayments.createdAt))
        .limit(1);
      refundAmount = fmt(paid?.amount ?? order.total);
    }

    const shop = this.shop(scope);
    await this.insert(tx, scope, event, {
      subject: {
        kind: "web_order",
        id: orderId,
        label: order.orderNumber,
        email: web.contactEmail,
        phone: web.contactPhone,
        whatsappConsent: web.whatsappOptIn,
      },
      customerName: web.contactName,
      shop,
      content: {
        order: {
          number: order.orderNumber,
          trackingUrl: shopLink(shop.origin, `track/${web.trackingToken}`),
          total: fmt(order.total),
          deliveryMethod: web.deliveryMethod,
          lines: items.map((i) => ({ name: i.productName, quantity: plainQuantity(i.quantity), total: fmt(i.total) })),
          pickupBranch: branch?.name ?? null,
          shipment: shipment
            ? { courier: shipment.courier, trackingNumber: shipment.trackingNumber, trackingUrl: shipment.trackingUrl }
            : null,
          refundAmount,
        },
      },
    });
  }

  // ── quote ────────────────────────────────────────────────────────────────

  async enqueueQuote(tx: Transaction, quoteId: string): Promise<void> {
    const scope = await this.scope();
    if (!scope) return;
    const quote = await tx.query.webQuotes.findFirst({ where: (t, { eq: e }) => e(t.id, quoteId) });
    if (!quote) return;

    // Quotes carry no consent of their own: WhatsApp only for a shopper who agreed to it on an order.
    const optedIn = quote.accountId
      ? !!(await tx.query.webOrders.findFirst({
          where: (t, { and: a, eq: e }) => a(e(t.accountId, quote.accountId!), e(t.whatsappOptIn, true)),
          columns: { orderId: true },
        }))
      : false;

    const decimals = await displayDecimals(tx);
    const fmt = this.money(scope, decimals);
    const shop = this.shop(scope);
    await this.insert(tx, scope, "quote_quoted", {
      subject: {
        kind: "web_quote",
        id: quoteId,
        label: quote.number,
        version: quote.quotedAt?.getTime() ?? 0,
        email: quote.contactEmail,
        phone: quote.contactPhone,
        whatsappConsent: optedIn,
      },
      customerName: quote.contactName,
      shop,
      content: {
        quote: {
          number: quote.number,
          total: fmt(quote.total),
          validUntil: quote.validUntil
            ? new Intl.DateTimeFormat(scope.settings.region.formatLocale, {
                dateStyle: "medium",
                timeZone: scope.tenantSettings.locale.timezone,
              }).format(quote.validUntil)
            : null,
          url: shopLink(shop.origin, `account/quotes/${quote.id}`),
        },
      },
    });
  }

  // ── back in stock ────────────────────────────────────────────────────────

  /**
   * One alert that has just been claimed (`status = notified`). A subscriber who
   * typed a phone number consented to WhatsApp by doing so: the form says so.
   */
  async enqueueStockAlert(tx: Transaction, subscriptionId: string): Promise<void> {
    const scope = await this.scope();
    if (!scope) return;
    const [row] = await tx
      .select({
        id: schema.stockAlertSubscriptions.id,
        email: schema.stockAlertSubscriptions.email,
        phone: schema.stockAlertSubscriptions.phone,
        token: schema.stockAlertSubscriptions.unsubscribeToken,
        notifiedAt: schema.stockAlertSubscriptions.notifiedAt,
        productName: schema.products.name,
        variantName: schema.productVariants.variantName,
        slug: schema.productListings.slug,
      })
      .from(schema.stockAlertSubscriptions)
      .innerJoin(schema.products, eq(schema.products.id, schema.stockAlertSubscriptions.productId))
      .innerJoin(schema.productVariants, eq(schema.productVariants.id, schema.stockAlertSubscriptions.variantId))
      .leftJoin(schema.productListings, eq(schema.productListings.productId, schema.products.id))
      .where(eq(schema.stockAlertSubscriptions.id, subscriptionId))
      .limit(1);
    if (!row) return;

    const shop = this.shop(scope);
    const name = row.variantName && row.variantName !== "Default" ? `${row.productName} (${row.variantName})` : row.productName;
    await this.insert(tx, scope, "stock_back_in_stock", {
      subject: {
        kind: "stock_alert",
        id: row.id,
        label: name,
        version: row.notifiedAt?.getTime() ?? 0,
        email: row.email,
        phone: row.phone,
        whatsappConsent: !!row.phone,
      },
      customerName: "",
      shop,
      content: {
        stockAlert: {
          productName: name,
          productUrl: row.slug ? shopLink(shop.origin, `product/${row.slug}`) : shop.origin,
          // Through the shop's own origin: the storefront proxies /api/v1/* to the platform API.
          unsubscribeUrl: shopLink(shop.origin, `api/v1/stock-alerts/unsubscribe/${row.token}`),
        },
      },
    });
  }

  // ── leads ────────────────────────────────────────────────────────────────

  /**
   * A form submission: an email to staff (the form's own addresses, or the
   * business email when it names none) and, if the form asks for it and the
   * visitor gave an address, an acknowledgement.
   *
   * Email only, and not shopper-configurable: nobody opts a business out of
   * hearing about a customer. `notifyStaff` is false when a flood of
   * submissions has already alerted staff enough — the leads are still stored
   * and sit in the inbox; only the mail is held back.
   */
  async enqueueLead(tx: Transaction, leadId: string, options: { notifyStaff: boolean }): Promise<void> {
    const scope = await this.scope();
    if (!scope) return;
    const lead = await tx.query.storefrontLeads.findFirst({ where: (t, { eq: e }) => e(t.id, leadId) });
    if (!lead) return;
    const form = lead.formId ? await tx.query.storefrontForms.findFirst({ where: (t, { eq: e }) => e(t.id, lead.formId!) }) : null;

    const shop = this.shop(scope);
    const settings = scope.settings.notifications;
    const snapshot: LeadSnapshot = {
      formName: lead.formName,
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      answers: lead.answers,
      productName: lead.productName,
      productSku: lead.productSku,
      sourcePath: lead.sourcePath,
    };
    const fromName = sanitizeDisplayName(settings.fromName ?? shop.name, shop.name);
    const shopReplyTo = [settings.replyTo, scope.tenantSettings.email].find((v) => isMailbox(v)) ?? null;
    const base = { shop, customerName: lead.name ?? "", fromName, lead: snapshot };
    const row = (event: "lead_received" | "lead_acknowledged", recipient: string, extra: { replyTo: string | null; status?: "skipped"; reason?: string }) => ({
      tenantId: scope.tenantId,
      storefrontId: scope.id,
      event,
      channel: "email" as const,
      recipient,
      subjectKind: "lead" as const,
      subjectId: lead.id,
      subjectLabel: `${lead.formName}${lead.name ? ` — ${lead.name}` : ""}`.slice(0, 255),
      // Hashed: an address can be 254 characters and the key column is 160.
      dedupeKey: dedupeKey(event, "email", lead.id, createHash("sha256").update(recipient).digest("hex").slice(0, 16)),
      status: extra.status ?? ("queued" as const),
      lastError: extra.reason ?? null,
      payload: { ...base, event, replyTo: extra.replyTo } as unknown as Record<string, unknown>,
    });

    const rows: ReturnType<typeof row>[] = [];
    if (options.notifyStaff) {
      const configured = (form?.notifyEmails ?? []).filter((e) => isMailbox(e));
      const recipients = [...new Set((configured.length > 0 ? configured : [scope.tenantSettings.email].filter(isMailbox)).map((e) => e.toLowerCase()))];
      // Staff reply goes straight to the visitor; the visitor's address was validated as a plain mailbox on the way in.
      const replyTo = isMailbox(lead.email) ? lead.email : shopReplyTo;
      if (recipients.length === 0) {
        rows.push(row("lead_received", "", { replyTo, status: "skipped", reason: "No staff email is set for this form, and the business has no email address." }));
      }
      for (const recipient of recipients) rows.push(row("lead_received", recipient, { replyTo }));
    }
    if (form?.acknowledge && isMailbox(lead.email)) {
      rows.push(row("lead_acknowledged", lead.email.toLowerCase(), { replyTo: shopReplyTo }));
    }
    if (rows.length === 0) return;
    await tx.insert(schema.storefrontNotifications).values(rows).onConflictDoNothing();
  }

  // ── shared ───────────────────────────────────────────────────────────────

  private async insert(
    tx: Transaction,
    scope: StorefrontScope,
    event: NotificationEvent,
    input: {
      subject: Subject;
      customerName: string;
      shop: ShopSnapshot;
      content: Pick<NotificationPayload, "order" | "quote" | "stockAlert">;
    },
  ): Promise<void> {
    const settings = scope.settings.notifications;
    const whatsappConnected = !!(await tx.query.whatsappAccounts.findFirst({
      where: (t, { eq: e }) => e(t.isActive, true),
      columns: { id: true },
    }));
    const decisions = decideChannels({
      event,
      settings,
      email: input.subject.email,
      phone: input.subject.phone,
      whatsappConsent: input.subject.whatsappConsent,
      whatsappConnected,
    });
    if (decisions.length === 0) return;

    const fromName = sanitizeDisplayName(settings.fromName ?? input.shop.name, input.shop.name);
    const replyTo = [settings.replyTo, scope.tenantSettings.email].find((v) => isMailbox(v)) ?? null;
    const base: NotificationPayload = {
      event,
      shop: input.shop,
      customerName: input.customerName,
      fromName,
      replyTo,
      ...input.content,
    };

    const rows = decisions.map((d) => {
      const payload: NotificationPayload =
        d.channel === "whatsapp" && d.action === "queue" && d.template
          ? { ...base, whatsapp: { template: d.template.name, language: d.template.language, variables: whatsappVariables(event, base) } }
          : base;
      return {
        tenantId: scope.tenantId,
        storefrontId: scope.id,
        event,
        channel: d.channel,
        recipient: d.action === "queue" ? d.recipient : (d.channel === "email" ? input.subject.email : input.subject.phone) ?? "",
        subjectKind: input.subject.kind,
        subjectId: input.subject.id,
        subjectLabel: input.subject.label.slice(0, 255),
        dedupeKey: dedupeKey(event, d.channel, input.subject.id, input.subject.version),
        status: d.action === "queue" ? ("queued" as const) : ("skipped" as const),
        lastError: d.action === "skip" ? d.reason : null,
        payload: payload as unknown as Record<string, unknown>,
      };
    });
    // A repeat of the same transition lands on the existing row and changes nothing.
    await tx.insert(schema.storefrontNotifications).values(rows).onConflictDoNothing();
  }
}
