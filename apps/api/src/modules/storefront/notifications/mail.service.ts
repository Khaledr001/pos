import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import nodemailer, { type Transporter } from "nodemailer";
import type { Env } from "../../../config/env.js";
import { classifySmtpError, type SendFailure } from "./delivery-policy.js";

const SEND_TIMEOUT_MS = 15_000;

export interface MailMessage {
  /** The shop's display name. Sanitised here; never trusted. */
  fromName: string;
  replyTo?: string | null;
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}

/** `simulated` = the log driver: nothing left this server, and the caller must not call it delivered. */
export type MailResult = { ok: true; providerId: string; simulated?: true } | { ok: false; failure: SendFailure };

/** A header value must be one line: a CR or LF would let a shopper-controlled name add a header. */
export function assertSingleLine(label: string, value: string): string {
  if (/[\r\n\u0085\u2028\u2029\0]/.test(value)) throw new Error(`${label} must be a single line`);
  return value;
}

/** A display name that cannot break out of its quoted form or smuggle an address. */
export function sanitizeDisplayName(name: string, fallback = "Online store"): string {
  const cleaned = name
    .replace(/[\r\n\u0085\u2028\u2029\0]/g, " ")
    .replace(/[<>"\\;,]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return cleaned || fallback;
}

/**
 * The platform's one outbound mail transport.
 *
 * SMTP, because every provider speaks it (SES, Postmark, Resend, a plain
 * relay). `log` writes the envelope to the log and sends nothing: development
 * default, and what an unconfigured production shows as "email not set up"
 * rather than failing boot.
 *
 * Every shop sends from the ONE verified address (MAIL_FROM_ADDRESS) under
 * its own display name, with its own reply-to: a shop's domain cannot be
 * spoofed, and replies still reach the shop.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;
  private readonly fromAddress: string | null;
  private readonly driver: "smtp" | "log";

  constructor(private readonly config: ConfigService<Env, true>) {
    const host = this.config.get("SMTP_HOST", { infer: true });
    this.fromAddress = this.config.get("MAIL_FROM_ADDRESS", { infer: true }) ?? null;
    this.driver = this.config.get("MAIL_DRIVER", { infer: true }) ?? (host ? "smtp" : "log");
  }

  /** Real mail can leave this server. */
  get configured(): boolean {
    return this.driver === "smtp" && !!this.fromAddress;
  }

  /** `Al Lahiq <orders@mail.devsfleet.com>`, for the admin to show. */
  describeFrom(fromName: string): string | null {
    return this.fromAddress ? `${sanitizeDisplayName(fromName)} <${this.fromAddress}>` : null;
  }

  async send(message: MailMessage): Promise<MailResult> {
    try {
      assertSingleLine("Subject", message.subject);
      assertSingleLine("Recipient", message.to);
      if (message.replyTo) assertSingleLine("Reply-to", message.replyTo);
      for (const [k, v] of Object.entries(message.headers ?? {})) {
        assertSingleLine("Header name", k);
        assertSingleLine("Header value", v);
      }
    } catch (error) {
      return { ok: false, failure: { permanent: true, message: error instanceof Error ? error.message : "Invalid message" } };
    }

    const name = sanitizeDisplayName(message.fromName);
    if (this.driver === "log") {
      // Never the body or the address: this line lands in shared logs.
      this.logger.log(`[mail:log] "${name}" -> a recipient, subject length ${message.subject.length}; not sent (no SMTP configured)`);
      return { ok: true, providerId: `log-${Date.now()}`, simulated: true };
    }
    if (!this.fromAddress) {
      return { ok: false, failure: { permanent: false, message: "Email is not configured on this server (MAIL_FROM_ADDRESS)." } };
    }

    try {
      const info = (await this.transport().sendMail({
        from: { name, address: this.fromAddress },
        to: message.to,
        ...(message.replyTo ? { replyTo: message.replyTo } : {}),
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(message.headers ? { headers: message.headers } : {}),
      })) as { messageId?: string };
      return { ok: true, providerId: (info.messageId ?? "").slice(0, 100) || "smtp" };
    } catch (error) {
      const failure = classifySmtpError(error);
      this.logger.warn(`Mail send failed (${failure.permanent ? "permanent" : "retryable"}): ${failure.message}`);
      return { ok: false, failure };
    }
  }

  private transport(): Transporter {
    if (!this.transporter) {
      const user = this.config.get("SMTP_USER", { infer: true });
      const pass = this.config.get("SMTP_PASS", { infer: true });
      this.transporter = nodemailer.createTransport({
        host: this.config.get("SMTP_HOST", { infer: true }),
        port: this.config.get("SMTP_PORT", { infer: true }),
        secure: this.config.get("SMTP_SECURE", { infer: true }),
        ...(user && pass ? { auth: { user, pass } } : {}),
        connectionTimeout: SEND_TIMEOUT_MS,
        greetingTimeout: SEND_TIMEOUT_MS,
        socketTimeout: SEND_TIMEOUT_MS,
      });
    }
    return this.transporter;
  }
}
