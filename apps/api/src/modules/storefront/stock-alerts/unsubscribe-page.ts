import { esc } from "../notifications/email-templates.js";

const STYLE =
  "body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f3f4f6;color:#111827;display:flex;min-height:100vh;align-items:center;justify-content:center}" +
  "main{background:#fff;border-radius:10px;padding:28px;max-width:420px;margin:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}" +
  "h1{font-size:20px;margin:0 0 10px}p{line-height:1.5;margin:0 0 16px}" +
  "button{background:#111827;color:#fff;border:0;border-radius:6px;padding:11px 20px;font-size:15px;cursor:pointer}";

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`;
}

/**
 * Shown on GET. Unsubscribing is a POST from this page's button, never the
 * GET itself: mail scanners and link previewers fetch every URL in a message,
 * and they must not cancel anyone's alert.
 */
export function confirmUnsubscribePage(shopName: string, token: string): string {
  return page(
    "Stop back-in-stock alerts",
    `<h1>Stop these alerts?</h1><p>You'll no longer get an email from ${esc(shopName)} when this item is back in stock.</p>` +
      `<form method="post" action="/api/v1/stock-alerts/unsubscribe/${esc(token)}/confirm"><button type="submit">Stop alerts</button></form>`,
  );
}

export function unsubscribedPage(shopName: string): string {
  return page("Alerts stopped", `<h1>You're unsubscribed</h1><p>${esc(shopName)} won't send you an alert for this item again.</p>`);
}

/** Headers for the two pages: no scripts, nothing framed, nothing indexed. */
export const UNSUBSCRIBE_PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
  "x-robots-tag": "noindex",
  "cache-control": "no-store",
} as const;
