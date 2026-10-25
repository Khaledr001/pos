import { HEX_COLOR } from "@devsfleet/shared-types";
import type { NotificationPayload } from "./notification-types.js";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const FALLBACK_ACCENT = "#0e6b53";

/** Every dynamic string goes through this before it reaches markup. */
export function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** An http(s) link, or nothing. Keeps `javascript:` and `data:` out of an href. */
export function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** A path on the shop joined to its origin. The origin is the shop's own; the path is ours. */
export function shopLink(origin: string, path: string): string {
  return `${origin.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

interface Copy {
  subject: string;
  heading: string;
  lines: string[];
  cta?: { label: string; url: string | null };
}

function copyFor(p: NotificationPayload): Copy {
  const { order, quote, stockAlert, shop } = p;
  const name = p.customerName || "there";
  const n = order?.number ?? "";
  const tracking = order ? safeUrl(order.trackingUrl) : null;
  const viewOrder = { label: "View your order", url: tracking };

  switch (p.event) {
    case "order_placed":
      return { subject: `We've received your order ${n}`, heading: "Thanks for your order", lines: [`Hi ${name}, we've received your order ${n}. We'll let you know as it moves along.`], cta: viewOrder };
    case "order_confirmed":
      return { subject: `Your order ${n} is confirmed`, heading: "Your order is confirmed", lines: [`Hi ${name}, ${shop.name} has confirmed order ${n} and is preparing it.`], cta: viewOrder };
    case "order_shipped": {
      const ship = order?.shipment;
      const lines = [`Hi ${name}, order ${n} is on its way.`];
      if (ship) lines.push(`Courier: ${ship.courier}${ship.trackingNumber ? `, tracking number ${ship.trackingNumber}` : ""}.`);
      return { subject: `Your order ${n} is on its way`, heading: "Your order has shipped", lines, cta: viewOrder };
    }
    case "order_ready_for_pickup":
      return {
        subject: `Your order ${n} is ready for pickup`,
        heading: "Ready for pickup",
        lines: [`Hi ${name}, order ${n} is ready${order?.pickupBranch ? ` at ${order.pickupBranch}` : ""}. Bring your order number.`],
        cta: viewOrder,
      };
    case "order_delivered":
      return {
        subject: `Your order ${n} is complete`,
        heading: order?.deliveryMethod === "pickup" ? "Order collected" : "Order delivered",
        lines: [`Hi ${name}, order ${n} is complete. Thank you for shopping with ${shop.name}. Your tax invoice is on the order page.`],
        cta: { label: "View order and invoice", url: tracking },
      };
    case "order_cancelled":
      return { subject: `Your order ${n} was cancelled`, heading: "Order cancelled", lines: [`Hi ${name}, order ${n} has been cancelled. If you paid online, you'll hear from us about your refund.`], cta: viewOrder };
    case "order_refunded":
      return {
        subject: `Refund issued for order ${n}`,
        heading: "Refund issued",
        lines: [`Hi ${name}, a refund${order?.refundAmount ? ` of ${order.refundAmount}` : ""} for order ${n} has been sent to your original payment method. It can take a few days to appear.`],
        cta: viewOrder,
      };
    case "quote_quoted":
      return {
        subject: `Your quote ${quote?.number ?? ""} is ready`,
        heading: "Your quote is ready",
        lines: [
          `Hi ${name}, ${shop.name} has priced your quote ${quote?.number ?? ""}${quote ? `. Total ${quote.total}` : ""}.`,
          ...(quote?.validUntil ? [`Valid until ${quote.validUntil}.`] : []),
        ],
        cta: { label: "Review and accept", url: quote ? safeUrl(quote.url) : null },
      };
    case "stock_back_in_stock":
      return {
        subject: `${stockAlert?.productName ?? "An item"} is back in stock`,
        heading: "Back in stock",
        lines: [`Good news: ${stockAlert?.productName ?? "the item you asked about"} is available again at ${shop.name}. Stock can go quickly.`],
        cta: { label: "Shop now", url: stockAlert ? safeUrl(stockAlert.productUrl) : null },
      };
  }
}

export function renderEmail(p: NotificationPayload): RenderedEmail {
  const copy = copyFor(p);
  const accent = HEX_COLOR.test(p.shop.accent) ? p.shop.accent : FALLBACK_ACCENT;
  const subject = oneLine(copy.subject).slice(0, 200);
  const logo = safeUrl(p.shop.logoUrl);
  const order = p.order;

  const lineRows =
    order && order.lines.length > 0 && (p.event === "order_placed" || p.event === "order_confirmed")
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;border-collapse:collapse;font-size:14px">${order.lines
          .map(
            (l) =>
              `<tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb">${esc(l.name)}<span style="color:#6b7280"> × ${esc(l.quantity)}</span></td><td align="right" style="padding:8px 0;border-bottom:1px solid #e5e7eb;white-space:nowrap">${esc(l.total)}</td></tr>`,
          )
          .join("")}<tr><td style="padding:10px 0;font-weight:700">Total</td><td align="right" style="padding:10px 0;font-weight:700;white-space:nowrap">${esc(order.total)}</td></tr></table>`
      : "";

  const ctaUrl = copy.cta ? copy.cta.url : null;
  const cta =
    copy.cta && ctaUrl
      ? `<p style="margin:24px 0"><a href="${esc(ctaUrl)}" style="background:${accent};color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:600;display:inline-block">${esc(copy.cta.label)}</a></p>`
      : "";

  const unsubscribe =
    p.event === "stock_back_in_stock"
      ? p.stockAlert && safeUrl(p.stockAlert.unsubscribeUrl)
        ? `<p style="margin:12px 0 0;font-size:12px;color:#6b7280">You asked us to tell you when this was back. <a href="${esc(safeUrl(p.stockAlert.unsubscribeUrl)!)}" style="color:#6b7280">Stop these alerts</a>.</p>`
        : ""
      : "";

  const contact = [p.shop.phone, p.shop.email].filter(Boolean).map(esc).join(" · ");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head><body style="margin:0;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:10px;overflow:hidden"><tr><td style="background:${accent};padding:18px 24px;color:#ffffff;font-size:18px;font-weight:700">${logo ? `<img src="${esc(logo)}" alt="" height="28" style="vertical-align:middle;margin-right:8px;border:0">` : ""}${esc(p.shop.name)}</td></tr><tr><td style="padding:24px"><h1 style="margin:0 0 12px;font-size:20px">${esc(copy.heading)}</h1>${copy.lines.map((l) => `<p style="margin:0 0 10px;line-height:1.5">${esc(l)}</p>`).join("")}${lineRows}${cta}${unsubscribe}</td></tr><tr><td style="padding:16px 24px;background:#f9fafb;font-size:12px;color:#6b7280">${esc(p.shop.name)}${contact ? ` · ${contact}` : ""}</td></tr></table></td></tr></table></body></html>`;

  const textParts = [copy.heading, "", ...copy.lines];
  if (lineRows && order) {
    textParts.push("", ...order.lines.map((l) => `- ${l.name} x ${l.quantity}: ${l.total}`), `Total: ${order.total}`);
  }
  if (copy.cta && ctaUrl) textParts.push("", `${copy.cta.label}: ${ctaUrl}`);
  if (p.stockAlert && unsubscribe) textParts.push("", `Stop these alerts: ${safeUrl(p.stockAlert.unsubscribeUrl)}`);
  textParts.push("", `${p.shop.name}${contact ? ` - ${[p.shop.phone, p.shop.email].filter(Boolean).join(" · ")}` : ""}`);

  return { subject, html, text: textParts.join("\n") };
}
