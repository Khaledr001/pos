/**
 * Compile-time contract test: every storefront response the platform API
 * produces must be assignable to the type the website relies on. Run with
 * `pnpm --filter @al-lahiq/api-client test`. If this fails, change the API's
 * storefront module or src/types.ts — never silence it.
 */
import type { AccountService } from '../../../../apps/api/src/modules/storefront/account/account.service.js';
import type { ShopperAuthService } from '../../../../apps/api/src/modules/storefront/account/shopper-auth.service.js';
import type { CartService } from '../../../../apps/api/src/modules/storefront/cart/cart.service.js';
import type { StorefrontCatalogService } from '../../../../apps/api/src/modules/storefront/catalog/storefront-catalog.service.js';
import type { CheckoutService } from '../../../../apps/api/src/modules/storefront/checkout/checkout.service.js';
import type { StorefrontContentService } from '../../../../apps/api/src/modules/storefront/content/storefront-content.service.js';
import type { WebOrdersService } from '../../../../apps/api/src/modules/storefront/orders/web-orders.service.js';
import type * as C from '../src/index.ts';

/** What JSON.stringify turns a value into. */
type Jsonify<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Jsonify<U>[]
    : T extends object
      ? { [K in keyof T]: Jsonify<T[K]> }
      : T;

type Out<F extends (...args: any) => any> = Jsonify<Awaited<ReturnType<F>>>;
type Check<Actual extends Expected, Expected> = [Actual, Expected];

export type Contract = [
  // catalog
  Check<Out<StorefrontCatalogService['categoryTree']>, C.CategoryNode[]>,
  Check<Out<StorefrontCatalogService['category']>, C.CategoryDetail>,
  Check<Out<StorefrontCatalogService['brands']>, C.BrandSummary[]>,
  Check<Out<StorefrontCatalogService['brand']>, C.BrandDetail>,
  Check<Out<StorefrontCatalogService['listProducts']>, C.ProductList>,
  Check<Out<StorefrontCatalogService['product']>, C.ProductDetail>,
  Check<Out<StorefrontCatalogService['prices']>, C.PriceMap>,
  Check<Out<StorefrontCatalogService['suggest']>, C.Suggestions>,
  // cart & checkout
  Check<Out<CartService['view']>['view'], C.CartView>,
  Check<Out<CheckoutService['quote']>, C.CheckoutQuote>,
  Check<Out<CheckoutService['place']>, C.PlaceOrderResult>,
  // orders & account
  Check<Out<WebOrdersService['track']>, C.OrderView>,
  Check<Out<ShopperAuthService['me']>, C.Customer>,
  Check<Out<AccountService['orderList']>, C.Paged<C.OrderSummary>>,
  Check<Out<AccountService['addresses']>, C.Address[]>,
  Check<Out<AccountService['lists']>, C.ProjectListSummary[]>,
  Check<Out<AccountService['list']>, C.ProjectListDetail>,
  Check<Out<AccountService['reorder']>, C.AddedToCart>,
  // content
  Check<Out<StorefrontContentService['home']>, C.HomeData>,
  Check<Out<StorefrontContentService['page']>, C.Page>,
  Check<Out<StorefrontContentService['blog']>, C.BlogList>,
  Check<Out<StorefrontContentService['branches']>, C.Branch[]>,
  Check<Out<StorefrontContentService['store']>, C.StoreInfo>,
];
