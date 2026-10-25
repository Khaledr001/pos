/**
 * Messages a shop sends its shoppers: order updates, trade quotes, back-in-stock.
 *
 * Two channels. Email goes through the platform's SMTP transport, with the
 * shop's own display name and reply-to. WhatsApp goes out as an approved
 * TEMPLATE message through the shop's own WhatsApp Business account, because
 * a shopper has usually not opened the 24-hour customer-service window that
 * free-text replies need.
 *
 * Every send is a row in an outbox (`storefront_notifications`) written in the
 * same transaction as the change that caused it, so a crash cannot lose one and
 * a retry cannot double-send one.
 */

const asConst = <const T extends readonly string[]>(values: T) => values;

export const NOTIFICATION_EVENTS = asConst([
  "order_placed",
  "order_confirmed",
  "order_shipped",
  "order_ready_for_pickup",
  "order_delivered",
  "order_cancelled",
  "order_refunded",
  "quote_quoted",
  "stock_back_in_stock",
]);
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

/**
 * Lead notifications ride the same outbox but are email-only and are not
 * shopper-configurable: staff are told about a new lead, and the submitter
 * gets an acknowledgement when the form asks for one.
 */
export const LEAD_NOTIFICATION_EVENTS = asConst(["lead_received", "lead_acknowledged"]);
export type LeadNotificationEvent = (typeof LEAD_NOTIFICATION_EVENTS)[number];
export type AnyNotificationEvent = NotificationEvent | LeadNotificationEvent;

export const NOTIFICATION_CHANNELS = asConst(["email", "whatsapp"]);
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** `skipped` = deliberately not sent (channel off, no consent, no template); the row says why. */
export const NOTIFICATION_STATUSES = asConst(["queued", "sending", "sent", "failed", "skipped"]);
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const NOTIFICATION_EVENT_LABELS: Record<NotificationEvent, string> = {
  order_placed: "Order received",
  order_confirmed: "Order confirmed",
  order_shipped: "Order shipped",
  order_ready_for_pickup: "Ready for pickup",
  order_delivered: "Delivered / collected",
  order_cancelled: "Order cancelled",
  order_refunded: "Order refunded",
  quote_quoted: "Trade quote ready",
  stock_back_in_stock: "Back in stock",
};

export const ANY_EVENT_LABELS: Record<AnyNotificationEvent, string> = {
  ...NOTIFICATION_EVENT_LABELS,
  lead_received: "New lead (to staff)",
  lead_acknowledged: "Lead acknowledgement (to submitter)",
};

export interface NotificationEventRule {
  email: boolean;
  whatsapp: boolean;
}

export interface WhatsappTemplateRef {
  /** Template name registered on the shop's WhatsApp Business account. */
  name: string;
  /** Meta language code, e.g. "en". */
  language: string;
}

/** Shape of the `notifications` block of `storefronts.settings`. */
export interface StorefrontNotificationSettings {
  /** The "From" display name. Falls back to the shop's display name. */
  fromName?: string;
  /** Where a shopper's reply lands. Falls back to the business email. */
  replyTo?: string;
  events: Record<NotificationEvent, NotificationEventRule>;
  /** Which approved template each event uses. Missing = WhatsApp is skipped for that event. */
  whatsappTemplates: Partial<Record<NotificationEvent, WhatsappTemplateRef>>;
}

/** Email on for everything; WhatsApp stays off until the shop has approved templates. */
export const DEFAULT_NOTIFICATION_SETTINGS: StorefrontNotificationSettings = {
  events: Object.fromEntries(NOTIFICATION_EVENTS.map((e) => [e, { email: true, whatsapp: false }])) as Record<
    NotificationEvent,
    NotificationEventRule
  >,
  whatsappTemplates: {},
};

export function resolveNotificationSettings(
  stored: Partial<StorefrontNotificationSettings> | undefined,
): StorefrontNotificationSettings {
  const d = DEFAULT_NOTIFICATION_SETTINGS;
  const events = { ...d.events };
  for (const e of NOTIFICATION_EVENTS) events[e] = { ...d.events[e], ...stored?.events?.[e] };
  return { ...d, ...stored, events, whatsappTemplates: { ...stored?.whatsappTemplates } };
}

// ── WhatsApp template catalogue ───────────────────────────────────────────

/**
 * The templates the platform knows how to fill. The shop submits these (one
 * click in the admin) and Meta approves them; the variables below are the
 * ONLY ones the platform will ever send, in this order.
 */
export interface WhatsappTemplateDef {
  /** Registered as `df_<event>`; a shop may map a different approved name instead. */
  name: string;
  language: "en";
  /** UTILITY for transactional updates; back-in-stock is MARKETING-adjacent so it needs the shopper's explicit phone opt-in. */
  category: "UTILITY" | "MARKETING";
  /** Body with Meta's {{1}}… placeholders. */
  body: string;
  /** What {{1}}, {{2}}… are, in order. */
  variables: readonly string[];
  /** One sample value per variable, required by Meta at submission. */
  examples: readonly string[];
}

