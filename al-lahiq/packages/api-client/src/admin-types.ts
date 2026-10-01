import type {
  CouponType,
  CustomerType,
  DeliveryMethod,
  Emirate,
  Money,
  OrderStatus,
  OrderView,
  PaymentMethod,
  PaymentStatus,
  PriceListType,
  ProductLinkKind,
  StaffRole,
  TradeStatus,
} from './types.ts';

export interface Staff {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
  active: boolean;
}

// ── catalog ──

export interface AdminProductRow {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  category: string | null;
  imageUrl: string | null;
  skus: string[];
  activeVariants: number;
  published: boolean;
  inStock: boolean;
  fromPrice: Money | null;
  missing: string[];
  updatedAt: string;
}

export interface AdminProductList {
  total: number;
  page: number;
  pageSize: number;
  items: AdminProductRow[];
}

export interface AdminVariant {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  options: unknown;
  baseUom: string;
  weightGrams: number;
  active: boolean;
  sortOrder: number;
  posVersion: number;
  uomConversions: { uom: string; factor: number }[];
  attributes: { attributeId: string; code: string; name: string; value: string }[];
  prices: {
    uom: string;
    unit: Money;
    unitNet: Money;
    priceListCode: string;
    tiers: { minQty: number; unitNet: Money }[];
  }[];
  available: number;
  stock: { branch: string; code: string; quantity: number; updatedAt: string }[];
}

export interface AdminProductDetail {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  brandId: string | null;
  categoryId: string | null;
  vatClass: 'STANDARD_5' | 'ZERO' | 'EXEMPT';
  posGroupCode: string | null;
  pickupOnly: boolean;
  published: boolean;
  featured: boolean;
  fromNetPriceFils: number | null;
  inStock: boolean;
  specs: unknown;
  seoTitle: string | null;
  seoDescription: string | null;
  createdAt: string;
  updatedAt: string;
  brand: { id: string; name: string; slug: string } | null;
  category: { id: string; name: string; slug: string } | null;
  images: { id: string; url: string; alt: string | null; sortOrder: number }[];
  documents: { id: string; title: string; url: string; kind: string }[];
  links: { fromId: string; toId: string; kind: ProductLinkKind; sortOrder: number; to: { id: string; name: string; slug: string } }[];
  variants: AdminVariant[];
}

export interface AdminCategory {
  id: string;
  parentId: string | null;
  slug: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  sortOrder: number;
  active: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  _count: { products: number; children: number };
}

export interface AdminBrand {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  description: string | null;
  featured: boolean;
  active: boolean;
  _count: { products: number };
}

export interface AdminAttribute {
  id: string;
  code: string;
  name: string;
  unit: string | null;
  filterable: boolean;
  sortOrder: number;
}

export interface UploadResult {
  url: string;
  contentType: string;
  size: number;
}

// ── orders ──

export interface AdminOrderRow {
  id: string;
  orderNumber: string;
  createdAt: string;
  placedAt: string | null;
  fullName: string;
  phone: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  deliveryMethod: DeliveryMethod;
  emirate: Emirate | null;
  pickupBranch: string | null;
  pickupSlotStart: string | null;
  itemCount: number;
  total: Money;
}

export interface AdminOrderList {
  total: number;
  page: number;
  pageSize: number;
  statusCounts: Partial<Record<OrderStatus, number>>;
  items: AdminOrderRow[];
}

export interface AdminOrderView extends Omit<OrderView, 'timeline' | 'lines'> {
  timeline: { status: OrderStatus; note: string | null; actor: string | null; at: string }[];
  lines: (OrderView['lines'][number] & { priceListCode: string | null; priceVersion: number | null; retailUnitNet: Money })[];
  nextStatuses: OrderStatus[];
}

// ── customers ──

export interface AdminCustomerRow {
  id: string;
  email: string;
  phone: string | null;
  firstName: string;
  lastName: string;
  companyName: string | null;
  trn: string | null;
  type: CustomerType;
  tradeStatus: TradeStatus;
  createdAt: string;
  orderCount: number;
}

