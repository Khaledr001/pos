import { describe, expect, it } from "vitest";
import { mergeEventRules } from "./settings-admin.service.js";
import { ListNotificationLogSchema, NotificationSettingsSchema, TestNotificationSchema } from "./notifications.dto.js";
import { UpdateSettingsSchema } from "./dto.js";

describe("NotificationSettingsSchema", () => {
  it("accepts a partial update", () => {
    expect(NotificationSettingsSchema.safeParse({ fromName: "Al Lahiq", events: { order_shipped: { email: true, whatsapp: true } } }).success).toBe(true);
    expect(NotificationSettingsSchema.safeParse({}).success).toBe(true);
  });

  it("refuses a From name that could forge an address or break a header", () => {
    for (const fromName of ["Evil <a@b.com>", 'Say "hi"', "a\r\nBcc: x@y.com", "a;b", "a,b", "back\\slash"]) {
      expect(NotificationSettingsSchema.safeParse({ fromName }).success).toBe(false);
    }
    expect(NotificationSettingsSchema.safeParse({ fromName: "x".repeat(61) }).success).toBe(false);
  });

  it("validates reply-to, allowing it to be cleared with an empty string", () => {
    expect(NotificationSettingsSchema.safeParse({ replyTo: "care@example.com" }).success).toBe(true);
    expect(NotificationSettingsSchema.safeParse({ replyTo: "" }).success).toBe(true);
    expect(NotificationSettingsSchema.safeParse({ replyTo: "not an email" }).success).toBe(false);
  });

  it("only knows the platform's events", () => {
    expect(NotificationSettingsSchema.safeParse({ events: { order_teleported: { email: true, whatsapp: false } } }).success).toBe(false);
  });

  it("validates template names and language codes", () => {
    const ok = { whatsappTemplates: { order_placed: { name: "df_order_placed", language: "en_US" } } };
    expect(NotificationSettingsSchema.safeParse(ok).success).toBe(true);
    for (const bad of [{ name: "Has Caps", language: "en" }, { name: "df_x", language: "english" }, { name: "", language: "en" }]) {
      expect(NotificationSettingsSchema.safeParse({ whatsappTemplates: { order_placed: bad } }).success).toBe(false);
    }
  });

  it("is part of the settings update", () => {
    expect(UpdateSettingsSchema.safeParse({ notifications: { events: { order_placed: { email: false, whatsapp: false } } } }).success).toBe(true);
  });
});

describe("mergeEventRules", () => {
  it("changes only the events named in the patch", () => {
    const current = { order_placed: { email: true, whatsapp: false }, order_shipped: { email: true, whatsapp: false } } as never;
    const merged = mergeEventRules(current, { order_shipped: { email: false, whatsapp: true } } as never) as Record<string, unknown>;
    expect(merged.order_placed).toEqual({ email: true, whatsapp: false });
    expect(merged.order_shipped).toEqual({ email: false, whatsapp: true });
  });
});

describe("log and test schemas", () => {
  it("coerces and bounds paging, and filters by known values", () => {
    expect(ListNotificationLogSchema.parse({ page: "3", status: "failed" })).toEqual({ page: 3, status: "failed" });
    expect(ListNotificationLogSchema.parse({}).page).toBe(1);
    expect(ListNotificationLogSchema.safeParse({ page: "0" }).success).toBe(false);
    expect(ListNotificationLogSchema.safeParse({ status: "exploded" }).success).toBe(false);
  });

  it("defaults a test to the order-received message", () => {
    expect(TestNotificationSchema.parse({ channel: "email", to: "a@b.co" }).event).toBe("order_placed");
    expect(TestNotificationSchema.safeParse({ channel: "sms", to: "a@b.co" }).success).toBe(false);
  });
});
