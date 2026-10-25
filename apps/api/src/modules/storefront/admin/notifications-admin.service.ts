import { eq, schema, sql } from "@devsfleet/db";
import {
  NOTIFICATION_EVENTS,
  resolveStorefrontSettings,
  WHATSAPP_TEMPLATE_DEFS,
  type NotificationEvent,
  type NotificationLogPage,
  type NotificationOverview,
  type NotificationTemplateStatus,
} from "@devsfleet/shared-types";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { RequestContext, type StorefrontScope } from "../../../common/context/request-context.js";
import { TenantDatabase } from "../../../database/tenant-database.service.js";
import { WhatsappTemplateService, type RemoteTemplate } from "../../whatsapp/whatsapp-template.service.js";
import { StorefrontResolver } from "../context/storefront-resolver.service.js";
import { isMailbox, toE164 } from "../notifications/channel-rules.js";
import { renderEmail } from "../notifications/email-templates.js";
import { MailService, sanitizeDisplayName } from "../notifications/mail.service.js";
import type { NotificationPayload } from "../notifications/notification-types.js";
import type { ListNotificationLogDto, TestNotificationDto } from "./notifications.dto.js";

const PAGE_SIZE = 25;
const TESTS_PER_HOUR = 5;
const HOUR_MS = 60 * 60_000;

/** Skip reasons that a later fix (configuring mail) makes worth sending again. Everything else was deliberate. */
export const RETRYABLE_SKIP = /^Email is not configured/;

@Injectable()
export class NotificationsAdminService {
  /** Test sends per tenant, in memory: a guard against a stuck button, not a quota. */
  private readonly testSends = new Map<string, number[]>();

  constructor(
    private readonly db: TenantDatabase,
    private readonly resolver: StorefrontResolver,
    private readonly mail: MailService,
    private readonly templates: WhatsappTemplateService,
  ) {}

  private async scope(): Promise<StorefrontScope> {
    const scope = await this.resolver.forTenant(RequestContext.requireTenantId(), { evenIfDark: true });
    if (!scope) throw new AppError(ERROR_CODES.STOREFRONT_NOT_FOUND, "Set up the online store first.");
    return scope;
  }

  async overview(): Promise<NotificationOverview> {
    const scope = await this.scope();
    const settings = scope.settings.notifications;
    const remote = await this.templates.listTemplates(scope.tenantId);

    return {
      settings,
      email: {
        configured: this.mail.configured,
        from: this.mail.describeFrom(settings.fromName ?? scope.settings.displayName ?? scope.name),
      },
      whatsapp: { connected: remote.connected, templates: templateStatuses(scope, remote.templates) },
    };
  }

