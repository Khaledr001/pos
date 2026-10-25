import { resolveStorefrontSettings, resolveTenantSettings } from "@devsfleet/shared-types";
import { describe, expect, it, vi } from "vitest";
import { RequestContext, type StorefrontScope } from "../../../common/context/request-context.js";
import type { StorefrontResolver } from "../context/storefront-resolver.service.js";
import { NotificationEnqueueService, ORDER_EVENT } from "./notification-enqueue.service.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const ORDER = "22222222-2222-4222-8222-222222222222";
const QUOTE = "33333333-3333-4333-8333-333333333333";
const SUB = "44444444-4444-4444-8444-444444444444";

function scope(notifications: Record<string, unknown> = {}): StorefrontScope {
  return {
    id: "sf",
    tenantId: TENANT,
    name: "Al Lahiq",
    siteUrl: "https://shop.example.com/",
    tenantName: "Al Lahiq LLC",
    settings: resolveStorefrontSettings({ notifications } as never),
    tenantSettings: resolveTenantSettings({ phone: "+97140000000", email: "hi@example.com" }),
  } as StorefrontScope;
}

const WHATSAPP_ON = {
  events: Object.fromEntries(
    ["order_placed", "order_shipped", "order_cancelled", "quote_quoted", "stock_back_in_stock"].map((e) => [e, { email: true, whatsapp: true }]),
  ),
  whatsappTemplates: {
    order_placed: { name: "df_order_placed", language: "en" },
    order_shipped: { name: "df_order_shipped", language: "en" },
    quote_quoted: { name: "df_quote_ready", language: "en" },
    stock_back_in_stock: { name: "df_back_in_stock", language: "en" },
  },
};

const web = (over: Record<string, unknown> = {}) => ({
  orderId: ORDER,
  trackingToken: "tok-1",
  contactName: "Sara",
  contactEmail: "sara@example.com",
  contactPhone: "+971501234567",
  whatsappOptIn: true,
  deliveryMethod: "courier",
  pickupBranchId: null,
  placedAt: new Date(),
  ...over,
});

function fakeTx(opts: { web?: unknown; connected?: boolean; optedInOrder?: boolean; quote?: unknown; stockRow?: unknown } = {}) {
  const inserted: Array<Record<string, unknown>> = [];
  const tx = {
    query: {
      webOrders: { findFirst: vi.fn(async (arg?: unknown) => ("web" in opts ? opts.web : web()) ?? (arg ? undefined : undefined)) },
      orders: { findFirst: async () => ({ orderNumber: "WEB-2026-000123", total: "245.0000" }) },
      tenants: { findFirst: async () => ({ settings: {} }) },
      orderItems: { findMany: async () => [{ productName: "Mixer tap", quantity: "2.0000", total: "200.0000" }] },
      branches: { findFirst: async () => ({ name: "Dubai" }) },
      webShipments: { findFirst: async () => ({ courier: "Aramex", trackingNumber: "T1", trackingUrl: null }) },
      whatsappAccounts: { findFirst: async () => (opts.connected === false ? undefined : { id: "wa" }) },
      webQuotes: { findFirst: async () => opts.quote },
    },
    select: () => ({
      from: () => ({
        innerJoin: () => ({ innerJoin: () => ({ leftJoin: () => ({ where: () => ({ limit: async () => (opts.stockRow ? [opts.stockRow] : []) }) }) }), where: () => ({ orderBy: () => ({ limit: async () => [{ amount: "245.0000" }] }) }) }),
        where: () => ({ orderBy: () => ({ limit: async () => [{ amount: "245.0000" }] }) }),
      }),
    }),
    insert: () => ({
      values: (rows: Array<Record<string, unknown>>) => {
        inserted.push(...rows);
        return { onConflictDoNothing: async () => undefined };
      },
    }),
  };
  return { tx: tx as never, inserted };
}

const resolver = {} as StorefrontResolver;
const run = <T>(s: StorefrontScope, fn: () => Promise<T>) =>
  RequestContext.run({ requestId: "t", startedAt: 0, tenantId: TENANT, storefront: s }, fn);

describe("ORDER_EVENT", () => {
  it("maps the statuses a shopper should hear about and leaves the rest", () => {
    expect(ORDER_EVENT.placed).toBe("order_placed");
    expect(ORDER_EVENT.collected).toBe("order_delivered");
    expect(ORDER_EVENT.delivered).toBe("order_delivered");
    expect(ORDER_EVENT.packed).toBeUndefined();
    expect(ORDER_EVENT.pending_payment).toBeUndefined();
  });
});

