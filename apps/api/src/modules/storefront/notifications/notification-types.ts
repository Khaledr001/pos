import type { NotificationEvent } from "@devsfleet/shared-types";

/**
 * What an outbox row carries. A snapshot taken when the message was queued
 * (rule 5): names, totals and links as they were, already formatted with the
 * shop's currency and locale. The email renderer and the WhatsApp variables
 * read ONLY this, so nothing is recomputed — and no total is ever derived —
 * at send time.
 */
export interface ShopSnapshot {
  name: string;
  logoUrl: string | null;
  /** A validated six-digit hex from the theme. */
  accent: string;
  /** The shop's public origin, no trailing slash. */
  origin: string;
  phone: string;
  email: string;
}

export interface OrderLineSnapshot {
  name: string;
  quantity: string;
  total: string;
}

export interface OrderSnapshot {
  number: string;
  trackingUrl: string;
  total: string;
  deliveryMethod: "courier" | "pickup";
  lines: OrderLineSnapshot[];
  pickupBranch: string | null;
  shipment: { courier: string; trackingNumber: string | null; trackingUrl: string | null } | null;
  /** Formatted refund amount, for order_refunded. */
  refundAmount: string | null;
}

export interface QuoteSnapshot {
  number: string;
  total: string;
  /** Already formatted in the shop's locale, or null. */
  validUntil: string | null;
  url: string;
}

export interface StockAlertSnapshot {
  productName: string;
  productUrl: string;
  unsubscribeUrl: string;
}

export interface WhatsappSnapshot {
  template: string;
  language: string;
  /** In the order the template's {{1}}… expect; see WHATSAPP_TEMPLATE_DEFS. */
  variables: string[];
}

export interface NotificationPayload {
  event: NotificationEvent;
  shop: ShopSnapshot;
  customerName: string;
  /** Display name for the From header, already sanitised. */
  fromName: string;
  replyTo: string | null;
  order?: OrderSnapshot;
  quote?: QuoteSnapshot;
  stockAlert?: StockAlertSnapshot;
  whatsapp?: WhatsappSnapshot;
}
