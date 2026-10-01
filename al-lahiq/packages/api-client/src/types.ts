/**
 * Response shapes of the Al-Lahiq API (JSON, so dates are ISO strings).
 * The backend type-checks its responses against these in
 * backend/src/contract.check.ts, so a change on either side fails the build.
 */

// ── shared ──

export interface Money {
  fils: number;
  formatted: string;
}

export type Emirate =
  | 'ABU_DHABI'
  | 'DUBAI'
  | 'SHARJAH'
  | 'AJMAN'
  | 'UMM_AL_QUWAIN'
  | 'RAS_AL_KHAIMAH'
  | 'FUJAIRAH';

export type StockLabel = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';
export type PriceListType = 'RETAIL' | 'TRADE' | 'PROMO';
export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PLACED'
  | 'CONFIRMED'
  | 'PACKED'
  | 'SHIPPED'
  | 'READY_FOR_PICKUP'
  | 'DELIVERED'
  | 'COLLECTED'
  | 'CANCELLED'
  | 'REFUNDED';
export type PaymentStatus = 'PENDING' | 'AUTHORIZED' | 'PAID' | 'FAILED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
export type PaymentMethod = 'CARD' | 'APPLE_PAY' | 'GOOGLE_PAY' | 'COD' | 'TABBY' | 'TAMARA';
export type DeliveryMethod = 'COURIER' | 'PICKUP';
export type CustomerType = 'RETAIL' | 'TRADE';
export type TradeStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';
export type StaffRole = 'OWNER' | 'MANAGER' | 'ORDER_STAFF' | 'CONTENT_EDITOR';
export type CouponType = 'PERCENT' | 'FIXED' | 'FREE_SHIPPING';
export type ProductLinkKind = 'RELATED' | 'ALTERNATIVE' | 'BOUGHT_TOGETHER';

export interface Paged<T> {
  total: number;
  page: number;
  pageSize?: number;
  items: T[];
}

/** Error envelope returned for every non-2xx response. */
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
  path?: string;
}

// ── catalog ──

export interface CategoryNode {
  id: string;
  slug: string;
  name: string;
  imageUrl: string | null;
  children: CategoryNode[];
}

export interface Crumb {
  slug: string;
  name: string;
}

export interface CategoryDetail {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  breadcrumbs: Crumb[];
  children: { slug: string; name: string; imageUrl: string | null }[];
}

export interface BrandSummary {
  slug: string;
  name: string;
  logoUrl: string | null;
  featured: boolean;
}

export interface BrandDetail {
  slug: string;
  name: string;
  logoUrl: string | null;
  description: string | null;
}

export interface ProductCard {
  id: string;
  slug: string;
  name: string;
  brand: { slug: string; name: string } | null;
  image: { url: string; alt: string } | null;
  fromPrice: Money | null;
  baseUom: string;
  variantCount: number;
  inStock: boolean;
  pickupOnly: boolean;
}

export interface Facets {
  brands: { slug: string; name: string; count: number }[];
  attributes: { code: string; name: string; unit: string | null; values: { value: string; count: number }[] }[];
  price: { min: number | null; max: number | null } | null;
}

export interface ProductList {
  items: ProductCard[];
  total: number;
  page: number;
  pageSize: number;
  facets: Facets;
}

export interface PriceView {
  unit: Money;
  unitNet: Money;
  retailUnit: Money;
  discounted: boolean;
  priceListType: PriceListType;
  tiers: { minQty: number; unit: Money; unitNet: Money }[];
}

export interface VariantUnit {
  uom: string;
  factor: number;
  price: PriceView;
}

export interface ProductVariant {
  id: string;
  sku: string;
  name: string;
  options: Record<string, string>;
  baseUom: string;
  weightGrams: number;
  attributes: { code: string; name: string; value: string; unit: string | null }[];
  units: VariantUnit[];
  availability: {
    label: StockLabel;
    available: number;
    branches: { code: string; name: string; label: StockLabel }[];
  };
}

