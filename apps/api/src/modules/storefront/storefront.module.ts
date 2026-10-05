import { Module } from "@nestjs/common";
import { OrdersModule } from "../orders/orders.module.js";
import { PricingModule } from "../pricing/pricing.module.js";
import { AccountController } from "./account/account.controller.js";
import { ContentAdminService } from "./admin/content-admin.service.js";
import { ListingsAdminService } from "./admin/listings-admin.service.js";
import { OrderDeskService } from "./admin/order-desk.service.js";
import { SettingsAdminService } from "./admin/settings-admin.service.js";
import {
  ContentAdminController,
  ListingsAdminController,
  OrderDeskController,
  SettingsAdminController,
  TradeAdminController,
} from "./admin/storefront-admin.controller.js";
import { TradeAdminService } from "./admin/trade-admin.service.js";
import { AccountService } from "./account/account.service.js";
import { ShopperAuthController } from "./account/shopper-auth.controller.js";
import { ShopperAuthService } from "./account/shopper-auth.service.js";
import { CartController } from "./cart/cart.controller.js";
import { CartService } from "./cart/cart.service.js";
import { CouponsService } from "./cart/coupons.service.js";
import { StorefrontCatalogController } from "./catalog/storefront-catalog.controller.js";
import { StorefrontCatalogService } from "./catalog/storefront-catalog.service.js";
import { CheckoutController } from "./checkout/checkout.controller.js";
import { CheckoutService } from "./checkout/checkout.service.js";
import { StorefrontContentController } from "./content/storefront-content.controller.js";
import { StorefrontContentService } from "./content/storefront-content.service.js";
import { DomainCheckController } from "./context/domain-check.controller.js";
import { SessionCookies } from "./context/session-cookies.service.js";
import { ShopperTokens } from "./context/shopper-tokens.service.js";
import { StorefrontGuard } from "./context/storefront.guard.js";
import { StorefrontResolver } from "./context/storefront-resolver.service.js";
import { WebOrdersController } from "./orders/web-orders.controller.js";
import { WebOrdersService } from "./orders/web-orders.service.js";
import { SalesModule } from "../sales/sales.module.js";
import { PaymentExpiryService } from "./payments/payment-expiry.service.js";
import { DevPaymentsController, StripeWebhookController } from "./payments/payments.controller.js";
import { StorefrontPaymentsService } from "./payments/payments.service.js";
import { StorefrontPricing } from "./pricing/storefront-pricing.service.js";
import { RevalidationService } from "./revalidation/revalidation.service.js";

/**
 * The online store, as a channel on the platform's own catalogue, prices,
 * stock and orders. See packages/db/src/schema/storefront.ts for what lives
 * here and what deliberately does not.
 *
 * Every controller is `/storefront/*` and carries `@StorefrontRoute()`: the
 * tenant comes from the request's host, never from a token or a body. The one
 * exception is the Stripe webhook, which is routed by its payment account.
 *
 * `/storefront-admin/*` is the staff side: ordinary authenticated routes, each
 * with its permission, scoped to the staff member's own tenant.
 */
@Module({
  imports: [PricingModule, OrdersModule, SalesModule],
  controllers: [
    StorefrontCatalogController,
    StorefrontContentController,
    ShopperAuthController,
    AccountController,
    CartController,
    CheckoutController,
    WebOrdersController,
    StripeWebhookController,
    DevPaymentsController,
    DomainCheckController,
    // Staff side — ordinary JWT + permission routes under /storefront-admin.
    OrderDeskController,
    ListingsAdminController,
    ContentAdminController,
    TradeAdminController,
    SettingsAdminController,
  ],
  providers: [
    StorefrontResolver,
    ShopperTokens,
    SessionCookies,
    StorefrontGuard,
    StorefrontPricing,
    StorefrontCatalogService,
    StorefrontContentService,
    ShopperAuthService,
    AccountService,
    CouponsService,
    CartService,
    CheckoutService,
    WebOrdersService,
    StorefrontPaymentsService,
    PaymentExpiryService,
    RevalidationService,
    OrderDeskService,
    ListingsAdminService,
    ContentAdminService,
    TradeAdminService,
    SettingsAdminService,
  ],
  exports: [StorefrontResolver, WebOrdersService],
})
export class StorefrontModule {}
