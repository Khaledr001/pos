import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { COOKIES } from '../../common/auth.js';
import type { AppRequest, CustomerPrincipal, StaffPrincipal } from '../../common/auth.js';
import { CurrentCustomer, CurrentStaff } from '../../common/decorators/principals.js';
import { CustomerAuthGuard, StaffAuthGuard } from '../../common/guards/auth.guards.js';
import { CartService } from '../cart/cart.service.js';
import { AuthService, toCustomerDto, toStaffDto } from './auth.service.js';
import { LoginDto, RegisterDto } from './dto/auth.dto.js';
import { TokenService } from './token.service.js';

const cookie = (req: AppRequest, name: string) =>
  (req.cookies as Record<string, string> | undefined)?.[name];

/** Password endpoints are rate limited per IP; session endpoints use the global limit. */
const PASSWORD_LIMIT = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly carts: CartService,
  ) {}

  // ── customers ──

  @Post('register')
  @Throttle(PASSWORD_LIMIT)
  async register(@Body() dto: RegisterDto, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const customer = await this.auth.registerCustomer(dto);
    await this.startCustomerSession(customer.id, req, res);
    return toCustomerDto(customer);
  }

  @Post('login')
  @Throttle(PASSWORD_LIMIT)
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const customer = await this.auth.validateCustomer(dto);
    await this.startCustomerSession(customer.id, req, res);
    return toCustomerDto(customer);
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const { tokens, subjectId } = await this.tokens.rotate('customer', cookie(req, COOKIES.customerRefresh));
    this.tokens.setCookies(res, 'customer', tokens);
    return toCustomerDto(await this.auth.getCustomer(subjectId));
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    await this.tokens.revoke(cookie(req, COOKIES.customerRefresh));
    this.tokens.clearCookies(res, 'customer');
    res.clearCookie(COOKIES.cart, { path: '/' });
  }

  @Get('me')
  @UseGuards(CustomerAuthGuard)
  async me(@CurrentCustomer() c: CustomerPrincipal) {
    return toCustomerDto(await this.auth.getCustomer(c.id));
  }

  private async startCustomerSession(customerId: string, req: AppRequest, res: Response) {
    const tokens = await this.tokens.issue('customer', customerId);
    this.tokens.setCookies(res, 'customer', tokens);
    await this.carts.adoptGuestCart(cookie(req, COOKIES.cart), customerId);
    res.clearCookie(COOKIES.cart, { path: '/' });
  }

  // ── staff (admin panel) ──

  @Post('staff/login')
  @Throttle(PASSWORD_LIMIT)
  @HttpCode(200)
  async staffLogin(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const staff = await this.auth.validateStaff(dto);
    this.tokens.setCookies(res, 'staff', await this.tokens.issue('staff', staff.id, staff.role));
    return toStaffDto(staff);
  }

  @Post('staff/refresh')
  @HttpCode(200)
  async staffRefresh(@Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const { tokens, subjectId } = await this.tokens.rotate('staff', cookie(req, COOKIES.staffRefresh), (id) =>
      this.auth.activeStaffRole(id),
    );
    this.tokens.setCookies(res, 'staff', tokens);
    return toStaffDto(await this.auth.getStaff(subjectId));
  }

  @Post('staff/logout')
  @HttpCode(204)
  async staffLogout(@Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    await this.tokens.revoke(cookie(req, COOKIES.staffRefresh));
    this.tokens.clearCookies(res, 'staff');
  }

  @Get('staff/me')
  @UseGuards(StaffAuthGuard)
  async staffMe(@CurrentStaff() s: StaffPrincipal) {
    return toStaffDto(await this.auth.getStaff(s.id));
  }
}