export interface ProductDetail {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  specs: { label: string; value: string }[];
  seoTitle: string | null;
  seoDescription: string | null;
  pickupOnly: boolean;
  vatClass: 'STANDARD_5' | 'ZERO' | 'EXEMPT';
  brand: { slug: string; name: string; logoUrl: string | null } | null;
  category: { slug: string; name: string } | null;
  breadcrumbs: Crumb[];
  images: { url: string; alt: string }[];
  documents: { title: string; url: string; kind: string }[];
  optionAxes: { code: string; values: string[] }[];
  variants: ProductVariant[];
  related: ProductCard[];
  alternatives: ProductCard[];
  boughtTogether: ProductCard[];
}

/** GET /catalog/prices: sku → units with the viewer's price. */
export type PriceMap = Record<string, { uom: string; price: PriceView }[]>;

export interface Suggestions {
  products: ProductCard[];
  categories: Crumb[];
  brands: Crumb[];
}

// ── cart & checkout ──

export type CartIssueCode = 'PRICE_CHANGED' | 'OUT_OF_STOCK' | 'UNAVAILABLE' | 'PICKUP_ONLY_ITEMS';

export interface CartIssue {
  code: CartIssueCode;
  sku?: string;
  message: string;
}

export interface CartItem {
  id: string;
  variantId: string;
  sku: string;
  productSlug: string;
  productName: string;
  variantName: string;
  imageUrl: string | null;
  uom: string;
  quantity: number;
  pickupOnly: boolean;
  weightGrams: number;
  available: boolean;
  unitPrice: Money | null;
  retailUnitPrice: Money | null;
  lineTotal: Money | null;
  priceChanged: boolean;
  nextTier: { minQty: number; unitPrice: Money } | null;
}

export interface CartView {
  id: string;
  items: CartItem[];
  itemCount: number;
  couponCode: string | null;
  couponError: string | null;
  freeShipping: boolean;
  totals: { subtotalNet: Money; discountNet: Money; vat: Money; total: Money };
  issues: CartIssue[];
}

export interface PickupSlot {
  start: string;
  end: string;
  label: string;
}

export interface PickupBranch {
  id: string;
  code: string;
  name: string;
  emirate: Emirate;
  address: string;
  phone: string | null;
  slots: PickupSlot[];
}

export interface PaymentMethodOption {
  method: PaymentMethod;
  label: string;
  available: boolean;
  reason?: string;
}

export interface CheckoutQuote {
  deliveryMethod: DeliveryMethod;
  itemCount: number;
  weightKg: number;
  courier: {
    available: boolean;
    reason?: 'NO_ADDRESS' | 'EMIRATE_NOT_SERVED' | 'PICKUP_ONLY_ITEMS' | 'OVERWEIGHT';
    feeNetFils: number;
    etaDays: number;
    freeOverFils: number | null;
    fee: Money;
  };
  pickupBranches: PickupBranch[];
  couponCode: string | null;
  couponError: string | null;
  totals: { subtotalNet: Money; discountNet: Money; shippingNet: Money; vat: Money; total: Money };
  paymentMethods: PaymentMethodOption[];
  issues: CartIssue[];
  canPlace: boolean;
}

export interface PlaceOrderResult {
  orderId: string;
  orderNumber: string;
  trackingToken: string;
  total: Money;
  next: { type: 'confirmation' } | { type: 'redirect'; url: string };
}

export interface AddressInput {
  label?: string;
  fullName: string;
  phone: string;
  emirate: Emirate;
  area: string;
  street: string;
  building?: string;
  landmark?: string;
  lat?: number;
  lng?: number;
}

