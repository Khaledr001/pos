import { eq, schema, sql } from "@devsfleet/db";
import type { WhatsappAccount } from "@devsfleet/db";
import type { Locale, MessageType } from "@devsfleet/shared-types";
import { normalizePhone } from "@devsfleet/shared-utils";
import { Injectable, Logger } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import type { WhatsappWebhookDto, WhatsappWebhookValue } from "./dto.js";

/** Meta's customer-service window. Free-form replies are refused after this. */
const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Message types Meta sends that map onto our own enum. */
const KNOWN_MESSAGE_TYPES = new Set<MessageType>([
  "text",
  "image",
  "document",
  "audio",
  "video",
  "location",
  "template",
  "interactive",
]);

export interface InboundMessage {
  tenantId: string;
  conversationId: string;
  messageId: string;
  /** False when this exact `waMessageId` was already stored — a redelivery. */
  isNew: boolean;
}

/**
 * The inbound half of WhatsApp: verify, resolve, persist.
 *
 * Everything here happens BEFORE any model is called, and that ordering is the
 * design. Meta retries any non-200 and gives a short window to answer, so the
 * message is made durable and the webhook is acknowledged first; the AI turn
 * runs afterwards, off the request. A model that takes nine seconds must not
 * cost a message.
 *
 * Nothing in this file talks to an LLM. Replying is Stage 8's next piece.
 */
