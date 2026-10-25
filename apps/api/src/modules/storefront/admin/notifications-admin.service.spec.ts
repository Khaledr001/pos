import { resolveStorefrontSettings, resolveTenantSettings, WHATSAPP_TEMPLATE_DEFS } from "@devsfleet/shared-types";
import { describe, expect, it, vi } from "vitest";
import { RequestContext, type StorefrontScope } from "../../../common/context/request-context.js";
import type { TenantDatabase } from "../../../database/tenant-database.service.js";
import type { WhatsappTemplateService } from "../../whatsapp/whatsapp-template.service.js";
import type { StorefrontResolver } from "../context/storefront-resolver.service.js";
import type { MailService } from "../notifications/mail.service.js";
import { maskRecipient, NotificationsAdminService, samplePayload, templateStatuses } from "./notifications-admin.service.js";

const TENANT = "11111111-1111-4111-8111-111111111111";

function scope(notifications: Record<string, unknown> = {}): StorefrontScope {
  return {
    id: "sf",
    tenantId: TENANT,
    name: "Al Lahiq",
    siteUrl: "https://shop.example.com",
    tenantName: "Al Lahiq LLC",
    settings: resolveStorefrontSettings({ notifications } as never),
    tenantSettings: resolveTenantSettings({ email: "hi@example.com" }),
  } as StorefrontScope;
}

function setup(opts: { scope?: StorefrontScope | null; row?: unknown; mail?: Record<string, unknown>; templates?: Record<string, unknown> } = {}) {
  const updates: Array<Record<string, unknown>> = [];
  const tx = {
    query: {
      storefrontNotifications: { findFirst: async () => opts.row },
      storefronts: { findFirst: async () => ({ id: "sf", settings: {} }) },
    },
    update: () => ({ set: (v: Record<string, unknown>) => (updates.push(v), { where: async () => undefined }) }),
  };
  const db = { run: (fn: (t: unknown) => unknown) => fn(tx) } as unknown as TenantDatabase;
  const invalidateTenant = vi.fn();
  const resolver = { forTenant: async () => ("scope" in opts ? opts.scope : scope()), invalidateTenant } as unknown as StorefrontResolver;
  const mail = { configured: true, describeFrom: (n: string) => `${n} <orders@mail.example.com>`, send: vi.fn(async () => ({ ok: true as const, providerId: "m" })), ...opts.mail } as unknown as MailService;
  const templates = {
    listTemplates: vi.fn(async () => ({ connected: true, templates: [] })),
    createMissing: vi.fn(async () => []),
    sendTemplate: vi.fn(async () => ({ ok: true as const, waMessageId: "w" })),
    ...opts.templates,
  } as unknown as WhatsappTemplateService;
  return { svc: new NotificationsAdminService(db, resolver, mail, templates), updates, mail, templates, invalidateTenant };
}

const asStaff = <T>(fn: () => Promise<T>) => RequestContext.run({ requestId: "t", startedAt: 0, tenantId: TENANT }, fn);

describe("maskRecipient", () => {
  it("shows enough to recognise a shopper, not enough to harvest them", () => {
    expect(maskRecipient("email", "sara@example.com")).toBe("sa••@example.com");
    expect(maskRecipient("whatsapp", "+971501234567")).toBe("+971•••••••67");
    expect(maskRecipient("email", "no-at-sign")).toBe("no-at-sign");
  });
});