  /**
   * Submit the platform's default templates the shop does not have yet, then
   * map every default that Meta has approved to its event. Approval takes
   * minutes to days, so this is also the "refresh" button: run again later and
   * newly approved templates are picked up.
   */
  async syncTemplates(): Promise<NotificationOverview> {
    const scope = await this.scope();
    const settings = scope.settings.notifications;
    const before = await this.templates.listTemplates(scope.tenantId);
    if (!before.connected) throw new AppError(ERROR_CODES.VALIDATION_FAILED, "Connect a WhatsApp number first.");

    // Only events still on the platform's own template: a shop that mapped its own name keeps it.
    const wanted = NOTIFICATION_EVENTS.filter((e) => {
      const mapped = settings.whatsappTemplates[e];
      return !mapped || mapped.name === WHATSAPP_TEMPLATE_DEFS[e].name;
    }).map((event) => ({ event, def: WHATSAPP_TEMPLATE_DEFS[event] }));

    const refused = await this.templates.createMissing(scope.tenantId, wanted, before.templates);
    const after = await this.templates.listTemplates(scope.tenantId);

    const approved = wanted.filter(({ def }) =>
      after.templates.some((t) => t.name === def.name && t.language === def.language && t.state === "approved"),
    );
    const mapping = { ...settings.whatsappTemplates };
    let changed = false;
    for (const { event, def } of approved) {
      if (mapping[event]?.name === def.name) continue;
      if (mapping[event] && mapping[event]!.name !== def.name) continue;
      mapping[event] = { name: def.name, language: def.language };
      changed = true;
    }
    if (changed) {
      await this.db.run(async (tx) => {
        const row = await tx.query.storefronts.findFirst();
        if (!row) return;
        const current = resolveStorefrontSettings(row.settings);
        await tx
          .update(schema.storefronts)
          .set({ settings: { ...current, notifications: { ...current.notifications, whatsappTemplates: mapping } } })
          .where(eq(schema.storefronts.id, row.id));
      });
      this.resolver.invalidateTenant(scope.tenantId);
    }

    if (refused.length > 0) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        `Meta refused ${refused.length} template(s): ${refused[0]!.message}`,
      );
    }
    return this.overview();
  }

  /** A clearly-marked message through the real transport, so the shop can see it works before a shopper does. */
  async test(dto: TestNotificationDto): Promise<{ ok: boolean; error: string | null }> {
    const scope = await this.scope();
    this.takeTestSlot(scope.tenantId);

    if (dto.channel === "email") {
      if (!isMailbox(dto.to)) return { ok: false, error: "Enter a valid email address." };
      const payload = samplePayload(scope, dto.event);
      const email = renderEmail(payload);
      const result = await this.mail.send({
        fromName: payload.fromName,
        replyTo: payload.replyTo,
        to: dto.to.toLowerCase(),
        subject: `[Test] ${email.subject}`,
        html: email.html,
        text: `This is a test message from your online store.\n\n${email.text}`,
      });
      if (!result.ok) return { ok: false, error: result.failure.message };
      if (result.simulated) return { ok: false, error: "Email is not configured on this server, so nothing was sent." };
      return { ok: true, error: null };
    }

    const phone = toE164(dto.to);
    if (!phone) return { ok: false, error: "Enter a phone number with its country code." };
    const ref = scope.settings.notifications.whatsappTemplates[dto.event];
    if (!ref) return { ok: false, error: "No approved WhatsApp template is set for that message yet. Run the template setup first." };
    const result = await this.templates.sendTemplate(scope.tenantId, {
      to: phone,
      templateName: ref.name,
      language: ref.language,
      variables: [...WHATSAPP_TEMPLATE_DEFS[dto.event].examples],
    });
    return result.ok ? { ok: true, error: null } : { ok: false, error: result.message };
  }

  async log(dto: ListNotificationLogDto): Promise<NotificationLogPage> {
    const t = schema.storefrontNotifications;
    return this.db.run(async (tx) => {
      const where = sql`true ${dto.status ? sql`AND ${t.status} = ${dto.status}` : sql``} ${dto.channel ? sql`AND ${t.channel} = ${dto.channel}` : sql``}`;
      const [{ total } = { total: 0 }] = await tx.execute<{ total: number }>(sql`SELECT count(*)::int AS total FROM storefront_notifications WHERE ${where}`);
      const rows = await tx
        .select()
        .from(t)
        .where(where)
        .orderBy(sql`${t.createdAt} DESC`)
        .limit(PAGE_SIZE)
        .offset((dto.page - 1) * PAGE_SIZE);
      return {
        total: Number(total),
        page: dto.page,
        items: rows.map((r) => ({
          id: r.id,
          event: r.event,
          channel: r.channel,
          recipient: maskRecipient(r.channel, r.recipient),
          status: r.status,
          attempts: r.attempts,
          error: r.lastError,
          subject: r.subjectLabel,
          createdAt: r.createdAt.toISOString(),
          sentAt: r.sentAt ? r.sentAt.toISOString() : null,
        })),
      };
    });
  }

  /** Put a failed message back in the queue. A skipped one was skipped on purpose — except "email not configured". */
  async retry(id: string): Promise<{ queued: true }> {
    const t = schema.storefrontNotifications;
    await this.db.run(async (tx) => {
      const row = await tx.query.storefrontNotifications.findFirst({ where: (r, { eq: e }) => e(r.id, id) });
      if (!row) throw new AppError(ERROR_CODES.NOT_FOUND, "That message does not exist.");
      const allowed = row.status === "failed" || (row.status === "skipped" && row.channel === "email" && RETRYABLE_SKIP.test(row.lastError ?? ""));
      if (!allowed) {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          row.status === "skipped"
            ? `That message was skipped on purpose and cannot be retried: ${row.lastError ?? "no reason recorded"}`
            : "Only a failed message can be retried.",
        );
      }
      await tx.update(t).set({ status: "queued", attempts: 0, nextAttemptAt: new Date(), lastError: null }).where(eq(t.id, id));
    });
    return { queued: true };
  }

  private takeTestSlot(tenantId: string): void {
    const now = Date.now();
    const recent = (this.testSends.get(tenantId) ?? []).filter((at) => now - at < HOUR_MS);
    if (recent.length >= TESTS_PER_HOUR) {
      throw new AppError(ERROR_CODES.TOO_MANY_REQUESTS, `You can send ${TESTS_PER_HOUR} test messages an hour. Try again later.`);
    }
    this.testSends.set(tenantId, [...recent, now]);
  }
}

