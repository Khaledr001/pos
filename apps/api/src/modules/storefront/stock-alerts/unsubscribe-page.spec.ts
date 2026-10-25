import { describe, expect, it } from "vitest";
import { confirmUnsubscribePage, UNSUBSCRIBE_PAGE_HEADERS, unsubscribedPage } from "./unsubscribe-page.js";

describe("unsubscribe pages", () => {
  it("the confirmation page unsubscribes by POST, never by the GET that shows it", () => {
    const html = confirmUnsubscribePage("Al Lahiq", "11111111-1111-4111-8111-111111111111");
    expect(html).toContain('method="post"');
    expect(html).toContain('action="/api/v1/stock-alerts/unsubscribe/11111111-1111-4111-8111-111111111111/confirm"');
  });

  it("escapes the shop name", () => {
    const evil = `<img src=x onerror=alert(1)>`;
    for (const html of [confirmUnsubscribePage(evil, "t"), unsubscribedPage(evil)]) {
      expect(html).not.toContain("<img");
      expect(html).toContain("&lt;img");
    }
  });

  it("is served with no scripts, no framing, no indexing and no caching", () => {
    expect(UNSUBSCRIBE_PAGE_HEADERS["content-security-policy"]).toContain("default-src 'none'");
    expect(UNSUBSCRIBE_PAGE_HEADERS["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(UNSUBSCRIBE_PAGE_HEADERS["x-robots-tag"]).toBe("noindex");
    expect(UNSUBSCRIBE_PAGE_HEADERS["cache-control"]).toBe("no-store");
  });
});