export interface AdminCustomerList {
  total: number;
  page: number;
  pageSize: number;
  items: AdminCustomerRow[];
}

export interface AdminCustomerDetail {
  id: string;
  email: string;
  phone: string | null;
  firstName: string;
  lastName: string;
  companyName: string | null;
  trn: string | null;
  type: CustomerType;
  tradeStatus: TradeStatus;
  posCustomerCode: string | null;
  createdAt: string;
  priceLists: { code: string; name: string; type: PriceListType }[];
  addresses: {
    id: string;
    label: string | null;
    fullName: string;
    phone: string;
    emirate: Emirate;
    area: string;
    street: string;
    building: string | null;
    isDefault: boolean;
  }[];
  totalSpent: Money;
  orders: { id: string; orderNumber: string; status: OrderStatus; createdAt: string; total: Money }[];
}

// ── content ──

export interface AdminPageRow {
  id: string;
  slug: string;
  title: string;
  kind: string;
  published: boolean;
  publishedAt: string | null;
  updatedAt: string;
}

export interface AdminBanner {
  id: string;
  placement: string;
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
  linkUrl: string | null;
  ctaLabel: string | null;
  sortOrder: number;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── settings ──

export interface Settings {
  store: { name: string; legalName: string; trn: string; address: string; phone: string; email: string; whatsapp: string };
  cod: { enabled: boolean; maxFils: number };
  stock: { safetyBuffer: number; fulfilmentBranchCode: string };
  pickup: { leadHours: number; slotMinutes: number; daysAhead: number; openHour: number; closeHour: number };
  search: { synonyms: string[][] };
}

export interface Coupon {
  id: string;
  code: string;
  type: CouponType;
  value: number;
  minSubtotalFils: number;
  maxUses: number | null;
  usedCount: number;
  validFrom: string | null;
  validTo: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ShippingRate {
  id: string;
  emirate: Emirate;
  baseFils: number;
  baseWeightKg: number;
  perKgFils: number;
  freeOverFils: number | null;
  maxWeightKg: number;
  etaDays: number;
  active: boolean;
  updatedAt: string;
}

export interface AdminBranch {
  id: string;
  code: string;
  name: string;
  emirate: Emirate;
  address: string;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  openingHours: unknown;
  pickupEnabled: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

// ── reports & sync ──

export interface Dashboard {
  days: number;
  totals: { orders: number; revenue: Money; vat: Money; averageOrder: Money };
  daily: { day: string; orders: number; revenue: Money }[];
  topProducts: { sku: string; name: string; quantity: number; revenue: Money }[];
  abandonedCarts: number;
  failedSearches: { term: string; count: number }[];
  ordersByStatus: Partial<Record<OrderStatus, number>>;
  pendingTradeApplications: number;
}

export type SyncRunStatus = 'RUNNING' | 'SUCCEEDED' | 'FAILED';
export type OutboxStatus = 'PENDING' | 'SENT' | 'FAILED' | 'DEAD';
export type InboundStatus = 'RECEIVED' | 'PROCESSED' | 'SKIPPED' | 'FAILED';

export interface SyncRun {
  id: string;
  kind: string;
  status: SyncRunStatus;
  summary: unknown;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface SyncStatus {
  lastEventAt: string | null;
  reconciliation: SyncRun[];
  outbox: Partial<Record<OutboxStatus, number>>;
  inboundLast24h: Partial<Record<InboundStatus, number>>;
  recentInboundFailures: { id: string; eventId: string; type: string; error: string | null; attempts: number; receivedAt: string }[];
}

export interface OutboxEvent {
  id: string;
  type: string;
  aggregateId: string;
  payload: unknown;
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string;
  createdAt: string;
  sentAt: string | null;
}

export interface InboundEvent {
  id: string;
  eventId: string;
  type: string;
  payload: unknown;
  status: InboundStatus;
  attempts: number;
  error: string | null;
  receivedAt: string;
  processedAt: string | null;
}
