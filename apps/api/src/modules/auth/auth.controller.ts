import type { AuthenticatedUser } from "@devsfleet/shared-types";
import { Body, Controller, Get, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser, Public } from "../../common/decorators/index.js";
import { zodPipe } from "../../common/pipes/zod-validation.pipe.js";
import { AuthService } from "./auth.service.js";
import {
  LoginSchema,
  ManagerOverrideSchema,
  PinLoginSchema,
  RefreshSchema,
  type LoginDto,
  type ManagerOverrideDto,
  type PinLoginDto,
  type RefreshDto,
} from "./dto.js";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Ten attempts a minute, not the global 120.
   *
   * The global limit is sized for ordinary API traffic; applied to a credential
   * endpoint it is an invitation. Account lockout covers a targeted attack on
   * one known user, and this covers spraying one password across many.
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Email + password login (admin panel)" })
  login(@Body(zodPipe(LoginSchema)) dto: LoginDto) {
    return this.auth.login(dto);
  }

  /**
   * The tightest limit in the app, because it guards the weakest secret.
   *
   * A PIN is four to six digits — 10,000 possibilities at the short end. Under
   * the global 120/min the whole space falls in under an hour and a half. A
   * failed PIN also names no user, so there is nobody to lock out; the rate
   * limit IS the control here, not a supplement to one.
   *
   * Twenty a minute is far above what shift changes need and far below what
   * guessing needs.
   */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post("pin-login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "PIN login from a registered POS terminal" })
  pinLogin(@Body(zodPipe(PinLoginSchema)) dto: PinLoginDto) {
    return this.auth.pinLogin(dto);
  }

  /**
   * NOT `@Public()`, unlike every other route here.
   *
   * An override is asked for by a terminal that is already signed in, so the
   * branch and device come from its token rather than the body — which is what
   * stops this becoming an unauthenticated oracle for testing PINs against any
   * branch in the estate.
   *
   * No `@RequirePermissions`: the cashier asking is by definition the one who
   * lacks the permission. The approver's rights are what is checked, in the
   * service.
   */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post("verify-override")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Ask whether a supervisor PIN may authorise an action" })
  verifyOverride(
    @Body(zodPipe(ManagerOverrideSchema)) dto: ManagerOverrideDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.auth.verifyOverride(dto, user);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Exchange a refresh token for a new token pair" })
  refresh(@Body(zodPipe(RefreshSchema)) dto: RefreshDto) {
    return this.auth.refresh(dto);
  }

  @Public()
  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Revoke a refresh token" })
  async logout(@Body(zodPipe(RefreshSchema)) dto: RefreshDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }

  @Get("me")
  @ApiOperation({ summary: "The principal behind the current access token" })
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }
}