export interface PlaceOrderInput {
  deliveryMethod: DeliveryMethod;
  contact: { fullName: string; email: string; phone: string };
  address?: AddressInput;
  addressId?: string;
  saveAddress?: boolean;
  pickupBranchId?: string;
  pickupSlotStart?: string;
  paymentMethod: PaymentMethod;
  companyName?: string;
  trn?: string;
  notes?: string;
  expectedTotalFils?: number;
}

// ── orders ──

export interface OrderLineView {
  id: string;
  variantId: string | null;
  sku: string;
  name: string;
  uom: string;
  quantity: number;
  unitPrice: Money;
  unitNet: Money;
  lineTotal: Money;
  productSlug: string | null;
  imageUrl: string | null;
}

export interface OrderView {
  id: string;
  orderNumber: string;
  trackingToken: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  deliveryMethod: DeliveryMethod;
  placedAt: string | null;
  createdAt: string;
  contact: { fullName: string; email: string; phone: string };
  companyName: string | null;
  trn: string | null;
  shippingAddress: Record<string, string> | null;
  pickup: {
    branch: { name: string; address: string; phone: string | null };
    slotStart: string | null;
    slotEnd: string | null;
  } | null;
  lines: OrderLineView[];
  totals: { subtotalNet: Money; discountNet: Money; shippingNet: Money; vat: Money; total: Money };
  couponCode: string | null;
  notes: string | null;
  shipments: { courier: string; trackingNumber: string | null; trackingUrl: string | null; status: string; createdAt: string }[];
  timeline: { status: OrderStatus; note: string | null; at: string }[];
  invoice: { number: string; issuedAt: string } | null;
}

export interface OrderSummary {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  deliveryMethod: DeliveryMethod;
  placedAt: string | null;
  itemCount: number;
  total: Money;
}

// ── account ──

export interface Customer {
  id: string;
  email: string;
  phone: string | null;
  firstName: string;
  lastName: string;
  companyName: string | null;
  trn: string | null;
  type: CustomerType;
  tradeStatus: TradeStatus;
}

export interface Address {
  id: string;
  customerId: string;
  label: string | null;
  fullName: string;
  phone: string;
  emirate: Emirate;
  area: string;
  street: string;
  building: string | null;
  landmark: string | null;
  lat: number | null;
  lng: number | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectListSummary {
  id: string;
  name: string;
  isWishlist: boolean;
  itemCount: number;
  updatedAt: string;
}

export interface ProjectListDetail {
  id: string;
  name: string;
  isWishlist: boolean;
  items: {
    id: string;
    variantId: string;
    sku: string;
    productSlug: string;
    productName: string;
    variantName: string;
    imageUrl: string | null;
    uom: string;
    quantity: number;
    available: boolean;
    unitPrice: Money | null;
    lineTotal: Money | null;
  }[];
}

export interface AddedToCart {
  added: string[];
  skipped: string[];
}

// ── content ──

export interface Banner {
  id: string;
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
  linkUrl: string | null;
  ctaLabel: string | null;
}

export interface HomeData {
  hero: Banner[];
  strip: Banner[];
  categories: { slug: string; name: string; imageUrl: string | null; children: Crumb[] }[];
  featuredBrands: BrandSummary[];
  bestSellers: ProductCard[];
  newArrivals: ProductCard[];
}

export interface Page {
  id: string;
  slug: string;
  title: string;
  body: string;
  kind: string;
  excerpt: string | null;
  coverImageUrl: string | null;
  published: boolean;
  publishedAt: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BlogList {
  total: number;
  page: number;
  items: { slug: string; title: string; excerpt: string | null; coverImageUrl: string | null; publishedAt: string | null }[];
}

export interface Branch {
  code: string;
  name: string;
  emirate: Emirate;
  address: string;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  openingHours: unknown;
  pickupEnabled: boolean;
}

export interface StoreInfo {
  name: string;
  legalName: string;
  trn: string;
  address: string;
  phone: string;
  email: string;
  whatsapp: string;
  cod: { enabled: boolean; maxFils: number };
}
