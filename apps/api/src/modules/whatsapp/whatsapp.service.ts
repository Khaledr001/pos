import { and, desc, eq, schema, sql } from "@devsfleet/db";
import type { WhatsappAccount } from "@devsfleet/db";
import type { Locale, MessageType } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES, normalizePhone } from "@devsfleet/shared-utils";
import { Injectable, Logger } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { RequestContext } from "../../common/context/request-context.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import type { WhatsappWebhookDto, WhatsappWebhookValue } from "./dto.js";

/** Meta's customer-service window. Free-form replies are refused after this. */
const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Pinned, not floating.
 *
 * Meta ships breaking changes between Graph versions and retires old ones on
 * a published schedule. A pinned version fails on a date we can read in
 * advance; `/latest` fails on a morning nobody chose.
 *
 * v23.0 is what Meta's own Get Started guide uses. Worth re-checking against
 * their docs when this is next touched — a version that has aged past
 * retirement fails every send with a 400, not a deprecation warning.
 */
const GRAPH_API_VERSION = "v23.0";

/** How long to wait on Meta before giving up and recording the failure. */
const SEND_TIMEOUT_MS = 15_000;

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

  // ── Account configuration ──────────────────────────────────────────────────

  /**
   * Configured numbers, with the secrets stripped.
   *
   * `accessToken` and `appSecret` are write-only as far as this API is
   * concerned: they go in when an admin pastes them and are never handed back
   * out. A credential that round-trips through a browser ends up in devtools,
   * in a screenshot, and in a support ticket. The UI shows only whether each
   * one is SET, which is the single fact an operator needs to debug a silent
   * webhook.
   */
  async listAccounts(): Promise<unknown[]> {
    return this.db.run(async (tx) =>
      tx
        .select({
          id: schema.whatsappAccounts.id,
          phoneNumberId: schema.whatsappAccounts.phoneNumberId,
          displayPhoneNumber: schema.whatsappAccounts.displayPhoneNumber,
          businessAccountId: schema.whatsappAccounts.businessAccountId,
          defaultBranchId: schema.whatsappAccounts.defaultBranchId,
          isActive: schema.whatsappAccounts.isActive,
          createdAt: schema.whatsappAccounts.createdAt,
          hasAccessToken: sql<boolean>`length(coalesce(${schema.whatsappAccounts.accessToken}, '')) > 0`,
          hasAppSecret: sql<boolean>`length(coalesce(${schema.whatsappAccounts.appSecret}, '')) > 0`,
          hasVerifyToken: sql<boolean>`length(coalesce(${schema.whatsappAccounts.verifyToken}, '')) > 0`,
        })
        .from(schema.whatsappAccounts)
        .orderBy(desc(schema.whatsappAccounts.createdAt)),
    );
  }

  async createAccount(input: {
    phoneNumberId: string;
    displayPhoneNumber?: string | undefined;
    businessAccountId?: string | undefined;
    accessToken: string;
    verifyToken: string;
    appSecret: string;
    defaultBranchId?: string | undefined;
    isActive?: boolean | undefined;
  }): Promise<{ id: string }> {
    const tenantId = RequestContext.requireTenantId();

    return this.db.run(async (tx) => {
      /*
       * `phone_number_id` is how an inbound webhook finds its tenant, so two
       * rows sharing one would make routing ambiguous — checked here to give
       * a readable message instead of a raw unique violation.
       */
      const clash = await tx.query.whatsappAccounts.findFirst({
        where: (t, { eq: e }) => e(t.phoneNumberId, input.phoneNumberId),
        columns: { id: true },
      });
      if (clash) {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          "That WhatsApp phone number id is already registered.",
        );
      }

      const [account] = await tx
        .insert(schema.whatsappAccounts)
        .values({
          tenantId,
          phoneNumberId: input.phoneNumberId,
          displayPhoneNumber: input.displayPhoneNumber ?? null,
          businessAccountId: input.businessAccountId ?? null,
          accessToken: input.accessToken,
          verifyToken: input.verifyToken,
          appSecret: input.appSecret,
          defaultBranchId: input.defaultBranchId ?? null,
          isActive: input.isActive ?? true,
        })
        .returning({ id: schema.whatsappAccounts.id });

      return { id: account!.id };
    });
  }

  /** Omitted secrets keep their stored value — a blank field is not an erasure. */
  async updateAccount(
    id: string,
    input: {
      displayPhoneNumber?: string | undefined;
      businessAccountId?: string | undefined;
      accessToken?: string | undefined;
      verifyToken?: string | undefined;
      appSecret?: string | undefined;
      defaultBranchId?: string | null | undefined;
      isActive?: boolean | undefined;
    },
  ): Promise<void> {
    await this.db.run(async (tx) => {
      const existing = await tx.query.whatsappAccounts.findFirst({
        where: (t, { eq: e }) => e(t.id, id),
        columns: { id: true },
      });
      if (!existing) throw new AppError(ERROR_CODES.NOT_FOUND, "No such WhatsApp account.");

      await tx
        .update(schema.whatsappAccounts)
        .set({
          ...(input.displayPhoneNumber !== undefined
            ? { displayPhoneNumber: input.displayPhoneNumber }
            : {}),
          ...(input.businessAccountId !== undefined
            ? { businessAccountId: input.businessAccountId }
            : {}),
          ...(input.accessToken ? { accessToken: input.accessToken } : {}),
          ...(input.verifyToken ? { verifyToken: input.verifyToken } : {}),
          ...(input.appSecret ? { appSecret: input.appSecret } : {}),
          ...(input.defaultBranchId !== undefined
            ? { defaultBranchId: input.defaultBranchId }
            : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        })
        .where(eq(schema.whatsappAccounts.id, id));
    });
  }

  async deleteAccount(id: string): Promise<void> {
    await this.db.run(async (tx) => {
      await tx.delete(schema.whatsappAccounts).where(eq(schema.whatsappAccounts.id, id));
    });
  }

  // ── Conversations ──────────────────────────────────────────────────────────

  async listConversations(query: {
    status?: string | undefined;
    page: number;
    pageSize: number;
  }): Promise<{ items: unknown[]; total: number }> {
    return this.db.run(async (tx) => {
      const where = query.status
        ? eq(schema.whatsappConversations.status, query.status)
        : undefined;

      const [totals] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(schema.whatsappConversations)
        .where(where);

      const items = await tx
        .select()
        .from(schema.whatsappConversations)
        .where(where)
        .orderBy(desc(schema.whatsappConversations.lastMessageAt))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);

      return { items, total: totals?.value ?? 0 };
    });
  }

  async getConversation(id: string): Promise<unknown> {
    return this.db.run(async (tx) => {
      const conversation = await tx.query.whatsappConversations.findFirst({
        where: (t, { eq: e }) => e(t.id, id),
      });
      if (!conversation) throw new AppError(ERROR_CODES.NOT_FOUND, "No such conversation.");

      const messages = await tx
        .select()
        .from(schema.whatsappMessages)
        .where(eq(schema.whatsappMessages.conversationId, id))
        .orderBy(schema.whatsappMessages.occurredAt);

      /*
       * Computed rather than stored: the window is a function of the last
       * INBOUND message, and a client that re-derives it from a timestamp it
       * was handed will disagree with the server the moment a clock drifts.
       */
      const windowOpen = Boolean(
        conversation.windowExpiresAt && conversation.windowExpiresAt.getTime() > Date.now(),
      );

      return { ...conversation, windowOpen, messages };
    });
  }

  // ── Outbound ───────────────────────────────────────────────────────────────

  /**
   * Send a free-form text reply on an existing conversation.
   *
   * Free-form, so the 24-hour customer-service window governs it. Outside that
   * window Meta accepts ONLY approved template messages, and a plain text send
   * is rejected at their end — so it is refused here, with the reason, rather
   * than round-tripped to collect a 400. Templates are a separate capability
   * and are not implemented yet.
   *
   * The message row is written in BOTH outcomes. A send that Meta refused is
   * a thing that happened to the conversation: leaving no trace means an
   * operator retypes a reply believing the first one never left, and support
   * has nothing to read back. Failures are stored with `status: "failed"` and
   * the provider's own error text.
   */
  async sendText(conversationId: string, body: string): Promise<{ id: string; status: string }> {
    const user = RequestContext.requireUser();

    const context = await this.db.run(async (tx) => {
      const conversation = await tx.query.whatsappConversations.findFirst({
        where: (t, { eq: e }) => e(t.id, conversationId),
      });
      if (!conversation) {
        throw new AppError(ERROR_CODES.NOT_FOUND, "That conversation does not exist.");
      }

      /*
       * Scoped by tenant through RLS, but the ACCOUNT still has to be chosen:
       * a tenant can hold more than one business number, and a reply must go
       * out on the number the customer wrote to.
       */
      const account = await tx.query.whatsappAccounts.findFirst({
        where: (t, { eq: e }) => e(t.isActive, true),
      });
      if (!account) {
        throw new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          "No active WhatsApp number is configured for this business.",
        );
      }

      return { conversation, account };
    });

    const { conversation, account } = context;
    const expires = conversation.windowExpiresAt;
    if (!expires || expires.getTime() <= Date.now()) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        "The 24-hour reply window on this conversation has closed. WhatsApp only accepts an approved template message now.",
        { windowExpiresAt: expires?.toISOString() ?? null },
      );
    }

    const result = await this.postToGraph(account, conversation.phoneNumber, body);

    return this.db.run(async (tx) => {
      const [message] = await tx
        .insert(schema.whatsappMessages)
        .values({
          tenantId: account.tenantId,
          conversationId: conversation.id,
          direction: "outbound",
          type: "text",
          content: body,
          sentBy: user.id,
          isAiGenerated: false,
          ...(result.ok
            ? { waMessageId: result.waMessageId, status: "sent" as const }
            : {
                status: "failed" as const,
                errorCode: result.code,
                errorMessage: result.message,
              }),
        })
        .returning({ id: schema.whatsappMessages.id });

      await tx
        .update(schema.whatsappConversations)
        .set({ lastMessageAt: new Date() })
        .where(eq(schema.whatsappConversations.id, conversation.id));

      if (!result.ok) {
        throw new AppError(
          ERROR_CODES.INTERNAL_ERROR,
          `WhatsApp refused the message: ${result.message}`,
          { messageId: message?.id ?? null, providerCode: result.code },
        );
      }

      return { id: message?.id ?? "", status: "sent" };
    });
  }

  /**
   * The one place this service talks to Meta.
   *
   * Never throws: every failure comes back as a value, because the caller has
   * to record the attempt before deciding what to do about it. An exception
   * here would skip the row that tells an operator their reply did not send.
   */
  private async postToGraph(
    account: WhatsappAccount,
    to: string,
    body: string,
  ): Promise<
    { ok: true; waMessageId: string } | { ok: false; code: string; message: string }
  > {
    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${account.phoneNumberId}/messages`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${account.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "text",
          // Link previews cost a fetch on Meta's side and surprise the
          // sender with a card they did not compose.
          text: { preview_url: false, body },
        }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });

      const payload = (await response.json().catch(() => null)) as
        | { messages?: Array<{ id?: string }>; error?: { code?: number; message?: string } }
        | null;

      if (!response.ok) {
        const message = payload?.error?.message ?? `HTTP ${response.status}`;
        /*
         * Logged WITHOUT the access token or the message body — this line
         * lands in a shared log and the body is a customer's conversation.
         */
        this.logger.warn(
          { phoneNumberId: account.phoneNumberId, status: response.status },
          "WhatsApp send rejected",
        );
        return { ok: false, code: String(payload?.error?.code ?? response.status), message };
      }

      const waMessageId = payload?.messages?.[0]?.id;
      if (!waMessageId) {
        return { ok: false, code: "NO_MESSAGE_ID", message: "Meta accepted the call but returned no message id." };
      }

      return { ok: true, waMessageId };
    } catch (error) {
      // A timeout or a DNS failure is indistinguishable from "not sent" at
      // this layer, so it is recorded as a failure rather than assumed sent.
      const message = error instanceof Error ? error.message : "Network error";
      this.logger.error({ phoneNumberId: account.phoneNumberId }, `WhatsApp send failed: ${message}`);
      return { ok: false, code: "NETWORK", message };
    }
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
