import type {
  AiActionStatus,
  AiActionType,
  ConversationStatus,
  Locale,
  MessageDirection,
  MessageStatus,
  MessageType,
} from "@devsfleet/shared-types";
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { money, primaryId, timestamps } from "./_shared.js";
import { users } from "./auth.js";
import { customers } from "./partners.js";
import { branches, tenantScope } from "./tenants.js";

/**
 * WHATSAPP & AI
 *
 * Inbound flow: Meta webhook -> signature check -> persist message -> enqueue
 * -> AI turn -> tool calls -> reply. The persist step happens before any AI
 * work so a webhook is never lost to an LLM timeout, and Meta gets its 200
 * inside the retry window regardless of how slow the model is.
 */

export const whatsappConversations = pgTable(
  "whatsapp_conversations",
  {
    id: primaryId(),
    ...tenantScope(),
    /** NULL until the number is matched to, or a customer is created for, this sender. */
    customerId: uuid().references(() => customers.id, { onDelete: "set null" }),
    /** E.164. The identity of the conversation before a customer exists. */
    phoneNumber: varchar({ length: 20 }).notNull(),
    /** WhatsApp profile name — the only name available for an unknown sender. */
    profileName: varchar({ length: 255 }),

    branchId: uuid().references(() => branches.id, { onDelete: "set null" }),
    status: varchar({ length: 20 })
      .$type<ConversationStatus>()
      .notNull()
      .default("active"),
    /** Detected from the first messages; drives which language the bot replies in. */
    locale: varchar({ length: 5 }).$type<Locale>().notNull().default("en"),

    /** Set on human takeover. While set, the AI stops replying. */
    assignedTo: uuid().references(() => users.id, { onDelete: "set null" }),
    assignedAt: timestamp({ withTimezone: true, mode: "date" }),

    /**
     * Rolling AI state: extracted entities, the draft cart, the last tool
     * results. Kept here rather than replayed from message history because
     * re-feeding a long thread to the model on every turn is slow and costs
     * tokens linearly in conversation length.
     */
    context: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    /** AI turns since the last human touch. Drives auto-escalation. */
    aiTurnCount: integer().notNull().default(0),

    lastMessageAt: timestamp({ withTimezone: true, mode: "date" }),
    /**
     * Meta's 24-hour customer service window. After it closes, only an approved
     * template may be sent — a free-form reply is rejected by the API.
     */
    windowExpiresAt: timestamp({ withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("uq_wa_conversations_tenant_phone").on(t.tenantId, t.phoneNumber),
    index("idx_wa_conversations_status").on(t.tenantId, t.status, t.lastMessageAt),
    index("idx_wa_conversations_customer").on(t.customerId),
  ],
);

export const whatsappMessages = pgTable(
  "whatsapp_messages",
  {
    id: primaryId(),
    ...tenantScope(),
    conversationId: uuid()
      .notNull()
      .references(() => whatsappConversations.id, { onDelete: "cascade" }),

    /**
     * Meta's message id. Unique so a redelivered webhook — which Meta does on
     * any non-200, and sometimes anyway — cannot insert the message twice.
     */
    waMessageId: varchar({ length: 100 }),
    direction: varchar({ length: 10 }).$type<MessageDirection>().notNull(),
    type: varchar({ length: 20 }).$type<MessageType>().notNull().default("text"),

    content: text(),
    /** Object key in MinIO. Meta's own media URLs expire in minutes. */
    mediaUrl: varchar({ length: 500 }),
    mediaMimeType: varchar({ length: 100 }),

    /** Name of the approved template, when type = template. */
    templateName: varchar({ length: 100 }),
    templatePayload: jsonb().$type<Record<string, unknown>>(),

    status: varchar({ length: 20 }).$type<MessageStatus>(),
    errorCode: varchar({ length: 50 }),
    errorMessage: text(),

    isAiGenerated: boolean().notNull().default(false),
    /** Set when a human wrote the outbound message. */
    sentBy: uuid().references(() => users.id, { onDelete: "set null" }),

    /** Meta timestamp for inbound, send time for outbound. */
    occurredAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
    createdAt: timestamps().createdAt,
  },
  (t) => [
    uniqueIndex("uq_wa_messages_wa_id")
      .on(t.waMessageId)
      .where(sql`wa_message_id IS NOT NULL`),
    index("idx_wa_messages_conversation").on(t.conversationId, t.occurredAt),
  ],
);

/**
 * One row per LLM tool invocation — the audit trail for "why did the bot say
 * that", including the calls that failed or were rejected.
 *
 * `tokensUsed` and `latencyMs` are here so LLM spend is attributable per
 * conversation, which is what tells you whether the bot is worth its cost.
 */
export const aiActions = pgTable(
  "ai_actions",
  {
    id: primaryId(),
    ...tenantScope(),
    conversationId: uuid()
      .notNull()
      .references(() => whatsappConversations.id, { onDelete: "cascade" }),
    /** The inbound message that triggered this turn. */
    messageId: uuid().references(() => whatsappMessages.id, { onDelete: "set null" }),

    actionType: varchar({ length: 30 }).$type<AiActionType>().notNull(),
    /** Arguments the model produced for the tool call. */
    input: jsonb().$type<Record<string, unknown>>(),
    /** What the system handed back. */
    output: jsonb().$type<Record<string, unknown>>(),
    status: varchar({ length: 20 }).$type<AiActionStatus>().notNull().default("completed"),
    errorMessage: text(),

    model: varchar({ length: 50 }),
    promptTokens: integer(),
    completionTokens: integer(),
    /** Estimated spend for this call, in the tenant's base currency. */
    estimatedCost: money(),
    latencyMs: integer(),

    createdAt: timestamps().createdAt,
  },
  (t) => [
    index("idx_ai_actions_conversation").on(t.conversationId, t.createdAt),
    index("idx_ai_actions_tenant_type").on(t.tenantId, t.actionType, t.createdAt),
  ],
);

export const whatsappConversationsRelations = relations(
  whatsappConversations,
  ({ one, many }) => ({
    customer: one(customers, {
      fields: [whatsappConversations.customerId],
      references: [customers.id],
    }),
    branch: one(branches, {
      fields: [whatsappConversations.branchId],
      references: [branches.id],
    }),
    messages: many(whatsappMessages),
    actions: many(aiActions),
  }),
);

export const whatsappMessagesRelations = relations(whatsappMessages, ({ one }) => ({
  conversation: one(whatsappConversations, {
    fields: [whatsappMessages.conversationId],
    references: [whatsappConversations.id],
  }),
}));

export const aiActionsRelations = relations(aiActions, ({ one }) => ({
  conversation: one(whatsappConversations, {
    fields: [aiActions.conversationId],
    references: [whatsappConversations.id],
  }),
}));

export type WhatsappConversation = typeof whatsappConversations.$inferSelect;
export type NewWhatsappConversation = typeof whatsappConversations.$inferInsert;
export type WhatsappMessage = typeof whatsappMessages.$inferSelect;
export type NewWhatsappMessage = typeof whatsappMessages.$inferInsert;
export type AiAction = typeof aiActions.$inferSelect;
export type NewAiAction = typeof aiActions.$inferInsert;
