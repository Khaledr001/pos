import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { Audited, RequirePermissions } from "../../../common/decorators/index.js";
import { zodPipe } from "../../../common/pipes/zod-validation.pipe.js";
import { ContentAdminService } from "./content-admin.service.js";
import {
  ApproveTradeSchema,
  BannerSchema,
  CouponSchema,
  DomainSchema,
  ListListingsSchema,
  ListWebOrdersSchema,
  PageSchema,
  PaymentAccountSchema,
  ProductLinksSchema,
  RejectTradeSchema,
  SetupStorefrontSchema,
  ShipmentSchema,
  TransitionSchema,
  UpdateBannerSchema,
  UpdateCouponSchema,
  UpdatePageSchema,
  UpdateSettingsSchema,
  UpsertListingSchema,
  type ApproveTradeDto,
  type BannerDto,
  type CouponDto,
  type DomainDto,
  type ListListingsDto,
  type ListWebOrdersDto,
  type PageDto,
  type PaymentAccountDto,
  type ProductLinksDto,
  type RejectTradeDto,
  type SetupStorefrontDto,
  type ShipmentDto,
  type TransitionDto,
  type UpdateBannerDto,
  type UpdateCouponDto,
  type UpdatePageDto,
  type UpdateSettingsDto,
  type UpsertListingDto,
} from "./dto.js";
import { ListingsAdminService } from "./listings-admin.service.js";
import { OrderDeskService } from "./order-desk.service.js";
import { SettingsAdminService } from "./settings-admin.service.js";
import { TradeAdminService } from "./trade-admin.service.js";

/**
 * The online store, from the staff side. Ordinary staff routes: JWT,
 * permissions, RLS on the staff member's own tenant. Nothing here is reachable
 * by a shopper — their token does not even verify against this API's staff key.
 */

@ApiTags("storefront-admin")
@Controller("storefront-admin/orders")
export class OrderDeskController {
  constructor(private readonly desk: OrderDeskService) {}

  @Get()
  @RequirePermissions("order:read")
  list(@Query(zodPipe(ListWebOrdersSchema)) dto: ListWebOrdersDto) {
    return this.desk.list(dto);
  }

  @Get(":id")
  @RequirePermissions("order:read")
  detail(@Param("id", ParseUUIDPipe) id: string) {
    return this.desk.detail(id);
  }

  /** Delivered / collected turns the order into a sale — the sale's own permission is checked there. */
  @Post(":id/status")
  @RequirePermissions("order:write")
  @Audited("web_orders", "status")
  transition(@Param("id", ParseUUIDPipe) id: string, @Body(zodPipe(TransitionSchema)) dto: TransitionDto) {
    return this.desk.transition(id, dto);
  }

  @Post(":id/shipments")
  @RequirePermissions("order:write")
  addShipment(@Param("id", ParseUUIDPipe) id: string, @Body(zodPipe(ShipmentSchema)) dto: ShipmentDto) {
    return this.desk.addShipment(id, dto);
  }

  @Post(":id/refund")
  @RequirePermissions("order:write", "payment:write")
  @Audited("web_orders", "refund")
  refund(@Param("id", ParseUUIDPipe) id: string) {
    return this.desk.refund(id);
  }
}

@ApiTags("storefront-admin")
@Controller("storefront-admin/listings")
export class ListingsAdminController {
  constructor(private readonly listings: ListingsAdminService) {}

  @Get()
  @RequirePermissions("storefront:read")
  list(@Query(zodPipe(ListListingsSchema)) dto: ListListingsDto) {
    return this.listings.list(dto);
  }

  @Post("publish-all")
  @RequirePermissions("storefront:write")
  @Audited("product_listings", "publish_all")
  publishAll() {
    return this.listings.publishAllUnlisted();
  }

  @Post("unpublish")
  @RequirePermissions("storefront:write")
  unpublish(@Body(zodPipe(z.object({ productIds: z.array(z.string().uuid()).min(1).max(500) }))) dto: { productIds: string[] }) {
    return this.listings.unpublish(dto.productIds);
  }

  @Get(":productId")
  @RequirePermissions("storefront:read")
  get(@Param("productId", ParseUUIDPipe) productId: string) {
    return this.listings.get(productId);
  }

  @Put(":productId")
  @RequirePermissions("storefront:write")
  @Audited("product_listings", "upsert")
  upsert(@Param("productId", ParseUUIDPipe) productId: string, @Body(zodPipe(UpsertListingSchema)) dto: UpsertListingDto) {
    return this.listings.upsert(productId, dto);
  }

  @Put(":productId/links")
  @RequirePermissions("storefront:write")
  setLinks(@Param("productId", ParseUUIDPipe) productId: string, @Body(zodPipe(ProductLinksSchema)) dto: ProductLinksDto) {
    return this.listings.setLinks(productId, dto);
  }
}

@ApiTags("storefront-admin")
@Controller("storefront-admin")
export class ContentAdminController {
  constructor(private readonly content: ContentAdminService) {}

  @Get("pages")
  @RequirePermissions("storefront:read")
  pages() {
    return this.content.pages();
  }

  @Get("pages/:id")
  @RequirePermissions("storefront:read")
  page(@Param("id", ParseUUIDPipe) id: string) {
    return this.content.page(id);
  }