/** The log is staff-visible but is still a list of shoppers' contact details: show enough to recognise, not to harvest. */
export function maskRecipient(channel: string, value: string): string {
  if (channel === "email") {
    const [local = "", domain = ""] = value.split("@");
    return domain ? `${local.slice(0, 2)}${"•".repeat(Math.max(1, local.length - 2))}@${domain}` : value;
  }
  return value.length > 6 ? `${value.slice(0, 4)}${"•".repeat(value.length - 6)}${value.slice(-2)}` : value;
}

export function templateStatuses(scope: StorefrontScope, remote: RemoteTemplate[]): NotificationTemplateStatus[] {
  return NOTIFICATION_EVENTS.map((event) => {
    const def = WHATSAPP_TEMPLATE_DEFS[event];
    const ref = scope.settings.notifications.whatsappTemplates[event] ?? { name: def.name, language: def.language };
    const found = remote.find((t) => t.name === ref.name && t.language === ref.language);
    return { event, name: ref.name, language: ref.language, state: found?.state ?? "missing", reason: found?.reason ?? null };
  });
}

/** A realistic-looking message for the test button, built from the shop's own name, colours and contact details. */
export function samplePayload(scope: StorefrontScope, event: NotificationEvent): NotificationPayload {
  const shopName = scope.settings.displayName ?? scope.name;
  const origin = scope.siteUrl.replace(/\/+$/, "");
  const settings = scope.settings.notifications;
  return {
    event,
    shop: {
      name: shopName,
      logoUrl: scope.tenantSettings.logoUrl ?? null,
      accent: scope.settings.theme.colors.accent,
      origin,
      phone: scope.tenantSettings.phone ?? "",
      email: scope.tenantSettings.email ?? "",
    },
    customerName: "Sample Customer",
    fromName: sanitizeDisplayName(settings.fromName ?? shopName, shopName),
    replyTo: [settings.replyTo, scope.tenantSettings.email].find((v) => isMailbox(v)) ?? null,
    order: {
      number: "WEB-SAMPLE-000001",
      trackingUrl: `${origin}/track/sample`,
      total: "0.00",
      deliveryMethod: "courier",
      lines: [{ name: "Sample product", quantity: "1", total: "0.00" }],
      pickupBranch: shopName,
      shipment: { courier: "Sample courier", trackingNumber: "SAMPLE123", trackingUrl: null },
      refundAmount: "0.00",
    },
    quote: { number: "QT-WEB-SAMPLE-000001", total: "0.00", validUntil: null, url: `${origin}/account/quotes/sample` },
    stockAlert: { productName: "Sample product", productUrl: origin, unsubscribeUrl: origin },
  };
}