describe("enqueueOrder", () => {
  const svc = () => new NotificationEnqueueService(resolver);

  it("queues an email by default and snapshots the order in the shop's currency", async () => {
    const { tx, inserted } = fakeTx();
    await run(scope(), () => svc().enqueueOrder(tx, ORDER, "placed"));
    expect(inserted).toHaveLength(1);
    const row = inserted[0]!;
    expect(row).toMatchObject({
      event: "order_placed",
      channel: "email",
      recipient: "sara@example.com",
      status: "queued",
      subjectKind: "web_order",
      subjectId: ORDER,
      subjectLabel: "WEB-2026-000123",
      dedupeKey: `order_placed:email:${ORDER}`,
    });
    const payload = row.payload as { order: { total: string; trackingUrl: string; lines: unknown[] }; shop: { origin: string } };
    expect(payload.order.total).toContain("245.00");
    expect(payload.order.total).toContain("AED");
    expect(payload.order.trackingUrl).toBe("https://shop.example.com/track/tok-1");
    expect(payload.order.lines).toEqual([{ name: "Mixer tap", quantity: "2", total: expect.stringContaining("200.00") }]);
    expect(payload.shop.origin).toBe("https://shop.example.com");
  });

  it("adds a WhatsApp row with the template and its variables when consent and a template exist", async () => {
    const { tx, inserted } = fakeTx();
    await run(scope(WHATSAPP_ON), () => svc().enqueueOrder(tx, ORDER, "placed"));
    const wa = inserted.find((r) => r.channel === "whatsapp")!;
    expect(wa).toMatchObject({ status: "queued", recipient: "+971501234567", dedupeKey: `order_placed:whatsapp:${ORDER}` });
    const payload = wa.payload as { whatsapp: { template: string; variables: string[] } };
    expect(payload.whatsapp.template).toBe("df_order_placed");
    expect(payload.whatsapp.variables).toHaveLength(5);
    expect(payload.whatsapp.variables[1]).toBe("WEB-2026-000123");
  });

  it("records a skipped row with the reason when the shopper did not consent", async () => {
    const { tx, inserted } = fakeTx({ web: web({ whatsappOptIn: false }) });
    await run(scope(WHATSAPP_ON), () => svc().enqueueOrder(tx, ORDER, "placed"));
    const wa = inserted.find((r) => r.channel === "whatsapp")!;
    expect(wa).toMatchObject({ status: "skipped", lastError: expect.stringContaining("did not agree") });
    expect(inserted.find((r) => r.channel === "email")!.status).toBe("queued");
  });

  it("skips WhatsApp when the shop has no connected account", async () => {
    const { tx, inserted } = fakeTx({ connected: false });
    await run(scope(WHATSAPP_ON), () => svc().enqueueOrder(tx, ORDER, "placed"));
    expect(inserted.find((r) => r.channel === "whatsapp")).toMatchObject({ status: "skipped", lastError: expect.stringContaining("No WhatsApp Business account") });
  });

  it("does nothing for statuses that carry no message", async () => {
    const { tx, inserted } = fakeTx();
    await run(scope(), () => svc().enqueueOrder(tx, ORDER, "packed"));
    await run(scope(), () => svc().enqueueOrder(tx, ORDER, "pending_payment"));
    expect(inserted).toEqual([]);
  });

  it("does not announce the cancellation of an order the shopper never completed", async () => {
    const { tx, inserted } = fakeTx({ web: web({ placedAt: null }) });
    await run(scope(), () => svc().enqueueOrder(tx, ORDER, "cancelled"));
    expect(inserted).toEqual([]);
  });

  it("announces the cancellation of a placed order", async () => {
    const { tx, inserted } = fakeTx();
    await run(scope(), () => svc().enqueueOrder(tx, ORDER, "cancelled"));
    expect(inserted[0]).toMatchObject({ event: "order_cancelled" });
  });

  it("queues nothing when every rule is off for the event", async () => {
    const { tx, inserted } = fakeTx();
    await run(scope({ events: { order_placed: { email: false, whatsapp: false } } }), () => svc().enqueueOrder(tx, ORDER, "placed"));
    expect(inserted).toEqual([]);
  });

  it("does nothing outside a storefront with no resolvable scope", async () => {
    const { tx, inserted } = fakeTx();
    const noScope = { forTenant: async () => null } as unknown as StorefrontResolver;
    await RequestContext.run({ requestId: "t", startedAt: 0, tenantId: TENANT }, () => new NotificationEnqueueService(noScope).enqueueOrder(tx, ORDER, "placed"));
    expect(inserted).toEqual([]);
  });

  it("resolves the scope from the tenant on a staff route", async () => {
    const { tx, inserted } = fakeTx();
    const forTenant = vi.fn(async () => scope());
    await RequestContext.run({ requestId: "t", startedAt: 0, tenantId: TENANT }, () =>
      new NotificationEnqueueService({ forTenant } as unknown as StorefrontResolver).enqueueOrder(tx, ORDER, "shipped"),
    );
    expect(forTenant).toHaveBeenCalledWith(TENANT, { evenIfDark: true });
    expect(inserted[0]).toMatchObject({ event: "order_shipped" });
  });

  it("puts the shipment on a shipped message", async () => {
    const { tx, inserted } = fakeTx();
    await run(scope(), () => svc().enqueueOrder(tx, ORDER, "shipped"));
    expect((inserted[0]!.payload as { order: { shipment: unknown } }).order.shipment).toEqual({ courier: "Aramex", trackingNumber: "T1", trackingUrl: null });
  });

  it("sanitises the From name and takes reply-to from settings, then the business email", async () => {
    const a = fakeTx();
    await run(scope({ fromName: "Al Lahiq Support", replyTo: "care@example.com" }), () => svc().enqueueOrder(a.tx, ORDER, "placed"));
    expect(a.inserted[0]!.payload).toMatchObject({ fromName: "Al Lahiq Support", replyTo: "care@example.com" });
    const b = fakeTx();
    await run(scope(), () => svc().enqueueOrder(b.tx, ORDER, "placed"));
    expect(b.inserted[0]!.payload).toMatchObject({ replyTo: "hi@example.com" });
  });
});