  @Post("pages")
  @RequirePermissions("storefront:write")
  createPage(@Body(zodPipe(PageSchema)) dto: PageDto) {
    return this.content.createPage(dto);
  }

  @Patch("pages/:id")
  @RequirePermissions("storefront:write")
  updatePage(@Param("id", ParseUUIDPipe) id: string, @Body(zodPipe(UpdatePageSchema)) dto: UpdatePageDto) {
    return this.content.updatePage(id, dto);
  }

  @Delete("pages/:id")
  @RequirePermissions("storefront:write")
  deletePage(@Param("id", ParseUUIDPipe) id: string) {
    return this.content.deletePage(id);
  }

  @Get("banners")
  @RequirePermissions("storefront:read")
  banners() {
    return this.content.banners();
  }

  @Post("banners")
  @RequirePermissions("storefront:write")
  createBanner(@Body(zodPipe(BannerSchema)) dto: BannerDto) {
    return this.content.createBanner(dto);
  }

  @Patch("banners/:id")
  @RequirePermissions("storefront:write")
  updateBanner(@Param("id", ParseUUIDPipe) id: string, @Body(zodPipe(UpdateBannerSchema)) dto: UpdateBannerDto) {
    return this.content.updateBanner(id, dto);
  }

  @Delete("banners/:id")
  @RequirePermissions("storefront:write")
  deleteBanner(@Param("id", ParseUUIDPipe) id: string) {
    return this.content.deleteBanner(id);
  }

  @Get("coupons")
  @RequirePermissions("storefront:read")
  coupons() {
    return this.content.coupons();
  }

  /** A promo code is a discount nobody approves at the counter: audited, and capped at its creator's own ceiling. */
  @Post("coupons")
  @RequirePermissions("storefront:write", "sale:discount")
  @Audited("coupons", "create")
  createCoupon(@Body(zodPipe(CouponSchema)) dto: CouponDto) {
    return this.content.createCoupon(dto);
  }

  @Patch("coupons/:id")
  @RequirePermissions("storefront:write")
  @Audited("coupons", "update")
  updateCoupon(@Param("id", ParseUUIDPipe) id: string, @Body(zodPipe(UpdateCouponSchema)) dto: UpdateCouponDto) {
    return this.content.updateCoupon(id, dto);
  }
}

@ApiTags("storefront-admin")
@Controller("storefront-admin/trade-applications")
export class TradeAdminController {
  constructor(private readonly trade: TradeAdminService) {}

  @Get()
  @RequirePermissions("customer:read")
  list() {
    return this.trade.list();
  }

  /** The same edit as giving a customer a price list on their record, so the same permission. */
  @Post(":accountId/approve")
  @RequirePermissions("customer:write")
  @Audited("shopper_accounts", "trade_approve")
  approve(@Param("accountId", ParseUUIDPipe) accountId: string, @Body(zodPipe(ApproveTradeSchema)) dto: ApproveTradeDto) {
    return this.trade.approve(accountId, dto);
  }

  @Post(":accountId/reject")
  @RequirePermissions("customer:write")
  reject(@Param("accountId", ParseUUIDPipe) accountId: string, @Body(zodPipe(RejectTradeSchema)) dto: RejectTradeDto) {
    return this.trade.reject(accountId, dto);
  }
}

@ApiTags("storefront-admin")
@Controller("storefront-admin/settings")
export class SettingsAdminController {
  constructor(private readonly settings: SettingsAdminService) {}

  @Get()
  @RequirePermissions("storefront:read")
  get() {
    return this.settings.get();
  }

  @Post("setup")
  @RequirePermissions("storefront:write", "settings:write")
  @Audited("storefronts", "setup")
  setup(@Body(zodPipe(SetupStorefrontSchema)) dto: SetupStorefrontDto) {
    return this.settings.setup(dto);
  }

  @Patch()
  @RequirePermissions("storefront:write")
  @Audited("storefronts", "update")
  update(@Body(zodPipe(UpdateSettingsSchema)) dto: UpdateSettingsDto) {
    return this.settings.update(dto);
  }

  @Post("domains")
  @RequirePermissions("storefront:write", "settings:write")
  @Audited("storefront_domains", "add")
  addDomain(@Body(zodPipe(DomainSchema)) dto: DomainDto) {
    return this.settings.addDomain(dto);
  }

  @Delete("domains/:id")
  @RequirePermissions("storefront:write", "settings:write")
  @Audited("storefront_domains", "remove")
  removeDomain(@Param("id", ParseUUIDPipe) id: string) {
    return this.settings.removeDomain(id);
  }

  /** Where the shop's card takings go. Settings-level authority, and audited. */
  @Put("payment-account")
  @RequirePermissions("storefront:write", "settings:write")
  @Audited("storefront_payment_accounts", "set")
  setPaymentAccount(@Body(zodPipe(PaymentAccountSchema)) dto: PaymentAccountDto) {
    return this.settings.setPaymentAccount(dto);
  }

  @Delete("payment-account")
  @RequirePermissions("storefront:write", "settings:write")
  @Audited("storefront_payment_accounts", "remove")
  removePaymentAccount() {
    return this.settings.removePaymentAccount();
  }
}
