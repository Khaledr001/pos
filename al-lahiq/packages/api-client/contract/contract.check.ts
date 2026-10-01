/**
 * Compile-time contract test: every backend response must be assignable to
 * the type the frontend relies on. Run with `pnpm --filter @al-lahiq/api-client test`.
 * If this fails, update the backend or src/types.ts — never silence it.
 */
import type { AccountService } from '../../../backend/src/modules/account/account.service.js';
import type { AdminCatalogService } from '../../../backend/src/modules/admin/admin-catalog.service.js';
import type { AdminOpsService } from '../../../backend/src/modules/admin/admin-ops.service.js';
import type { toCustomerDto, toStaffDto } from '../../../backend/src/modules/auth/auth.service.js';
import type { CartService } from '../../../backend/src/modules/cart/cart.service.js';
import type { CatalogService } from '../../../backend/src/modules/catalog/catalog.service.js';
import type { CheckoutService } from '../../../backend/src/modules/checkout/checkout.service.js';
import type { ContentService } from '../../../backend/src/modules/content/content.module.js';
import type { toOrderView } from '../../../backend/src/modules/orders/order.mapper.js';
import type { SettingsService } from '../../../backend/src/modules/settings/settings.service.js';
import type { ShippingService } from '../../../backend/src/modules/shipping/shipping.service.js';
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
  Check<Out<CatalogService['categoryTree']>, C.CategoryNode[]>,
  Check<Out<CatalogService['category']>, C.CategoryDetail>,
  Check<Out<CatalogService['brands']>, C.BrandSummary[]>,
  Check<Out<CatalogService['brand']>, C.BrandDetail>,
  Check<Out<CatalogService['listProducts']>, C.ProductList>,
  Check<Out<CatalogService['product']>, C.ProductDetail>,
  Check<Out<CatalogService['prices']>, C.PriceMap>,
  Check<Out<CatalogService['suggest']>, C.Suggestions>,
  // cart & checkout
  Check<Out<CartService['view']>, C.CartView>,
  Check<Out<CheckoutService['quote']>, C.CheckoutQuote>,
  Check<Out<CheckoutService['place']>, C.PlaceOrderResult>,
  Check<Out<ShippingService['pickupBranches']>, C.PickupBranch[]>,
  // orders & account
  Check<Jsonify<ReturnType<typeof toOrderView>>, C.OrderView>,
  Check<Jsonify<ReturnType<typeof toCustomerDto>>, C.Customer>,
  Check<Out<AccountService['orders']>, C.Paged<C.OrderSummary>>,
  Check<Out<AccountService['addresses']>, C.Address[]>,
  Check<Out<AccountService['lists']>, C.ProjectListSummary[]>,
  Check<Out<AccountService['list']>, C.ProjectListDetail>,
  Check<Out<AccountService['reorder']>, C.AddedToCart>,
  // content
  Check<Out<ContentService['home']>, C.HomeData>,
  Check<Out<ContentService['page']>, C.Page>,
  Check<Out<ContentService['blog']>, C.BlogList>,
  Check<Out<ContentService['branches']>, C.Branch[]>,
  Check<Out<ContentService['store']>, C.StoreInfo>,
  // admin
  Check<Jsonify<ReturnType<typeof toStaffDto>>, C.Staff>,
  Check<Out<AdminCatalogService['products']>, C.AdminProductList>,
  Check<Out<AdminCatalogService['product']>, C.AdminProductDetail>,
  Check<Out<AdminCatalogService['categories']>, C.AdminCategory[]>,
  Check<Out<AdminCatalogService['brands']>, C.AdminBrand[]>,
  Check<Out<AdminCatalogService['attributes']>, C.AdminAttribute[]>,
  Check<Out<AdminOpsService['listOrders']>, C.AdminOrderList>,
  Check<Out<AdminOpsService['order']>, C.AdminOrderView>,
  Check<Out<AdminOpsService['listCustomers']>, C.AdminCustomerList>,
  Check<Out<AdminOpsService['customer']>, C.AdminCustomerDetail>,
  Check<Out<AdminOpsService['pages']>, C.AdminPageRow[]>,
  Check<Out<AdminOpsService['banners']>, C.AdminBanner[]>,
  Check<Out<AdminOpsService['coupons']>, C.Coupon[]>,
  Check<Out<AdminOpsService['shippingRates']>, C.ShippingRate[]>,
  Check<Out<AdminOpsService['branches']>, C.AdminBranch[]>,
  Check<Out<AdminOpsService['staff']>, C.Staff[]>,
  Check<Out<AdminOpsService['dashboard']>, C.Dashboard>,
  Check<Out<AdminOpsService['syncStatus']>, C.SyncStatus>,
  Check<Out<AdminOpsService['outboxEvents']>, C.OutboxEvent[]>,
  Check<Out<AdminOpsService['inboundEvents']>, C.InboundEvent[]>,
  Check<Out<SettingsService['all']>, C.Settings>,
];