export const WHATSAPP_TEMPLATE_DEFS: Record<NotificationEvent, WhatsappTemplateDef> = {
  order_placed: {
    name: "df_order_placed",
    language: "en",
    category: "UTILITY",
    body: "Hi {{1}}, we've received your order {{2}} from {{3}}. Total {{4}}. Track it here: {{5}}",
    variables: ["customer_name", "order_number", "store_name", "total", "tracking_url"],
    examples: ["Sara", "WEB-2026-000123", "Al Lahiq", "AED 245.00", "https://shop.example.com/track/abc"],
  },
  order_confirmed: {
    name: "df_order_confirmed",
    language: "en",
    category: "UTILITY",
    body: "Hi {{1}}, your order {{2}} from {{3}} is confirmed and being prepared. Track it here: {{4}}",
    variables: ["customer_name", "order_number", "store_name", "tracking_url"],
    examples: ["Sara", "WEB-2026-000123", "Al Lahiq", "https://shop.example.com/track/abc"],
  },
  order_shipped: {
    name: "df_order_shipped",
    language: "en",
    category: "UTILITY",
    body: "Hi {{1}}, your order {{2}} from {{3}} is on its way. Track it here: {{4}}",
    variables: ["customer_name", "order_number", "store_name", "tracking_url"],
    examples: ["Sara", "WEB-2026-000123", "Al Lahiq", "https://shop.example.com/track/abc"],
  },
  order_ready_for_pickup: {
    name: "df_order_ready_for_pickup",
    language: "en",
    category: "UTILITY",
    body: "Hi {{1}}, your order {{2}} is ready for pickup at {{3}}. Details: {{4}}",
    variables: ["customer_name", "order_number", "branch_name", "tracking_url"],
    examples: ["Sara", "WEB-2026-000123", "Al Lahiq Dubai", "https://shop.example.com/track/abc"],
  },
  order_delivered: {
    name: "df_order_delivered",
    language: "en",
    category: "UTILITY",
    body: "Hi {{1}}, your order {{2}} from {{3}} is complete. Thank you! Invoice and details: {{4}}",
    variables: ["customer_name", "order_number", "store_name", "tracking_url"],
    examples: ["Sara", "WEB-2026-000123", "Al Lahiq", "https://shop.example.com/track/abc"],
  },
  order_cancelled: {
    name: "df_order_cancelled",
    language: "en",
    category: "UTILITY",
    body: "Hi {{1}}, your order {{2}} from {{3}} has been cancelled. Details: {{4}}",
    variables: ["customer_name", "order_number", "store_name", "tracking_url"],
    examples: ["Sara", "WEB-2026-000123", "Al Lahiq", "https://shop.example.com/track/abc"],
  },
  order_refunded: {
    name: "df_order_refunded",
    language: "en",
    category: "UTILITY",
    body: "Hi {{1}}, a refund of {{2}} for order {{3}} from {{4}} has been issued.",
    variables: ["customer_name", "amount", "order_number", "store_name"],
    examples: ["Sara", "AED 245.00", "WEB-2026-000123", "Al Lahiq"],
  },
  quote_quoted: {
    name: "df_quote_ready",
    language: "en",
    category: "UTILITY",
    body: "Hi {{1}}, your quote {{2}} from {{3}} is ready. Review and accept it here: {{4}}",
    variables: ["customer_name", "quote_number", "store_name", "quote_url"],
    examples: ["Sara", "QT-WEB-2026-000012", "Al Lahiq", "https://shop.example.com/account/quotes/abc"],
  },
  stock_back_in_stock: {
    name: "df_back_in_stock",
    language: "en",
    category: "MARKETING",
    body: "Good news! {{1}} is back in stock at {{2}}. Get it here: {{3}}",
    variables: ["product_name", "store_name", "product_url"],
    examples: ["Mixer tap, chrome", "Al Lahiq", "https://shop.example.com/product/mixer-tap"],
  },
};

// ── admin API shapes (GET/POST /storefront-admin/notifications…) ──────────

export type TemplateApprovalState = "approved" | "pending" | "rejected" | "paused" | "missing";

export interface NotificationTemplateStatus {
  event: NotificationEvent;
  /** The template the shop currently maps to this event, or the platform default name. */
  name: string;
  language: string;
  state: TemplateApprovalState;
  /** Meta's rejection reason, when there is one. */
  reason: string | null;
}

export interface NotificationOverview {
  settings: StorefrontNotificationSettings;
  email: {
    /** The platform has an SMTP transport configured. */
    configured: boolean;
    /** The address mail appears to come from, e.g. `Al Lahiq <orders@mail.devsfleet.com>`. */
    from: string | null;
  };
  whatsapp: {
    /** The shop has an active WhatsApp Business account connected. */
    connected: boolean;
    templates: NotificationTemplateStatus[];
  };
}

export interface NotificationLogRow {
  id: string;
  event: AnyNotificationEvent;
  channel: NotificationChannel;
  recipient: string;
  status: NotificationStatus;
  attempts: number;
  /** Why it failed or was skipped. */
  error: string | null;
  /** A human label for what it was about: an order or quote number, a product name. */
  subject: string;
  createdAt: string;
  sentAt: string | null;
}

export interface NotificationLogPage {
  total: number;
  page: number;
  items: NotificationLogRow[];
}
