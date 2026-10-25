import type {
  NotificationChannel,
  NotificationEvent,
  StorefrontNotificationSettings,
  WhatsappTemplateRef,
} from "@devsfleet/shared-types";

export interface ChannelInput {
  event: NotificationEvent;
  settings: StorefrontNotificationSettings;
  email: string | null;
  phone: string | null;
  /** The shopper agreed to WhatsApp messages about this subject. */
  whatsappConsent: boolean;
  /** The shop has an active WhatsApp Business account. */
  whatsappConnected: boolean;
}

export type ChannelDecision =
  | { channel: NotificationChannel; action: "queue"; recipient: string; template?: WhatsappTemplateRef }
  | { channel: NotificationChannel; action: "skip"; reason: string };

/** Deliberately plain: a mailbox, no display name, no CR/LF — the mail layer re-checks, this is the first gate. */
export function isMailbox(value: string | null | undefined): value is string {
  return !!value && value.length <= 254 && /^[^\s@<>",;:\\]+@[^\s@<>",;:\\]+\.[^\s@<>",;:\\]+$/.test(value);
}

/** "+971 50 123 4567" -> "+971501234567"; null when it is not a plausible E.164 number. */
export function toE164(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/[^\d+]/g, "");
  const normalized = digits.startsWith("+") ? `+${digits.slice(1).replace(/\+/g, "")}` : `+${digits.replace(/\+/g, "")}`;
  return /^\+\d{8,15}$/.test(normalized) ? normalized : null;
}

/**
 * Which channels a message goes out on, and why one does not.
 *
 * A channel whose rule is simply off produces nothing — the shop chose that.
 * A channel that is ON but cannot be used (no consent, no template, no number)
 * produces a `skip` carrying the reason, which becomes a visible row in the
 * admin log: "why did this shopper not get a WhatsApp message" has an answer.
 */
export function decideChannels(input: ChannelInput): ChannelDecision[] {
  const rule = input.settings.events[input.event];
  const out: ChannelDecision[] = [];

  if (rule.email) {
    out.push(
      isMailbox(input.email)
        ? { channel: "email", action: "queue", recipient: input.email.toLowerCase() }
        : { channel: "email", action: "skip", reason: "No valid email address for this shopper." },
    );
  }

  if (rule.whatsapp) {
    const phone = toE164(input.phone);
    const template = input.settings.whatsappTemplates[input.event];
    if (!input.whatsappConnected) {
      out.push({ channel: "whatsapp", action: "skip", reason: "No WhatsApp Business account is connected." });
    } else if (!input.whatsappConsent) {
      out.push({ channel: "whatsapp", action: "skip", reason: "The shopper did not agree to WhatsApp messages." });
    } else if (!phone) {
      out.push({ channel: "whatsapp", action: "skip", reason: "No valid phone number for this shopper." });
    } else if (!template) {
      out.push({ channel: "whatsapp", action: "skip", reason: "No approved WhatsApp template is set for this message." });
    } else {
      out.push({ channel: "whatsapp", action: "queue", recipient: phone, template });
    }
  }
  return out;
}

/**
 * One row per (event, channel, subject): a re-run of the same transition cannot
 * queue it twice. `version` separates a legitimate repeat — a quote re-priced, a
 * back-in-stock alert for someone who re-subscribed.
 */
export function dedupeKey(
  event: NotificationEvent,
  channel: NotificationChannel,
  subjectId: string,
  version?: string | number,
): string {
  return `${event}:${channel}:${subjectId}${version === undefined ? "" : `:${version}`}`;
}
