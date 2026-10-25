import { schema, sql } from "@devsfleet/db";
import type { NotificationChannel, NotificationEvent } from "@devsfleet/shared-types";
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RequestContext } from "../../../common/context/request-context.js";
import type { Env } from "../../../config/env.js";
import { TenantDatabase } from "../../../database/tenant-database.service.js";
import { WhatsappTemplateService } from "../../whatsapp/whatsapp-template.service.js";
import { StorefrontResolver } from "../context/storefront-resolver.service.js";
import { afterFailure, STUCK_SENDING_MS, type SendFailure } from "./delivery-policy.js";
import { renderEmail } from "./email-templates.js";
import { MailService } from "./mail.service.js";
import type { NotificationPayload } from "./notification-types.js";

const SWEEP_EVERY_MS = 30_000;
const TENANT_LIMIT = 50;
const BATCH_PER_TENANT = 25;

type ClaimedRow = {
  id: string;
  event: NotificationEvent;
  channel: NotificationChannel;
  recipient: string;
  subject_kind: string;
  subject_id: string;
  attempts: number;
  payload: NotificationPayload;
};

type SendOutcome =
  | { kind: "sent"; providerId: string }
  | { kind: "simulated"; note: string }
  | { kind: "failed"; failure: SendFailure };

/**
 * Sends what the outbox holds.
 *
 * A plain interval like the payment-expiry and stock-alert sweeps. The claim is
 * ONE statement — `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)` — so
 * two API instances sweeping at once each take different rows and a shopper is
 * never messaged twice. The claim commits BEFORE anything is sent: no
 * transaction is held open across a mail server or Meta.
 *
 * A row left `sending` by a worker that died is reclaimed after
 * STUCK_SENDING_MS. That can, rarely, send once more than intended (the worker
 * died after the provider accepted but before the row was marked); the other
 * choice is a message that never goes out.
 */
