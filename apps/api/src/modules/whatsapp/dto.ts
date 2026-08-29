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
