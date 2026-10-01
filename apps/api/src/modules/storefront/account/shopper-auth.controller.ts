import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { zodPipe } from "../../../common/pipes/zod-validation.pipe.js";
import { SessionCookies } from "../context/session-cookies.service.js";
import { RequireShopper, StorefrontRoute } from "../context/storefront.guard.js";
import { LoginSchema, RegisterSchema, type LoginDto, type RegisterDto } from "./dto.js";
import { ShopperAuthService } from "./shopper-auth.service.js";

/**
 * Shopper sessions. Tokens travel only as httpOnly cookies — the body never
 * carries one, so a script on the page has nothing to steal.
 */
@ApiTags("storefront")
@StorefrontRoute()
@Controller("storefront/auth")
export class ShopperAuthController {
  constructor(
    private readonly auth: ShopperAuthService,
    private readonly cookies: SessionCookies,
  ) {}

  @Post("register")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async register(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body(zodPipe(RegisterSchema)) dto: RegisterDto) {
    const { customer, tokens } = await this.auth.register(dto, this.cookies.guestCartId(req));
    this.cookies.setSession(res, tokens);
    this.cookies.clearGuestCart(res);
    return customer;
  }

  @Post("login")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body(zodPipe(LoginSchema)) dto: LoginDto) {
    const { customer, tokens } = await this.auth.login(dto, this.cookies.guestCartId(req));
    this.cookies.setSession(res, tokens);
    this.cookies.clearGuestCart(res);
    return customer;
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const tokens = await this.cookies.clearSessionOnFailure(res, this.auth.refresh(this.cookies.refreshToken(req)));
    this.cookies.setSession(res, tokens);
    return { refreshed: true };
  }

  @Post("logout")
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(this.cookies.refreshToken(req));
    this.cookies.clearSession(res);
    return { loggedOut: true };
  }

  @Get("me")
  @RequireShopper()
  me() {
    return this.auth.me();
  }
}
