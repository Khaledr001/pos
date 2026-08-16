import type { AuthenticatedUser } from "@devsfleet/shared-types";
import { Body, Controller, Get, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser, Public } from "../../common/decorators/index.js";
import { zodPipe } from "../../common/pipes/zod-validation.pipe.js";
import { AuthService } from "./auth.service.js";
import {
  LoginSchema,
  PinLoginSchema,
  RefreshSchema,
  type LoginDto,
  type PinLoginDto,
  type RefreshDto,
} from "./dto.js";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post("login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Email + password login (admin panel)" })
  login(@Body(zodPipe(LoginSchema)) dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Public()
  @Post("pin-login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "PIN login from a registered POS terminal" })
  pinLogin(@Body(zodPipe(PinLoginSchema)) dto: PinLoginDto) {
    return this.auth.pinLogin(dto);
  }

  @Public()
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