describe("overview", () => {
  it("reports mail configuration and every event's template state, 'missing' by default", async () => {
    const { svc } = setup();
    const out = await asStaff(() => svc.overview());
    expect(out.email).toEqual({ configured: true, from: "Al Lahiq <orders@mail.example.com>" });
    expect(out.whatsapp.connected).toBe(true);
    expect(out.whatsapp.templates).toHaveLength(9);
    expect(out.whatsapp.templates.every((t) => t.state === "missing")).toBe(true);
    expect(out.settings.events.order_placed).toEqual({ email: true, whatsapp: false });
  });

  it("merges Meta's states into the mapped (or default) template names", () => {
    const s = scope({ whatsappTemplates: { order_shipped: { name: "my_shipped", language: "en_US" } } });
    const statuses = templateStatuses(s, [
      { name: "df_order_placed", language: "en", state: "approved", reason: null },
      { name: "my_shipped", language: "en_US", state: "rejected", reason: "INVALID_FORMAT" },
    ]);
    expect(statuses.find((t) => t.event === "order_placed")).toMatchObject({ state: "approved", name: "df_order_placed" });
    expect(statuses.find((t) => t.event === "order_shipped")).toMatchObject({ state: "rejected", reason: "INVALID_FORMAT", name: "my_shipped", language: "en_US" });
    expect(statuses.find((t) => t.event === "order_cancelled")).toMatchObject({ state: "missing" });
  });

  it("reports a shop with no store as not found", async () => {
    await expect(asStaff(() => setup({ scope: null }).svc.overview())).rejects.toThrow(/online store/i);
  });
});

