import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { visitorIp } from "../../../common/guards/storefront-aware-throttler.guard.js";
import { zodPipe } from "../../../common/pipes/zod-validation.pipe.js";
import { StorefrontRoute } from "../context/storefront.guard.js";
import { SubmitFormSchema, type SubmitFormDto } from "./dto.js";
import { FormsService } from "./forms.service.js";

/**
 * Forms are content, not commerce: every site type has them, so no site-feature
 * requirement here. Public — a visitor has no account — so the throttle and the
 * service's own checks (honeypot, timing, validation, dedupe) are what stand
 * between this and a mail-bomb.
 */
@ApiTags("storefront")
@StorefrontRoute()
@Controller("storefront/forms")
export class FormsController {
  constructor(private readonly forms: FormsService) {}

  @Get(":slug")
  get(@Param("slug") slug: string) {
    return this.forms.get(slug);
  }

  @Post(":slug/submit")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  submit(@Req() req: Request, @Param("slug") slug: string, @Body(zodPipe(SubmitFormSchema)) dto: SubmitFormDto) {
    return this.forms.submit(slug, dto, visitorIp(req));
  }
}
