import { z } from "zod";

/**
 * Meta's webhook envelope, narrowed to what this module actually reads.
 *
 * Deliberately permissive: every unknown field is stripped rather than
 * rejected, and every branch is optional. Meta adds fields and event types
 * without warning, and a schema that 400s on an unrecognised payload turns a
 * new notification type into an outage — Meta retries a non-200, so a strict
 * schema would also convert one bad payload into an endless retry loop.
 * Anything this does not understand is acknowledged and ignored.
 */
const WebhookMessageSchema = z.object({
  id: z.string(),
  from: z.string(),
  timestamp: z.string().optional(),
  type: z.string().optional(),
  text: z.object({ body: z.string() }).partial().optional(),
});

const WebhookContactSchema = z.object({
  wa_id: z.string().optional(),
  profile: z.object({ name: z.string() }).partial().optional(),
});

const WebhookValueSchema = z.object({
  metadata: z
    .object({
      phone_number_id: z.string().optional(),
      display_phone_number: z.string().optional(),
    })
    .optional(),
  contacts: z.array(WebhookContactSchema).optional(),
  messages: z.array(WebhookMessageSchema).optional(),
  /** Delivery receipts. Acknowledged, not yet acted on. */
  statuses: z.array(z.record(z.string(), z.unknown())).optional(),
});

export const WhatsappWebhookSchema = z.object({
  object: z.string().optional(),
  entry: z
    .array(
      z.object({
        id: z.string().optional(),
        changes: z
          .array(z.object({ field: z.string().optional(), value: WebhookValueSchema.optional() }))
          .optional(),
      }),
    )
    .optional(),
});
export type WhatsappWebhookDto = z.infer<typeof WhatsappWebhookSchema>;
export type WhatsappWebhookValue = z.infer<typeof WebhookValueSchema>;

/** Meta's GET handshake when a webhook URL is first subscribed. */
export const WebhookVerifySchema = z.object({
  "hub.mode": z.string().optional(),
  "hub.verify_token": z.string().optional(),
  "hub.challenge": z.string().optional(),
});
export type WebhookVerifyDto = z.infer<typeof WebhookVerifySchema>;

// ── Admin-facing DTOs ────────────────────────────────────────────────────────

/**
 * The three secrets are REQUIRED on create and optional on update.
 *
 * On update an omitted secret means "leave it alone", which is what lets an
 * admin change the display number without re-pasting a 200-character access
 * token they no longer have to hand. `.min(1)` rather than `.optional()` on
 * create, because an account missing any one of them is an account whose
 * webhook will silently reject everything.
 */
export const CreateWhatsappAccountSchema = z.object({
  phoneNumberId: z.string().trim().min(1).max(64),
  displayPhoneNumber: z.string().trim().max(20).optional(),
  businessAccountId: z.string().trim().max(64).optional(),
  accessToken: z.string().trim().min(1),
  verifyToken: z.string().trim().min(1).max(128),
  appSecret: z.string().trim().min(1).max(128),
  defaultBranchId: z.string().uuid().optional(),
  isActive: z.boolean().optional(),
});
export type CreateWhatsappAccountDto = z.infer<typeof CreateWhatsappAccountSchema>;

export const UpdateWhatsappAccountSchema = z.object({
  displayPhoneNumber: z.string().trim().max(20).optional(),
  businessAccountId: z.string().trim().max(64).optional(),
  accessToken: z.string().trim().min(1).optional(),
  verifyToken: z.string().trim().min(1).max(128).optional(),
  appSecret: z.string().trim().min(1).max(128).optional(),
  defaultBranchId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateWhatsappAccountDto = z.infer<typeof UpdateWhatsappAccountSchema>;

export const ListConversationsSchema = z.object({
  status: z.enum(["active", "resolved", "escalated"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListConversationsDto = z.infer<typeof ListConversationsSchema>;

/**
 * 4096 is WhatsApp's own limit for a text body. Enforced here so an
 * over-long reply is refused with a readable message rather than a 400 from
 * Meta after the operator has already hit send.
 */
export const SendWhatsappMessageSchema = z.object({
  body: z.string().trim().min(1, "A reply cannot be empty").max(4096),
});
export type SendWhatsappMessageDto = z.infer<typeof SendWhatsappMessageSchema>;
