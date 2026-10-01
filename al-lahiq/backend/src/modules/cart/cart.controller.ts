import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import type { Response } from 'express';
import type { AppRequest, CustomerPrincipal } from '../../common/auth.js';
import { MaybeCustomer } from '../../common/decorators/principals.js';
import { OptionalCustomerGuard } from '../../common/guards/auth.guards.js';
import { CartContext } from './cart-context.service.js';
import { CartService } from './cart.service.js';

export class AddCartItemDto {
  @IsUUID()
  variantId: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  uom?: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity: number;
}

export class UpdateCartItemDto {
  /** 0 removes the item */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  quantity: number;
}

export class ApplyCouponDto {
  @IsString()
  @MaxLength(40)
  code: string;
}

@ApiTags('cart')
@Controller('cart')
@UseGuards(OptionalCustomerGuard)
export class CartController {
  constructor(
    private readonly carts: CartService,
    private readonly context: CartContext,
  ) {}

  private cart(req: AppRequest, res: Response, customer?: CustomerPrincipal) {
    return this.context.resolve(req, res, customer);
  }

  @Get()
  async get(@Req() req: AppRequest, @Res({ passthrough: true }) res: Response, @MaybeCustomer() c?: CustomerPrincipal) {
    return this.carts.view(await this.cart(req, res, c), c?.id);
  }

  @Post('items')
  async add(
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: AddCartItemDto,
    @MaybeCustomer() c?: CustomerPrincipal,
  ) {
    const cart = await this.cart(req, res, c);
    await this.carts.addItem(cart, c?.id, dto);
    return this.carts.view(cart, c?.id);
  }

  @Patch('items/:id')
  async update(
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCartItemDto,
    @MaybeCustomer() c?: CustomerPrincipal,
  ) {
    const cart = await this.cart(req, res, c);
    await this.carts.updateItem(cart, c?.id, id, dto.quantity);
    return this.carts.view(cart, c?.id);
  }

  @Delete('items/:id')
  async remove(
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('id', ParseUUIDPipe) id: string,
    @MaybeCustomer() c?: CustomerPrincipal,
  ) {
    const cart = await this.cart(req, res, c);
    await this.carts.removeItem(cart, id);
    return this.carts.view(cart, c?.id);
  }

  @Post('coupon')
  async coupon(
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: ApplyCouponDto,
    @MaybeCustomer() c?: CustomerPrincipal,
  ) {
    const cart = await this.cart(req, res, c);
    await this.carts.setCoupon(cart, c?.id, dto.code);
    return this.carts.view({ ...cart, couponCode: dto.code.trim().toUpperCase() }, c?.id);
  }

  @Delete('coupon')
  async removeCoupon(@Req() req: AppRequest, @Res({ passthrough: true }) res: Response, @MaybeCustomer() c?: CustomerPrincipal) {
    const cart = await this.cart(req, res, c);
    await this.carts.setCoupon(cart, c?.id, null);
    return this.carts.view({ ...cart, couponCode: null }, c?.id);
  }
}
