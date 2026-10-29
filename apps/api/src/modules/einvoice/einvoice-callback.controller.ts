import { Controller, Headers, HttpCode, Param, ParseUUIDPipe, Post, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import type { Request } from "express";
import { Public } from "../../common/decorators/index.js";
import { EinvoiceCallbackService } from "./einvoice-callback.service.js";

/**
 * Where an e-invoicing provider reports status after the fact. Public — the
 * provider holds no session — so the service authenticates every call (see
 * EinvoiceCallbackService): unguessable token AND an HMAC of the raw body.
 */
@ApiTags("einvoice")
@Controller("einvoice/callback")
export class EinvoiceCallbackController {
  constructor(private readonly callbacks: EinvoiceCallbackService) {}

  @Post(":token")
  @Public()
  @SkipThrottle()
  @HttpCode(200)
  @ApiOperation({ summary: "Provider status callback (delivered / rejected)" })
  callback(
    @Param("token", ParseUUIDPipe) token: string,
    @Req() req: Request & { rawBody?: Buffer },
    @Headers("x-signature") signature?: string,
  ) {
    return this.callbacks.handle(token, req.rawBody, signature);
  }
}
