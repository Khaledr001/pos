import { Body, Controller, HttpCode, Module, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { AppRequest, CustomerPrincipal } from '../../common/auth.js';
import { MaybeCustomer } from '../../common/decorators/principals.js';
import { OptionalCustomerGuard } from '../../common/guards/auth.guards.js';
import { CartContext } from '../cart/cart-context.service.js';
import { CheckoutService } from './checkout.service.js';
import { PlaceOrderDto, QuoteDto } from './dto/checkout.dto.js';

@ApiTags('checkout')
@Controller('checkout')
@UseGuards(OptionalCustomerGuard)
export class CheckoutController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly context: CartContext,
  ) {}

  /** Delivery options, fees, payment methods and totals for the current cart. */
  @Post('quote')
  @HttpCode(200)
  async quote(
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: QuoteDto,
    @MaybeCustomer() c?: CustomerPrincipal,
  ) {
    return this.checkout.quote(await this.context.resolve(req, res, c), c?.id, dto);
  }

  @Post('place')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async place(
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: PlaceOrderDto,
    @MaybeCustomer() c?: CustomerPrincipal,
  ) {
    return this.checkout.place(await this.context.resolve(req, res, c), c?.id, dto);
  }
}

@Module({
  controllers: [CheckoutController],
  providers: [CheckoutService],
})
export class CheckoutModule {}
