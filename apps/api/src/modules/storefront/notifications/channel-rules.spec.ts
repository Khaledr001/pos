import { DEFAULT_NOTIFICATION_SETTINGS, resolveNotificationSettings, type NotificationEvent } from "@devsfleet/shared-types";
import { describe, expect, it } from "vitest";
import { decideChannels, dedupeKey, isMailbox, toE164, type ChannelInput } from "./channel-rules.js";

const base = (over: Partial<ChannelInput> = {}): ChannelInput => ({
  event: "order_shipped",
  settings: resolveNotificationSettings({
    events: { order_shipped: { email: true, whatsapp: true } } as never,
    whatsappTemplates: { order_shipped: { name: "df_order_shipped", language: "en" } },
  }),
  email: "Sara@Example.com",
  phone: "+971 50 123 4567",
  whatsappConsent: true,
  whatsappConnected: true,
  ...over,
});

describe("decideChannels", () => {
  it("queues email and WhatsApp when everything is in place", () => {
    expect(decideChannels(base())).toEqual([
      { channel: "email", action: "queue", recipient: "sara@example.com" },
      { channel: "whatsapp", action: "queue", recipient: "+971501234567", template: { name: "df_order_shipped", language: "en" } },
    ]);
  });

  it("defaults: email on, WhatsApp off — and an off rule leaves no row at all", () => {
    const out = decideChannels(base({ settings: DEFAULT_NOTIFICATION_SETTINGS }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ channel: "email", action: "queue" });
  });

  it("a rule that is off for both channels queues nothing", () => {
    const settings = resolveNotificationSettings({ events: { order_shipped: { email: false, whatsapp: false } } as never });
    expect(decideChannels(base({ settings }))).toEqual([]);
  });

  it.each<[string, Partial<ChannelInput>, string]>([
    ["no consent", { whatsappConsent: false }, "did not agree"],
    ["no connected account", { whatsappConnected: false }, "No WhatsApp Business account"],
    ["no phone", { phone: null }, "No valid phone"],
    ["unparseable phone", { phone: "call me" }, "No valid phone"],
  ])("WhatsApp is skipped with a reason when there is %s", (_label, over, reason) => {
    const out = decideChannels(base(over));
    const wa = out.find((d) => d.channel === "whatsapp")!;
    expect(wa.action).toBe("skip");
    expect(wa).toMatchObject({ reason: expect.stringContaining(reason) });
    // email is unaffected
    expect(out.find((d) => d.channel === "email")!.action).toBe("queue");
  });

  it("skips WhatsApp when no template is mapped to the event", () => {
    const settings = resolveNotificationSettings({ events: { order_shipped: { email: false, whatsapp: true } } as never });
    const [wa] = decideChannels(base({ settings }));
    expect(wa).toMatchObject({ channel: "whatsapp", action: "skip", reason: expect.stringContaining("template") });
  });

  it("never lets consent be bypassed by a mapped template", () => {
    const [, wa] = decideChannels(base({ whatsappConsent: false }));
    expect(wa!.action).toBe("skip");
  });

  it("skips email for a missing or malformed address", () => {
    for (const email of [null, "", "not-an-email", "a@b", "x@y.com\r\nBcc: z@z.com"]) {
      const em = decideChannels(base({ email }))[0]!;
      expect(em).toMatchObject({ channel: "email", action: "skip" });
    }
  });
});

describe("isMailbox / toE164", () => {
  it("accepts plain mailboxes only", () => {
    expect(isMailbox("a.b+c@example.co.uk")).toBe(true);
    expect(isMailbox('"Evil" <a@b.com>')).toBe(false);
    expect(isMailbox("a@b.com, c@d.com")).toBe(false);
    expect(isMailbox(null)).toBe(false);
  });

  it("normalises phone numbers and rejects implausible ones", () => {
    expect(toE164("+971 (50) 123-4567")).toBe("+971501234567");
    expect(toE164("971501234567")).toBe("+971501234567");
    expect(toE164("12345")).toBeNull();
    expect(toE164("+1234567890123456")).toBeNull();
    expect(toE164(null)).toBeNull();
  });
});

describe("dedupeKey", () => {
  it("is stable per (event, channel, subject) and separates versions", () => {
    const e: NotificationEvent = "order_placed";
    expect(dedupeKey(e, "email", "abc")).toBe("order_placed:email:abc");
    expect(dedupeKey(e, "email", "abc")).toBe(dedupeKey(e, "email", "abc"));
    expect(dedupeKey(e, "whatsapp", "abc")).not.toBe(dedupeKey(e, "email", "abc"));
    expect(dedupeKey("quote_quoted", "email", "q", 1)).not.toBe(dedupeKey("quote_quoted", "email", "q", 2));
    expect(dedupeKey("stock_back_in_stock", "whatsapp", "11111111-1111-4111-8111-111111111111", 1790000000000).length).toBeLessThanOrEqual(160);
  });
});