describe("enqueueQuote", () => {
  const quote = {
    id: QUOTE,
    number: "QT-WEB-2026-000012",
    total: "1000.0000",
    accountId: "acct",
    contactName: "Omar",
    contactEmail: "omar@example.com",
    contactPhone: "+971501112222",
    quotedAt: new Date(1_790_000_000_000),
    validUntil: new Date("2026-12-01T00:00:00Z"),
  };

  it("queues an email with a per-pricing dedupe version, so a re-quote notifies again", async () => {
    const { tx, inserted } = fakeTx({ quote });
    await run(scope(), () => new NotificationEnqueueService(resolver).enqueueQuote(tx, QUOTE));
    expect(inserted[0]).toMatchObject({ event: "quote_quoted", subjectKind: "web_quote", dedupeKey: `quote_quoted:email:${QUOTE}:1790000000000` });
    expect((inserted[0]!.payload as { quote: { url: string } }).quote.url).toBe(`https://shop.example.com/account/quotes/${QUOTE}`);
  });

  it("sends WhatsApp only to a shopper who opted in on an order", async () => {
    const yes = fakeTx({ quote, web: web() });
    await run(scope(WHATSAPP_ON), () => new NotificationEnqueueService(resolver).enqueueQuote(yes.tx, QUOTE));
    expect(yes.inserted.find((r) => r.channel === "whatsapp")!.status).toBe("queued");

    const no = fakeTx({ quote, web: null });
    await run(scope(WHATSAPP_ON), () => new NotificationEnqueueService(resolver).enqueueQuote(no.tx, QUOTE));
    expect(no.inserted.find((r) => r.channel === "whatsapp")).toMatchObject({ status: "skipped", lastError: expect.stringContaining("did not agree") });
  });
});

describe("enqueueStockAlert", () => {
  const row = { id: SUB, email: "buyer@example.com", phone: "+971501112222", token: "tok-u", notifiedAt: new Date(1_790_000_000_000), productName: "Mixer tap", variantName: "Chrome", slug: "mixer-tap" };

  it("builds the product and unsubscribe links on the shop's own origin", async () => {
    const { tx, inserted } = fakeTx({ stockRow: row });
    await run(scope(), () => new NotificationEnqueueService(resolver).enqueueStockAlert(tx, SUB));
    expect(inserted[0]).toMatchObject({ event: "stock_back_in_stock", subjectKind: "stock_alert", subjectLabel: "Mixer tap (Chrome)", dedupeKey: `stock_back_in_stock:email:${SUB}:1790000000000` });
    expect((inserted[0]!.payload as { stockAlert: unknown }).stockAlert).toEqual({
      productName: "Mixer tap (Chrome)",
      productUrl: "https://shop.example.com/product/mixer-tap",
      unsubscribeUrl: "https://shop.example.com/api/v1/stock-alerts/unsubscribe/tok-u",
    });
  });

  it("treats a supplied phone as WhatsApp consent, and no phone as email only", async () => {
    const withPhone = fakeTx({ stockRow: row });
    await run(scope(WHATSAPP_ON), () => new NotificationEnqueueService(resolver).enqueueStockAlert(withPhone.tx, SUB));
    expect(withPhone.inserted.find((r) => r.channel === "whatsapp")!.status).toBe("queued");

    const noPhone = fakeTx({ stockRow: { ...row, phone: null } });
    await run(scope(WHATSAPP_ON), () => new NotificationEnqueueService(resolver).enqueueStockAlert(noPhone.tx, SUB));
    expect(noPhone.inserted.find((r) => r.channel === "whatsapp")!.status).toBe("skipped");
  });

  it("does nothing for a subscription that is gone", async () => {
    const { tx, inserted } = fakeTx();
    await run(scope(), () => new NotificationEnqueueService(resolver).enqueueStockAlert(tx, SUB));
    expect(inserted).toEqual([]);
  });
});
