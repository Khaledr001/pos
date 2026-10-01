import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { zodPipe } from "../../../common/pipes/zod-validation.pipe.js";
import { SessionCookies } from "../context/session-cookies.service.js";
import { StorefrontRoute } from "../context/storefront.guard.js";
import { CartService } from "./cart.service.js";
import {
  AddCartItemSchema,
  ApplyCouponSchema,
  UpdateCartItemSchema,
  type AddCartItemDto,
  type ApplyCouponDto,
  type UpdateCartItemDto,
} from "./dto.js";

@ApiTags("storefront")
@StorefrontRoute()
@Controller("storefront/cart")
export class CartController {
  constructor(
    private readonly carts: CartService,
    private readonly cookies: SessionCookies,
  ) {}

  @Get()
  async get(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.reply(res, await this.carts.view(this.cookies.guestCartId(req)));
  }

  @Post("items")
  async add(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body(zodPipe(AddCartItemSchema)) dto: AddCartItemDto) {
    return this.reply(res, await this.carts.addItem(this.cookies.guestCartId(req), dto));
  }

  @Patch("items/:id")
  async update(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(UpdateCartItemSchema)) dto: UpdateCartItemDto,
  ) {
    return this.reply(res, await this.carts.updateItem(this.cookies.guestCartId(req), id, dto.quantity));
  }

  @Delete("items/:id")
  async remove(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param("id", ParseUUIDPipe) id: string) {
    return this.reply(res, await this.carts.removeItem(this.cookies.guestCartId(req), id));
  }

  @Post("coupon")
  async coupon(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body(zodPipe(ApplyCouponSchema)) dto: ApplyCouponDto) {
    return this.reply(res, await this.carts.setCoupon(this.cookies.guestCartId(req), dto.code));
  }

  @Delete("coupon")
  async removeCoupon(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.reply(res, await this.carts.setCoupon(this.cookies.guestCartId(req), null));
  }

  /** A newly created guest cart is remembered in its cookie; the body is the cart either way. */
  private reply<T>(res: Response, result: { view: T; newGuestCartId: string | null }): T {
    if (result.newGuestCartId) this.cookies.setGuestCart(res, result.newGuestCartId);
    return result.view;
  }
}