describe("syncTemplates", () => {
  it("submits missing defaults and records the approved ones in settings", async () => {
    const approved = WHATSAPP_TEMPLATE_DEFS.order_placed;
    const listTemplates = vi
      .fn()
      .mockResolvedValueOnce({ connected: true, templates: [] })
      .mockResolvedValue({ connected: true, templates: [{ name: approved.name, language: "en", state: "approved", reason: null }] });
    const { svc, templates, updates, invalidateTenant } = setup({ templates: { listTemplates } });
    await asStaff(() => svc.syncTemplates());
    expect((templates.createMissing as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toHaveLength(9);
    const saved = (updates[0]!.settings as { notifications: { whatsappTemplates: Record<string, unknown> } }).notifications.whatsappTemplates;
    expect(saved).toEqual({ order_placed: { name: "df_order_placed", language: "en" } });
    expect(invalidateTenant).toHaveBeenCalledWith(TENANT);
  });

  it("leaves a shop's own template mapping alone", async () => {
    const own = scope({ whatsappTemplates: { order_placed: { name: "custom_placed", language: "en" } } });
    const listTemplates = vi.fn().mockResolvedValue({ connected: true, templates: [{ name: "df_order_placed", language: "en", state: "approved", reason: null }] });
    const { svc, templates, updates } = setup({ scope: own, templates: { listTemplates } });
    await asStaff(() => svc.syncTemplates());
    const wanted = (templates.createMissing as ReturnType<typeof vi.fn>).mock.calls[0]![1] as Array<{ event: string }>;
    expect(wanted.map((w) => w.event)).not.toContain("order_placed");
    expect(updates).toEqual([]);
  });

  it("needs a connected number", async () => {
    const { svc } = setup({ templates: { listTemplates: async () => ({ connected: false, templates: [] }) } });
    await expect(asStaff(() => svc.syncTemplates())).rejects.toThrow(/Connect a WhatsApp number/);
  });

  it("surfaces Meta's refusal after saving what was approved", async () => {
    const { svc } = setup({ templates: { createMissing: async () => [{ event: "order_placed", message: "Invalid parameter" }] } });
    await expect(asStaff(() => svc.syncTemplates())).rejects.toThrow(/Meta refused 1 template/);
  });
});

describe("test send", () => {
  it("sends a [Test]-marked email through the real transport", async () => {
    const { svc, mail } = setup();
    expect(await asStaff(() => svc.test({ channel: "email", to: "owner@example.com", event: "order_placed" }))).toEqual({ ok: true, error: null });
    const sent = (mail.send as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(sent.subject.startsWith("[Test] ")).toBe(true);
    expect(sent.text).toContain("test message");
    expect(sent.to).toBe("owner@example.com");
  });

  it("does not claim success when mail is only being logged", async () => {
    const { svc } = setup({ mail: { send: async () => ({ ok: true, providerId: "log", simulated: true }) } });
    expect(await asStaff(() => svc.test({ channel: "email", to: "o@example.com", event: "order_placed" }))).toMatchObject({ ok: false, error: expect.stringContaining("not configured") });
  });

  it("rejects a bad address or number without sending", async () => {
    const { svc, mail, templates } = setup();
    expect(await asStaff(() => svc.test({ channel: "email", to: "nope", event: "order_placed" }))).toMatchObject({ ok: false });
    expect(await asStaff(() => svc.test({ channel: "whatsapp", to: "123", event: "order_placed" }))).toMatchObject({ ok: false });
    expect(mail.send).not.toHaveBeenCalled();
    expect(templates.sendTemplate).not.toHaveBeenCalled();
  });

  it("sends the mapped template with the sample values on WhatsApp, and explains when none is mapped", async () => {
    const mapped = setup({ scope: scope({ whatsappTemplates: { order_placed: { name: "df_order_placed", language: "en" } } }) });
    expect(await asStaff(() => mapped.svc.test({ channel: "whatsapp", to: "+971501234567", event: "order_placed" }))).toEqual({ ok: true, error: null });
    expect(mapped.templates.sendTemplate).toHaveBeenCalledWith(TENANT, expect.objectContaining({ templateName: "df_order_placed", variables: [...WHATSAPP_TEMPLATE_DEFS.order_placed.examples] }));
    const none = setup();
    expect(await asStaff(() => none.svc.test({ channel: "whatsapp", to: "+971501234567", event: "order_placed" }))).toMatchObject({ ok: false, error: expect.stringContaining("template") });
  });

  it("allows five tests an hour per shop", async () => {
    const { svc } = setup();
    for (let i = 0; i < 5; i++) await asStaff(() => svc.test({ channel: "email", to: "o@example.com", event: "order_placed" }));
    await expect(asStaff(() => svc.test({ channel: "email", to: "o@example.com", event: "order_placed" }))).rejects.toThrow(/5 test messages/);
  });

  it("builds the sample from the shop's own name and a sanitised From", () => {
    const p = samplePayload(scope({ fromName: "Support" }), "order_shipped");
    expect(p).toMatchObject({ event: "order_shipped", fromName: "Support", shop: { name: "Al Lahiq", origin: "https://shop.example.com" }, replyTo: "hi@example.com" });
  });
});

describe("retry", () => {
  const row = (over: Record<string, unknown>) => ({ id: "n1", status: "failed", channel: "email", lastError: "boom", ...over });

  it("requeues a failed message with a fresh attempt count", async () => {
    const { svc, updates } = setup({ row: row({}) });
    await asStaff(() => svc.retry("n1"));
    expect(updates[0]).toMatchObject({ status: "queued", attempts: 0, lastError: null });
  });

  it("requeues an email that was skipped only because mail was not configured", async () => {
    const { svc, updates } = setup({ row: row({ status: "skipped", lastError: "Email is not configured on this server; the message was logged, not sent." }) });
    await asStaff(() => svc.retry("n1"));
    expect(updates).toHaveLength(1);
  });

  it("refuses to retry a deliberate skip — consent and templates cannot be retried into existence", async () => {
    for (const lastError of ["The shopper did not agree to WhatsApp messages.", "No approved WhatsApp template is set for this message."]) {
      const { svc, updates } = setup({ row: row({ status: "skipped", channel: "whatsapp", lastError }) });
      await expect(asStaff(() => svc.retry("n1"))).rejects.toThrow(/skipped on purpose/);
      expect(updates).toEqual([]);
    }
  });

  it("refuses a message that is not failed, and one that does not exist", async () => {
    await expect(asStaff(() => setup({ row: row({ status: "sent" }) }).svc.retry("n1"))).rejects.toThrow(/Only a failed/);
    await expect(asStaff(() => setup({ row: undefined }).svc.retry("n1"))).rejects.toThrow(/does not exist/);
  });
});
