import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { zodPipe } from "../../../common/pipes/zod-validation.pipe.js";
import { SessionCookies } from "../context/session-cookies.service.js";
import { StorefrontRoute } from "../context/storefront.guard.js";
import { CheckoutService } from "./checkout.service.js";
import { PlaceOrderSchema, QuoteSchema, type PlaceOrderDto, type QuoteDto } from "./dto.js";

@ApiTags("storefront")
@StorefrontRoute()
@Controller("storefront/checkout")
export class CheckoutController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly cookies: SessionCookies,
  ) {}

  @Post("quote")
  @HttpCode(HttpStatus.OK)
  quote(@Req() req: Request, @Body(zodPipe(QuoteSchema)) dto: QuoteDto) {
    return this.checkout.quote(this.cookies.guestCartId(req), dto);
  }

  @Post("place")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async place(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body(zodPipe(PlaceOrderSchema)) dto: PlaceOrderDto) {
    const result = await this.checkout.place(this.cookies.guestCartId(req), dto);
    // The cart became an order; the next visit starts a fresh one.
    this.cookies.clearGuestCart(res);
    return result;
  }
}
