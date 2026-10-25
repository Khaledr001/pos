import { NOTIFICATION_EVENTS } from "@devsfleet/shared-types";
import { describe, expect, it } from "vitest";
import { esc, renderEmail, safeUrl, shopLink } from "./email-templates.js";
import type { NotificationPayload } from "./notification-types.js";

const payload = (over: Partial<NotificationPayload> = {}): NotificationPayload => ({
  event: "order_placed",
  shop: { name: "Al Lahiq", logoUrl: null, accent: "#0e6b53", origin: "https://shop.example.com", phone: "+971 4 000 0000", email: "hi@example.com" },
  customerName: "Sara",
  fromName: "Al Lahiq",
  replyTo: "hi@example.com",
  order: {
    number: "WEB-2026-000123",
    trackingUrl: "https://shop.example.com/track/abc",
    total: "AED 245.00",
    deliveryMethod: "courier",
    lines: [
      { name: "Mixer tap", quantity: "2", total: "AED 200.00" },
      { name: "Delivery", quantity: "1", total: "AED 45.00" },
    ],
    pickupBranch: "Dubai branch",
    shipment: { courier: "Aramex", trackingNumber: "TRK1", trackingUrl: null },
    refundAmount: "AED 245.00",
  },
  quote: { number: "QT-WEB-2026-000012", total: "AED 1,000.00", validUntil: "1 Mar 2026", url: "https://shop.example.com/account/quotes/q1" },
  stockAlert: { productName: "Mixer tap", productUrl: "https://shop.example.com/product/mixer-tap", unsubscribeUrl: "https://shop.example.com/api/v1/stock-alerts/unsubscribe/tok" },
  ...over,
});

describe("renderEmail", () => {
  it.each(NOTIFICATION_EVENTS)("renders a non-empty subject, html and text for %s", (event) => {
    const out = renderEmail(payload({ event }));
    expect(out.subject.length).toBeGreaterThan(5);
    expect(out.html).toContain("<!doctype html>");
    expect(out.text.length).toBeGreaterThan(20);
    expect(out.subject).not.toMatch(/[\r\n]/);
    expect(out.html).not.toContain("undefined");
    expect(out.text).not.toContain("undefined");
  });

  it("shows the order lines and total on placed and confirmed, with the tracking link", () => {
    const out = renderEmail(payload());
    expect(out.html).toContain("Mixer tap");
    expect(out.html).toContain("AED 245.00");
    expect(out.html).toContain('href="https://shop.example.com/track/abc"');
    expect(out.text).toContain("- Mixer tap x 2: AED 200.00");
    expect(out.text).toContain("https://shop.example.com/track/abc");
    expect(renderEmail(payload({ event: "order_shipped" })).html).not.toContain("<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:16px 0");
  });

  it("uses the shop's accent colour, and falls back when it is not a valid hex", () => {
    expect(renderEmail(payload()).html).toContain("background:#0e6b53");
    const bad = renderEmail(payload({ shop: { ...payload().shop, accent: "red;} body{display:none" } })).html;
    expect(bad).not.toContain("display:none");
    expect(bad).toContain("background:#0e6b53");
  });

  it("escapes every dynamic string", () => {
    const evil = `<script>alert("x")</script>`;
    const out = renderEmail(
      payload({
        customerName: evil,
        shop: { ...payload().shop, name: evil, phone: evil, email: evil },
        order: { ...payload().order!, number: evil, total: evil, lines: [{ name: evil, quantity: evil, total: evil }], pickupBranch: evil },
      }),
    );
    expect(out.html).not.toContain("<script>");
    expect(out.html).toContain("&lt;script&gt;");
  });

  it("keeps non-http links out of an href", () => {
    const out = renderEmail(payload({ order: { ...payload().order!, trackingUrl: "javascript:alert(1)" } }));
    expect(out.html).not.toContain("javascript:");
    expect(out.html).not.toContain("View your order");
    expect(out.text).not.toContain("javascript:");
  });

  it("describes a shipment's courier and tracking number", () => {
    const out = renderEmail(payload({ event: "order_shipped" }));
    expect(out.text).toContain("Aramex");
    expect(out.text).toContain("TRK1");
  });

  it("words delivery and collection differently", () => {
    expect(renderEmail(payload({ event: "order_delivered" })).html).toContain("Order delivered");
    const pickup = renderEmail(payload({ event: "order_delivered", order: { ...payload().order!, deliveryMethod: "pickup" } }));
    expect(pickup.html).toContain("Order collected");
  });

  it("adds an unsubscribe link to a back-in-stock alert only", () => {
    const alert = renderEmail(payload({ event: "stock_back_in_stock" }));
    expect(alert.html).toContain("/api/v1/stock-alerts/unsubscribe/tok");
    expect(alert.text).toContain("Stop these alerts");
    expect(renderEmail(payload()).html).not.toContain("unsubscribe");
  });

  it("strips line breaks from the subject", () => {
    const out = renderEmail(payload({ event: "stock_back_in_stock", stockAlert: { ...payload().stockAlert!, productName: "Tap\r\nBcc: x@y.com" } }));
    expect(out.subject).not.toMatch(/[\r\n]/);
  });
});

describe("helpers", () => {
  it("esc covers the five dangerous characters", () => {
    expect(esc(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("safeUrl accepts http(s) only", () => {
    expect(safeUrl("https://a.com/x")).toBe("https://a.com/x");
    expect(safeUrl("http://localhost:3002/x")).toBe("http://localhost:3002/x");
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "//evil.com", "not a url", "", null, undefined]) expect(safeUrl(bad)).toBeNull();
  });

  it("shopLink joins an origin and a path once", () => {
    expect(shopLink("https://shop.example.com/", "/track/abc")).toBe("https://shop.example.com/track/abc");
    expect(shopLink("https://shop.example.com", "track/abc")).toBe("https://shop.example.com/track/abc");
  });
});
