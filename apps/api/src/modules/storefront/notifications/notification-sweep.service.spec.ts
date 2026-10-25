import { resolveStorefrontSettings, resolveTenantSettings } from "@devsfleet/shared-types";
import type { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";
import type { StorefrontScope } from "../../../common/context/request-context.js";
import type { Env } from "../../../config/env.js";
import type { TenantDatabase } from "../../../database/tenant-database.service.js";
import type { WhatsappTemplateService } from "../../whatsapp/whatsapp-template.service.js";
import type { StorefrontResolver } from "../context/storefront-resolver.service.js";
import { MAX_ATTEMPTS } from "./delivery-policy.js";
import { MailService } from "./mail.service.js";
import { NotificationSweepService } from "./notification-sweep.service.js";
import type { NotificationPayload } from "./notification-types.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const scope = { id: "sf", tenantId: TENANT, name: "Al Lahiq", siteUrl: "https://s.example.com", settings: resolveStorefrontSettings({}), tenantSettings: resolveTenantSettings({}) } as unknown as StorefrontScope;

const payload: NotificationPayload = {
  event: "order_placed",
  shop: { name: "Al Lahiq", logoUrl: null, accent: "#0e6b53", origin: "https://s.example.com", phone: "", email: "" },
  customerName: "Sara",
  fromName: "Al Lahiq",
  replyTo: null,
  order: { number: "W-1", trackingUrl: "https://s.example.com/track/t", total: "AED 10.00", deliveryMethod: "courier", lines: [], pickupBranch: null, shipment: null, refundAmount: null },
  whatsapp: { template: "df_order_placed", language: "en", variables: ["Sara", "W-1", "Al Lahiq", "AED 10.00", "https://s.example.com/track/t"] },
};

const claimed = (over: Record<string, unknown> = {}) => ({
  id: "n1",
  event: "order_placed",
  channel: "email",
  recipient: "sara@example.com",
  subject_kind: "web_order",
  subject_id: "o1",
  attempts: 1,
  payload,
  ...over,
});

function setup(opts: { rows?: unknown[]; storefront?: StorefrontScope | null; mail?: Partial<MailService>; sendTemplate?: unknown } = {}) {
  const updates: Array<Record<string, unknown>> = [];
  const tx = {
    execute: vi.fn(async () => opts.rows ?? []),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values);
        return { where: async () => undefined };
      },
    }),
  };
  const db = {
    runAsPlatformAdmin: async () => (opts.rows?.length ? [{ tenantId: TENANT }] : []),
    run: (fn: (t: unknown) => unknown) => fn(tx),
  } as unknown as TenantDatabase;
  const resolver = { forTenant: vi.fn(async () => ("storefront" in opts ? opts.storefront : scope)) } as unknown as StorefrontResolver;
  const mail = { send: vi.fn(async () => ({ ok: true as const, providerId: "<m1@x>" })), ...opts.mail } as unknown as MailService;
  const sendTemplate = vi.fn(opts.sendTemplate ?? (async () => ({ ok: true as const, waMessageId: "wamid.1" })));
  const templates = { sendTemplate } as unknown as WhatsappTemplateService;
  const config = { get: () => "test" } as unknown as ConfigService<Env, true>;
  const svc = new NotificationSweepService(db, resolver, mail, templates, config);
  return { svc, updates, mail, sendTemplate, resolver, tx };
}

