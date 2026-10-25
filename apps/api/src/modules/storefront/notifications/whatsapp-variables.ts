import { WHATSAPP_TEMPLATE_DEFS, type NotificationEvent } from "@devsfleet/shared-types";
import type { NotificationPayload } from "./notification-types.js";

/**
 * The values for a template's {{1}}, {{2}}… — in the order its definition
 * lists them. Read from the payload snapshot, never recomputed. An unknown
 * name yields "-" rather than a hole, because Meta rejects a missing variable
 * outright.
 */
export function whatsappVariables(event: NotificationEvent, p: NotificationPayload): string[] {
  const value: Record<string, string | undefined> = {
    customer_name: p.customerName || "there",
    store_name: p.shop.name,
    order_number: p.order?.number,
    total: p.order?.total,
    tracking_url: p.order?.trackingUrl,
    branch_name: p.order?.pickupBranch ?? p.shop.name,
    amount: p.order?.refundAmount ?? p.order?.total,
    quote_number: p.quote?.number,
    quote_url: p.quote?.url,
    product_name: p.stockAlert?.productName,
    product_url: p.stockAlert?.productUrl,
  };
  return WHATSAPP_TEMPLATE_DEFS[event].variables.map((name) => value[name] || "-");
}
