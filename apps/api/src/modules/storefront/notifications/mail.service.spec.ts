import { describe, expect, it } from "vitest";
import type { ConfigService } from "@nestjs/config";
import type { Env } from "../../../config/env.js";
import { assertSingleLine, MailService, sanitizeDisplayName } from "./mail.service.js";

const config = (values: Partial<Record<keyof Env, unknown>>) => ({ get: (key: keyof Env) => values[key] }) as unknown as ConfigService<Env, true>;
const message = { fromName: "Al Lahiq", to: "sara@example.com", subject: "Hi", html: "<p>x</p>", text: "x" };

describe("sanitizeDisplayName", () => {
  it("removes anything that could break the header or forge an address", () => {
    expect(sanitizeDisplayName('Evil" <a@b.com>\r\nBcc: x@y.com')).not.toMatch(/[\r\n<>"]/);
    expect(sanitizeDisplayName("A, B; C\\")).toBe("A B C");
  });

  it("is bounded, collapses space and falls back when nothing is left", () => {
    expect(sanitizeDisplayName("x".repeat(200)).length).toBe(60);
    expect(sanitizeDisplayName("  a   b  ")).toBe("a b");
    expect(sanitizeDisplayName("<>\"", "Shop")).toBe("Shop");
  });
});

describe("assertSingleLine", () => {
  it("rejects every kind of line break", () => {
    for (const v of ["a\nb", "a\rb", "a\r\nb", "a b", "a\0b"]) expect(() => assertSingleLine("Subject", v)).toThrow();
    expect(assertSingleLine("Subject", "fine")).toBe("fine");
  });
});

describe("MailService", () => {
  it("reports not configured without SMTP, and logs instead of sending", async () => {
    const mail = new MailService(config({}));
    expect(mail.configured).toBe(false);
    expect(mail.describeFrom("Al Lahiq")).toBeNull();
    expect(await mail.send(message)).toMatchObject({ ok: true, simulated: true });
  });

  it("reports configured with SMTP and a from address, and names the shop in From", () => {
    const mail = new MailService(config({ SMTP_HOST: "smtp.example.com", MAIL_FROM_ADDRESS: "orders@mail.example.com" }));
    expect(mail.configured).toBe(true);
    expect(mail.describeFrom('Al "Lahiq"')).toBe("Al Lahiq <orders@mail.example.com>");
  });

  it("refuses a header-injection attempt as a permanent failure, in every driver", async () => {
    const mail = new MailService(config({}));
    for (const bad of [{ subject: "Hi\r\nBcc: x@y.com" }, { to: "a@b.com\nBcc: x@y.com" }, { replyTo: "a@b.com\r\nX: y" }, { headers: { "X-A": "b\nc" } }]) {
      const out = await mail.send({ ...message, ...bad });
      expect(out).toMatchObject({ ok: false, failure: { permanent: true } });
    }
  });

  it("honours MAIL_DRIVER=log even when SMTP is configured", () => {
    const mail = new MailService(config({ MAIL_DRIVER: "log", SMTP_HOST: "h", MAIL_FROM_ADDRESS: "a@b.com" }));
    expect(mail.configured).toBe(false);
  });
});