describe("NotificationSweepService.sweep", () => {
  it("sends an email and marks the row sent with the provider id", async () => {
    const { svc, updates, mail } = setup({ rows: [claimed()] });
    expect(await svc.sweep()).toBe(1);
    const sent = (mail.send as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(sent).toMatchObject({ fromName: "Al Lahiq", to: "sara@example.com" });
    expect(sent.subject).toContain("W-1");
    expect(updates[0]).toMatchObject({ status: "sent", providerMessageId: "<m1@x>", lastError: null });
    expect(updates[0]!.sentAt).toBeInstanceOf(Date);
  });

  it("sends a WhatsApp row through the template service with the snapshotted variables", async () => {
    const { svc, updates, sendTemplate } = setup({ rows: [claimed({ channel: "whatsapp", recipient: "+971501234567" })] });
    await svc.sweep();
    expect(sendTemplate).toHaveBeenCalledWith(TENANT, { to: "+971501234567", templateName: "df_order_placed", language: "en", variables: payload.whatsapp!.variables });
    expect(updates[0]).toMatchObject({ status: "sent", providerMessageId: "wamid.1" });
  });

  it("requeues a retryable failure with a backoff, keeping the reason", async () => {
    const { svc, updates } = setup({
      rows: [claimed({ attempts: 2 })],
      mail: { send: vi.fn(async () => ({ ok: false as const, failure: { permanent: false, message: "421 try later" } })) },
    });
    await svc.sweep();
    expect(updates[0]).toMatchObject({ status: "queued", lastError: "421 try later" });
    expect((updates[0]!.nextAttemptAt as Date).getTime()).toBeGreaterThan(Date.now() + 100_000);
  });

  it("fails a permanent error at once, with no next attempt", async () => {
    const { svc, updates } = setup({
      rows: [claimed()],
      mail: { send: vi.fn(async () => ({ ok: false as const, failure: { permanent: true, message: "550 no such user" } })) },
    });
    await svc.sweep();
    expect(updates[0]).toMatchObject({ status: "failed", lastError: "550 no such user" });
    expect(updates[0]).not.toHaveProperty("nextAttemptAt");
  });

  it("gives up after MAX_ATTEMPTS", async () => {
    const { svc, updates } = setup({
      rows: [claimed({ attempts: MAX_ATTEMPTS })],
      mail: { send: vi.fn(async () => ({ ok: false as const, failure: { permanent: false, message: "timeout" } })) },
    });
    await svc.sweep();
    expect(updates[0]).toMatchObject({ status: "failed" });
  });

  it("does not call a logged-only email 'sent'", async () => {
    const { svc, updates } = setup({ rows: [claimed()], mail: { send: vi.fn(async () => ({ ok: true as const, providerId: "log-1", simulated: true as const })) } });
    await svc.sweep();
    expect(updates[0]).toMatchObject({ status: "skipped", lastError: expect.stringContaining("not configured") });
  });

  it("fails a WhatsApp row with no recorded template instead of guessing one", async () => {
    const { svc, updates, sendTemplate } = setup({ rows: [claimed({ channel: "whatsapp", recipient: "+971501234567", payload: { ...payload, whatsapp: undefined } })] });
    await svc.sweep();
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(updates[0]).toMatchObject({ status: "failed" });
  });

  it("propagates a template failure's permanence", async () => {
    const { svc, updates } = setup({
      rows: [claimed({ channel: "whatsapp", recipient: "+971501234567" })],
      sendTemplate: async () => ({ ok: false, permanent: true, message: "Template does not exist" }),
    });
    await svc.sweep();
    expect(updates[0]).toMatchObject({ status: "failed", lastError: "Template does not exist" });
  });

  it("marks a stock alert delivered only once a message has really left", async () => {
    const sent = setup({ rows: [claimed({ subject_kind: "stock_alert", subject_id: "s1" })] });
    await sent.svc.sweep();
    expect(sent.updates.some((u) => "deliveredAt" in u)).toBe(true);

    const failed = setup({
      rows: [claimed({ subject_kind: "stock_alert", subject_id: "s1" })],
      mail: { send: vi.fn(async () => ({ ok: false as const, failure: { permanent: true, message: "x" } })) },
    });
    await failed.svc.sweep();
    expect(failed.updates.some((u) => "deliveredAt" in u)).toBe(false);
  });

  it("sends nothing for a tenant whose shop is dark (suspended, lapsed trial, plan without the store)", async () => {
    const { svc, updates, mail, tx } = setup({ rows: [claimed()], storefront: null });
    expect(await svc.sweep()).toBe(0);
    expect(mail.send).not.toHaveBeenCalled();
    expect(tx.execute).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it("a rendering bug is retried a bounded number of times, not thrown out of the sweep", async () => {
    const { svc, updates } = setup({ rows: [claimed({ payload: { ...payload, order: undefined, shop: undefined } })] });
    await expect(svc.sweep()).resolves.toBe(1);
    expect(updates[0]).toMatchObject({ status: "queued" });
  });

  it("does nothing, and is quiet, when there is nothing due", async () => {
    const { svc, resolver } = setup({ rows: [] });
    expect(await svc.sweep()).toBe(0);
    expect(resolver.forTenant).not.toHaveBeenCalled();
  });

  it("never runs two sweeps at once in one process", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { svc, mail } = setup({ rows: [claimed()], mail: { send: vi.fn(async () => (await gate, { ok: true as const, providerId: "x" })) } });
    const first = svc.sweep();
    expect(await svc.sweep()).toBe(0);
    release();
    expect(await first).toBe(1);
    expect(mail.send).toHaveBeenCalledTimes(1);
  });
});
