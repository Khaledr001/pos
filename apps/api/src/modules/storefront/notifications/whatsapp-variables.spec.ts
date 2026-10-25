import { NOTIFICATION_EVENTS, WHATSAPP_TEMPLATE_DEFS } from "@devsfleet/shared-types";
import { describe, expect, it } from "vitest";
import type { NotificationPayload } from "./notification-types.js";
import { whatsappVariables } from "./whatsapp-variables.js";

const payload: NotificationPayload = {
  event: "order_placed",
  shop: { name: "Al Lahiq", logoUrl: null, accent: "#0e6b53", origin: "https://s.example.com", phone: "", email: "" },
  customerName: "Sara",
  fromName: "Al Lahiq",
  replyTo: null,
  order: {
    number: "WEB-1",
    trackingUrl: "https://s.example.com/track/t",
    total: "AED 10.00",
    deliveryMethod: "pickup",
    lines: [],
    pickupBranch: "Dubai",
    shipment: null,
    refundAmount: "AED 10.00",
  },
  quote: { number: "QT-1", total: "AED 5.00", validUntil: null, url: "https://s.example.com/account/quotes/q" },
  stockAlert: { productName: "Tap", productUrl: "https://s.example.com/product/tap", unsubscribeUrl: "" },
};

describe("whatsappVariables", () => {
  it("fills each template's variables in its declared order", () => {
    expect(whatsappVariables("order_placed", payload)).toEqual(["Sara", "WEB-1", "Al Lahiq", "AED 10.00", "https://s.example.com/track/t"]);
    expect(whatsappVariables("order_ready_for_pickup", payload)).toEqual(["Sara", "WEB-1", "Dubai", "https://s.example.com/track/t"]);
    expect(whatsappVariables("order_refunded", payload)).toEqual(["Sara", "AED 10.00", "WEB-1", "Al Lahiq"]);
    expect(whatsappVariables("quote_quoted", payload)).toEqual(["Sara", "QT-1", "Al Lahiq", "https://s.example.com/account/quotes/q"]);
    expect(whatsappVariables("stock_back_in_stock", payload)).toEqual(["Tap", "Al Lahiq", "https://s.example.com/product/tap"]);
  });

  it.each(NOTIFICATION_EVENTS)("gives %s exactly as many values as its template has variables, none empty", (event) => {
    const values = whatsappVariables(event, payload);
    expect(values).toHaveLength(WHATSAPP_TEMPLATE_DEFS[event].variables.length);
    expect(values.every((v) => v.length > 0)).toBe(true);
  });

  it("uses a placeholder, never a hole, when data is missing (Meta rejects a missing variable)", () => {
    const bare = { ...payload, order: undefined, customerName: "" };
    expect(whatsappVariables("order_placed", bare)).toEqual(["there", "-", "Al Lahiq", "-", "-"]);
  });

  it("each template body declares exactly the placeholders its variables list", () => {
    for (const event of NOTIFICATION_EVENTS) {
      const def = WHATSAPP_TEMPLATE_DEFS[event];
      const found = [...def.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
      expect(found.sort()).toEqual(def.variables.map((_, i) => i + 1));
      expect(def.examples).toHaveLength(def.variables.length);
    }
  });
});