@Injectable()
export class NotificationSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationSweepService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly db: TenantDatabase,
    private readonly resolver: StorefrontResolver,
    private readonly mail: MailService,
    private readonly templates: WhatsappTemplateService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    if (this.config.get("NODE_ENV", { infer: true }) === "test") return;
    this.timer = setInterval(() => void this.sweep(), SWEEP_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Returns how many messages were attempted. Never throws: a failed sweep is logged and the next one tries again. */
  async sweep(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const tenants = await this.db.runAsPlatformAdmin((tx) =>
        tx
          .selectDistinct({ tenantId: schema.storefrontNotifications.tenantId })
          .from(schema.storefrontNotifications)
          .where(
            sql`(${schema.storefrontNotifications.status} = 'queued' AND ${schema.storefrontNotifications.nextAttemptAt} <= now())
              OR (${schema.storefrontNotifications.status} = 'sending' AND ${schema.storefrontNotifications.updatedAt} < now() - make_interval(secs => ${STUCK_SENDING_MS / 1000}))`,
          )
          .limit(TENANT_LIMIT),
      );

      let attempted = 0;
      for (const { tenantId } of tenants) {
        // A suspended tenant, a lapsed trial or a plan without the online store sends nothing.
        const storefront = await this.resolver.forTenant(tenantId);
        if (!storefront) continue;
        attempted += await RequestContext.run({ requestId: `notifications-${tenantId}`, startedAt: Date.now() }, async () => {
          RequestContext.setStorefront(storefront);
          return this.sendForTenant(tenantId);
        });
      }
      if (attempted > 0) this.logger.log(`Attempted ${attempted} shopper notification(s)`);
      return attempted;
    } catch (error) {
      this.logger.error({ err: error }, "Notification sweep failed");
      return 0;
    } finally {
      this.running = false;
    }
  }

  private async sendForTenant(tenantId: string): Promise<number> {
    const claimed = await this.db.run((tx) =>
      tx.execute<ClaimedRow>(sql`
        UPDATE storefront_notifications
           SET status = 'sending', attempts = attempts + 1
         WHERE id IN (
           SELECT id FROM storefront_notifications
            WHERE (status = 'queued' AND next_attempt_at <= now())
               OR (status = 'sending' AND updated_at < now() - make_interval(secs => ${STUCK_SENDING_MS / 1000}))
            ORDER BY next_attempt_at
            LIMIT ${BATCH_PER_TENANT}
              FOR UPDATE SKIP LOCKED)
        RETURNING id, event, channel, recipient, subject_kind, subject_id, attempts, payload`),
    );

    let attempted = 0;
    for (const row of claimed) {
      attempted++;
      const outcome = await this.deliver(tenantId, row);
      await this.record(row, outcome);
    }
    return attempted;
  }

  private async deliver(tenantId: string, row: ClaimedRow): Promise<SendOutcome> {
    const payload = row.payload;
    try {
      if (row.channel === "email") {
        const email = renderEmail(payload);
        const result = await this.mail.send({
          fromName: payload.fromName,
          replyTo: payload.replyTo,
          to: row.recipient,
          subject: email.subject,
          html: email.html,
          text: email.text,
          ...(payload.stockAlert
            ? {
                headers: {
                  "List-Unsubscribe": `<${payload.stockAlert.unsubscribeUrl}>`,
                  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
                },
              }
            : {}),
        });
        if (!result.ok) return { kind: "failed", failure: result.failure };
        return result.simulated
          ? { kind: "simulated", note: "Email is not configured on this server; the message was logged, not sent." }
          : { kind: "sent", providerId: result.providerId };
      }

      if (!payload.whatsapp) return { kind: "failed", failure: { permanent: true, message: "No WhatsApp template was recorded for this message." } };
      const result = await this.templates.sendTemplate(tenantId, {
        to: row.recipient,
        templateName: payload.whatsapp.template,
        language: payload.whatsapp.language,
        variables: payload.whatsapp.variables,
      });
      return result.ok
        ? { kind: "sent", providerId: result.waMessageId }
        : { kind: "failed", failure: { permanent: result.permanent, message: result.message } };
    } catch (error) {
      // A bug in rendering must not wedge the queue or retry forever: bounded retries, then failed.
      this.logger.error({ err: error }, "Notification delivery threw");
      return { kind: "failed", failure: { permanent: false, message: error instanceof Error ? error.message.slice(0, 300) : "Unexpected error" } };
    }
  }

  private async record(row: ClaimedRow, outcome: SendOutcome): Promise<void> {
    const table = schema.storefrontNotifications;
    try {
      await this.db.run(async (tx) => {
        // Guarded on `sending`: a row someone else already moved on is left alone.
        const where = sql`${table.id} = ${row.id} AND ${table.status} = 'sending'`;
        if (outcome.kind === "sent") {
          await tx.update(table).set({ status: "sent", sentAt: new Date(), providerMessageId: outcome.providerId.slice(0, 100), lastError: null }).where(where);
          if (row.subject_kind === "stock_alert") {
            await tx
              .update(schema.stockAlertSubscriptions)
              .set({ deliveredAt: new Date() })
              .where(sql`${schema.stockAlertSubscriptions.id} = ${row.subject_id} AND ${schema.stockAlertSubscriptions.deliveredAt} IS NULL`);
          }
        } else if (outcome.kind === "simulated") {
          await tx.update(table).set({ status: "skipped", lastError: outcome.note }).where(where);
        } else {
          const next = afterFailure(outcome.failure, row.attempts);
          await tx
            .update(table)
            .set({ status: next.status, lastError: outcome.failure.message.slice(0, 500), ...(next.nextAttemptAt ? { nextAttemptAt: next.nextAttemptAt } : {}) })
            .where(where);
        }
      });
    } catch (error) {
      // The message may have gone out; the stuck-row reclaim will settle the record.
      this.logger.error({ err: error }, "Could not record a notification outcome");
    }
  }
}

