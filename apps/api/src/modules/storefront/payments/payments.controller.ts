import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import type { Request } from "express";
import { z } from "zod";
import { Public } from "../../../common/decorators/index.js";
import { zodPipe } from "../../../common/pipes/zod-validation.pipe.js";
import { StorefrontRoute } from "../context/storefront.guard.js";
import { StorefrontPaymentsService } from "./payments.service.js";

const DevCompleteSchema = z.object({ outcome: z.enum(["success", "fail"]) });

/**
 * Stripe's callback. Not a storefront route: Stripe calls the API host
 * directly, with no shop hostname — the account id in the path is how it is
 * routed, and the signature (checked against that account's own secret) is
 * how it is authenticated.
 */
@ApiTags("storefront")
@Public()
@Controller("storefront/payments/stripe")
export class StripeWebhookController {
  constructor(private readonly payments: StorefrontPaymentsService) {}

  @Post("webhook/:accountId")
  @HttpCode(HttpStatus.OK)
  @SkipThrottle()
  async webhook(@Param("accountId", ParseUUIDPipe) accountId: string, @Req() req: Request & { rawBody?: Buffer }) {
    await this.payments.stripeWebhook(accountId, req.rawBody, req.header("stripe-signature"));
    return { received: true };
  }
}

@ApiTags("storefront")
@StorefrontRoute()
@Controller("storefront/payments")
export class DevPaymentsController {
  constructor(private readonly payments: StorefrontPaymentsService) {}

  /** The dev gateway's test page. 404 unless STOREFRONT_DEV_PAYMENTS is on. */
  @Post("dev/:ref/complete")
  @HttpCode(HttpStatus.OK)
  complete(@Param("ref") ref: string, @Body(zodPipe(DevCompleteSchema)) dto: z.infer<typeof DevCompleteSchema>) {
    return this.payments.devComplete(ref, dto.outcome);
  }
}