@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(private readonly db: TenantDatabase) {}

  /**
   * Meta's subscription handshake.
   *
   * The GET carries no phone number id, so there is nothing to scope by — the
   * token itself has to identify the account. Matched in constant time across
   * active accounts rather than with a WHERE, so the comparison cannot be used
   * to probe for a valid token one character at a time.
   */
  async verifySubscription(mode: string | undefined, token: string | undefined): Promise<string | null> {
    if (mode !== "subscribe" || !token) return null;

    const accounts = await this.db.runAsPlatformAdmin(async (tx) =>
      tx
        .select({ verifyToken: schema.whatsappAccounts.verifyToken })
        .from(schema.whatsappAccounts)
        .where(eq(schema.whatsappAccounts.isActive, true)),
    );

    const matched = accounts.some((account) => constantTimeEquals(account.verifyToken, token));
    return matched ? token : null;
  }

  /**
   * The account this payload belongs to, or null.
   *
   * Reads across tenants — a webhook arrives with no session and no tenant
   * context, and `phone_number_id` is the only thing in it that says whose
   * message this is. Same pre-authentication pattern as resolving a tenant at
   * login.
   */
  async resolveAccount(phoneNumberId: string): Promise<WhatsappAccount | null> {
    const account = await this.db.runAsPlatformAdmin(async (tx) =>
      tx.query.whatsappAccounts.findFirst({
        where: (t, { and: a, eq: e }) =>
          a(e(t.phoneNumberId, phoneNumberId), e(t.isActive, true)),
      }),
    );
    return account ?? null;
  }

  /**
   * `X-Hub-Signature-256` over the exact bytes Meta sent.
   *
   * Compared with `timingSafeEqual`, not `===`. A byte-by-byte comparison
   * leaks how much of a forged signature was correct, which is enough to
   * reconstruct a valid one given enough attempts — and this endpoint is
   * `@Public()`, so anyone who learns the URL can attempt it.
   */
  verifySignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
    if (!header?.startsWith("sha256=")) return false;

    const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
    return constantTimeEquals(header.slice("sha256=".length), expected);
  }

  /** Every `value` block in the envelope, flattened. */
  extractValues(payload: WhatsappWebhookDto): WhatsappWebhookValue[] {
    return (payload.entry ?? [])
      .flatMap((entry) => entry.changes ?? [])
      .map((change) => change.value)
      .filter((value): value is WhatsappWebhookValue => Boolean(value));
  }

  /**
   * Persist one inbound message and the conversation it belongs to.
   *
   * Idempotent on `waMessageId`, because Meta redelivers on any non-200 and
   * sometimes without one. A redelivery must not append a second copy of a
   * customer's message, and — once the AI turn exists — must not trigger a
   * second reply to it either, which is what `isNew` is for.
   */
  async persistInbound(input: {
    account: WhatsappAccount;
    from: string;
    waMessageId: string;
    type: string | undefined;
    content: string | null;
    profileName: string | undefined;
    occurredAt: Date;
  }): Promise<InboundMessage> {
    const { account } = input;
    // The sender arrives without a "+" and in whatever form Meta holds it.
    // Stored E.164 so it matches `customers.whatsappPhone`, which is now
    // normalised on write for exactly this comparison.
    const phoneNumber = normalizePhone(input.from) ?? input.from;

    return this.db.runAs(account.tenantId, async (tx) => {
      const existing = await tx.query.whatsappMessages.findFirst({
        where: (t, { eq: e }) => e(t.waMessageId, input.waMessageId),
        columns: { id: true, conversationId: true },
      });

      const conversation = await this.upsertConversation(tx, {
        account,
        phoneNumber,
        profileName: input.profileName,
        occurredAt: input.occurredAt,
      });

      if (existing) {
        this.logger.debug(
          { waMessageId: input.waMessageId },
          "Redelivered WhatsApp message ignored",
        );
        return {
          tenantId: account.tenantId,
          conversationId: conversation.id,
          messageId: existing.id,
          isNew: false,
        };
      }

      const type = (input.type ?? "text") as MessageType;

      const [message] = await tx
        .insert(schema.whatsappMessages)
        .values({
          tenantId: account.tenantId,
          conversationId: conversation.id,
          waMessageId: input.waMessageId,
          direction: "inbound",
          type: KNOWN_MESSAGE_TYPES.has(type) ? type : "unsupported",
          content: input.content,
          occurredAt: input.occurredAt,
        })
        /**
         * Two webhooks for one message can race past the check above. The
         * unique index is the real arbiter; losing the race is a no-op.
         *
         * `where` restates the index's own predicate. `uq_wa_messages_wa_id`
         * is PARTIAL (`WHERE wa_message_id IS NOT NULL`), and Postgres will
         * not match an `ON CONFLICT` target to a partial index unless the
         * predicate is repeated — without it the insert fails outright with
         * "no unique or exclusion constraint matching the ON CONFLICT
         * specification", which the caller catches and logs, silently losing
         * the customer's message.
         */
        .onConflictDoNothing({
          target: schema.whatsappMessages.waMessageId,
          where: sql`${schema.whatsappMessages.waMessageId} IS NOT NULL`,
        })
        .returning({ id: schema.whatsappMessages.id });

      return {
        tenantId: account.tenantId,
        conversationId: conversation.id,
        messageId: message?.id ?? "",
        isNew: Boolean(message),
      };
    });
  }

  /**
   * The conversation for this sender, created if this is their first message.
   *
   * `customerId` is resolved here and left NULL when the number is unknown.
   * An unknown sender is a legitimate state — a first-time enquiry — not an
   * error, and deliberately does NOT create a customer record: one row per
   * price question would fill the CRM with people who never bought anything.
   */
  private async upsertConversation(
    tx: Parameters<Parameters<TenantDatabase["runAs"]>[1]>[0],
    input: {
      account: WhatsappAccount;
      phoneNumber: string;
      profileName: string | undefined;
      occurredAt: Date;
    },
  ) {
    const { account, phoneNumber } = input;

    const customer = await tx.query.customers.findFirst({
      where: (t, { and: a, eq: e, isNull: n }) =>
        a(e(t.whatsappPhone, phoneNumber), n(t.deletedAt)),
      columns: { id: true, locale: true },
    });

    const windowExpiresAt = new Date(input.occurredAt.getTime() + CUSTOMER_SERVICE_WINDOW_MS);

    const [conversation] = await tx
      .insert(schema.whatsappConversations)
      .values({
        tenantId: account.tenantId,
        phoneNumber,
        customerId: customer?.id ?? null,
        branchId: account.defaultBranchId,
        ...(input.profileName ? { profileName: input.profileName } : {}),
        ...(customer?.locale ? { locale: customer.locale as Locale } : {}),
        lastMessageAt: input.occurredAt,
        windowExpiresAt,
      })
      .onConflictDoUpdate({
        target: [
          schema.whatsappConversations.tenantId,
          schema.whatsappConversations.phoneNumber,
        ],
        set: {
          lastMessageAt: input.occurredAt,
          // Every inbound message reopens the 24-hour window.
          windowExpiresAt,
          ...(input.profileName ? { profileName: input.profileName } : {}),
          // Re-checked on every message: a number that was unknown last week
          // may have been added to a customer since.
          ...(customer?.id ? { customerId: customer.id } : {}),
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!conversation) {
      // The upsert targets a unique index, so this cannot happen — but a
      // silent undefined here would surface much later as a null FK.
      throw new Error(`Could not upsert a conversation for ${phoneNumber}`);
    }

    return conversation;
  }
}

/** Length-independent, constant-time string comparison. */
function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // `timingSafeEqual` throws on a length mismatch, which would itself leak the
  // length. Hash both to a fixed width first so every comparison costs the same.
  const leftHash = createHmac("sha256", "compare").update(left).digest();
  const rightHash = createHmac("sha256", "compare").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}
