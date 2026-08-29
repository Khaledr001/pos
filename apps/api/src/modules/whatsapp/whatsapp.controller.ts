import {
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { RawBodyRequest } from "@nestjs/common";
import type { Request, Response } from "express";
import { Public } from "../../common/decorators/index.js";
import { WhatsappWebhookSchema, WebhookVerifySchema } from "./dto.js";
import { WhatsappService } from "./whatsapp.service.js";

/**
 * Meta's webhook. Both routes are `@Public()` — Meta has no bearer token —
 * so the HMAC signature is the ONLY thing standing between the internet and
 * this endpoint. Nothing below acts on the payload until it verifies.
 *
 * Every path returns 200, including the rejections. Meta retries any non-200
 * and escalates to disabling the subscription, so a payload we cannot use is
 * acknowledged and dropped rather than argued with. The one exception is a
 * bad signature, which is a 403: that is not Meta, and it should not be
 * encouraged to retry.
 *
 * Excluded from Swagger — the shape is Meta's, documented by Meta, and
 * publishing it here only advertises the endpoint.
 */
@ApiExcludeController()
@Controller("whatsapp")
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

  constructor(private readonly whatsapp: WhatsappService) {}

  /**
   * Meta's one-time subscription handshake: echo the challenge back verbatim.
   *
   * `@Res()` because Meta expects the challenge as the ENTIRE body, as plain
   * text. The global TransformInterceptor would wrap it into
   * `{"success":true,"data":"1234"}` — which is a perfectly good JSON envelope
   * and a failed webhook subscription, because Meta compares the whole body
   * against the challenge it sent. Same reason the quotation PDF route takes
   * the response object directly.
   *
   * A rejected handshake answers 403 with an empty body rather than 200 with
   * one: an empty 200 reads to Meta as a mismatched challenge anyway, and 403
   * says plainly that the token was not recognised.
   */
  @Public()
  @Get("webhook")
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async verify(
    @Query() query: Record<string, string>,
    @Res() res: Response,
  ): Promise<void> {
    const parsed = WebhookVerifySchema.safeParse(query);
    const token = parsed.success
      ? await this.whatsapp.verifySubscription(
          parsed.data["hub.mode"],
          parsed.data["hub.verify_token"],
        )
      : null;

    if (!token) {
      this.logger.warn("Rejected a webhook verification with an unrecognised token");
      res.status(HttpStatus.FORBIDDEN).end();
      return;
    }

    const challenge = parsed.success ? (parsed.data["hub.challenge"] ?? "") : "";
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.status(HttpStatus.OK).send(challenge);
  }

  @Public()
  @Post("webhook")
  @HttpCode(HttpStatus.OK)
  /**
   * Higher than a normal route: this is one publisher sending everything for
   * every tenant, and a busy shop legitimately bursts. Still bounded, because
   * the route is public and unauthenticated.
   */
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  async receive(@Req() request: RawBodyRequest<Request>): Promise<{ received: true }> {
    const rawBody = request.rawBody;
    if (!rawBody) {
      // Only possible if `rawBody: true` were removed from main.ts, in which
      // case no signature could ever verify and every message would be
      // silently dropped. Fail loudly in the log rather than quietly here.
      this.logger.error("No raw body on the webhook request — signature cannot be checked");
      return { received: true };
    }

    /**
     * Parsed before it is verified, and that is safe as written.
     *
     * The signature covers the body, but the body is what names the account
     * whose secret verifies it — so the id has to be read first. Parsing
     * untrusted JSON is not the risk; ACTING on it is, and nothing below the
     * signature check does anything but log until it passes.
     */
    const parsed = WhatsappWebhookSchema.safeParse(request.body);
    if (!parsed.success) {
      this.logger.warn("Ignored a webhook payload that did not match the envelope");
      return { received: true };
    }

    const values = this.whatsapp.extractValues(parsed.data);
    const phoneNumberId = values.find((v) => v.metadata?.phone_number_id)?.metadata
      ?.phone_number_id;

    if (!phoneNumberId) {
      // A status-only or unrecognised notification. Acknowledged, ignored.
      return { received: true };
    }

    const account = await this.whatsapp.resolveAccount(phoneNumberId);
    if (!account) {
      this.logger.warn(
        { phoneNumberId },
        "Webhook for a WhatsApp number no tenant has registered",
      );
      return { received: true };
    }

    if (!this.whatsapp.verifySignature(
      rawBody,
      request.headers["x-hub-signature-256"] as string | undefined,
      account.appSecret,
    )) {
      this.logger.error(
        { phoneNumberId, tenantId: account.tenantId },
        "REJECTED a webhook with an invalid signature",
      );
      // The one non-200. This did not come from Meta, and should not be
      // encouraged to retry. Deliberately says nothing about WHY it failed.
      throw new ForbiddenException("Invalid signature");
    }

    for (const value of values) {
      for (const message of value.messages ?? []) {
        const profileName = value.contacts?.[0]?.profile?.name;
        try {
          const stored = await this.whatsapp.persistInbound({
            account,
            from: message.from,
            waMessageId: message.id,
            type: message.type,
            content: message.text?.body ?? null,
            profileName,
            // Meta sends unix seconds as a string.
            occurredAt: message.timestamp
              ? new Date(Number(message.timestamp) * 1000)
              : new Date(),
          });

          // The AI turn belongs here, on a queue, gated on `stored.isNew` so a
          // redelivery never produces a second reply. Not built yet.
          this.logger.log(
            {
              tenantId: stored.tenantId,
              conversationId: stored.conversationId,
              isNew: stored.isNew,
            },
            "Stored an inbound WhatsApp message",
          );
        } catch (error) {
          // One bad message must not cost the rest of the batch, and must not
          // make Meta redeliver the ones that succeeded.
          this.logger.error(
            { err: error, waMessageId: message.id },
            "Failed to store an inbound WhatsApp message",
          );
        }
      }
    }

    return { received: true };
  }
}
