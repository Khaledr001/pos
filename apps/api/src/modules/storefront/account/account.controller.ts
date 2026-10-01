import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { zodPipe } from "../../../common/pipes/zod-validation.pipe.js";
import { RequireShopper, StorefrontRoute } from "../context/storefront.guard.js";
import { AccountService } from "./account.service.js";
import {
  ListItemSchema,
  ListNameSchema,
  PageQuerySchema,
  SaveAddressSchema,
  TradeApplicationSchema,
  UpdateAddressSchema,
  UpdateProfileSchema,
  type ListItemDto,
  type ListNameDto,
  type SaveAddressDto,
  type TradeApplicationDto,
  type UpdateAddressDto,
  type UpdateProfileDto,
} from "./dto.js";

/** "wishlist" or a list id. */
const ListIdSchema = z.union([z.literal("wishlist"), z.string().uuid()]);

@ApiTags("storefront")
@StorefrontRoute()
@RequireShopper()
@Controller("storefront/me")
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Patch("profile")
  updateProfile(@Body(zodPipe(UpdateProfileSchema)) dto: UpdateProfileDto) {
    return this.account.updateProfile(dto);
  }

  @Post("trade-application")
  applyForTrade(@Body(zodPipe(TradeApplicationSchema)) dto: TradeApplicationDto) {
    return this.account.applyForTrade(dto);
  }

  @Get("addresses")
  addresses() {
    return this.account.addresses();
  }

  @Post("addresses")
  addAddress(@Body(zodPipe(SaveAddressSchema)) dto: SaveAddressDto) {
    return this.account.addAddress(dto);
  }

  @Patch("addresses/:id")
  updateAddress(@Param("id", ParseUUIDPipe) id: string, @Body(zodPipe(UpdateAddressSchema)) dto: UpdateAddressDto) {
    return this.account.updateAddress(id, dto);
  }

  @Delete("addresses/:id")
  deleteAddress(@Param("id", ParseUUIDPipe) id: string) {
    return this.account.deleteAddress(id);
  }

  @Get("orders")
  orders(@Query(zodPipe(PageQuerySchema)) query: z.infer<typeof PageQuerySchema>) {
    return this.account.orderList(query.page);
  }

  @Get("orders/:id")
  order(@Param("id", ParseUUIDPipe) id: string) {
    return this.account.order(id);
  }

  @Post("orders/:id/reorder")
  reorder(@Param("id", ParseUUIDPipe) id: string) {
    return this.account.reorder(id);
  }

  @Get("lists")
  lists() {
    return this.account.lists();
  }

  @Post("lists")
  createList(@Body(zodPipe(ListNameSchema)) dto: ListNameDto) {
    return this.account.createList(dto);
  }

  @Get("lists/:id")
  list(@Param("id", ParseUUIDPipe) id: string) {
    return this.account.list(id);
  }

  @Patch("lists/:id")
  renameList(@Param("id", ParseUUIDPipe) id: string, @Body(zodPipe(ListNameSchema)) dto: ListNameDto) {
    return this.account.renameList(id, dto);
  }

  @Delete("lists/:id")
  deleteList(@Param("id", ParseUUIDPipe) id: string) {
    return this.account.deleteList(id);
  }

  @Post("lists/:id/items")
  addToList(@Param("id", zodPipe(ListIdSchema)) id: string, @Body(zodPipe(ListItemSchema)) dto: ListItemDto) {
    return this.account.addToList(id, dto);
  }

  @Delete("lists/:id/items/:itemId")
  removeFromList(@Param("id", ParseUUIDPipe) id: string, @Param("itemId", ParseUUIDPipe) itemId: string) {
    return this.account.removeFromList(id, itemId);
  }

  @Post("lists/:id/to-cart")
  listToCart(@Param("id", ParseUUIDPipe) id: string) {
    return this.account.listToCart(id);
  }
}
