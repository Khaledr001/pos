import { NOTIFICATION_CHANNELS, NOTIFICATION_EVENTS, NOTIFICATION_STATUSES } from "@devsfleet/shared-types";
import { z } from "zod";

/** A From display name: no line breaks, no angle brackets or quotes that could forge an address. */
const fromName = z
  .string()
  .trim()
  .max(60)
  .refine((v) => !/[\r\n<>"\\;,]/.test(v), { message: "Remove line breaks and the characters < > \" \\ ; ," });

const rule = z.object({ email: z.boolean(), whatsapp: z.boolean() });

const templateRef = z.object({
  /** Meta's template naming: lower-case letters, digits and underscores. */
  name: z.string().trim().regex(/^[a-z0-9_]{1,512}$/, "Use lower-case letters, digits and underscores"),
  language: z.string().trim().regex(/^[a-z]{2}(_[A-Z]{2})?$/, "Use a Meta language code like en or en_US"),
});

const eventKey = z.enum(NOTIFICATION_EVENTS);

/**
 * `events` is merged per key, so a PATCH names only the rules that change.
 * `whatsappTemplates` is replaced wholesale: to unmap an event, leave it out.
 */
export const NotificationSettingsSchema = z
  .object({
    fromName: fromName.optional(),
    replyTo: z.string().trim().max(254).email().or(z.literal("")).optional(),
    events: z.partialRecord(eventKey, rule),
    whatsappTemplates: z.partialRecord(eventKey, templateRef),
  })
  .partial();
export type NotificationSettingsDto = z.infer<typeof NotificationSettingsSchema>;

export const ListNotificationLogSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  status: z.enum(NOTIFICATION_STATUSES).optional(),
  channel: z.enum(NOTIFICATION_CHANNELS).optional(),
});
export type ListNotificationLogDto = z.infer<typeof ListNotificationLogSchema>;

export const TestNotificationSchema = z.object({
  channel: z.enum(NOTIFICATION_CHANNELS),
  /** An email address, or a phone number for WhatsApp. Checked against the channel in the service. */
  to: z.string().trim().min(5).max(254),
  event: eventKey.default("order_placed"),
});
export type TestNotificationDto = z.infer<typeof TestNotificationSchema>;
