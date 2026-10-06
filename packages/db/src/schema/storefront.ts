import type {
  BannerPlacement,
  CartStatus,
  CouponType,
  DeliveryMethod,
  Emirate,
  ProductLinkKind,
  StockAlertStatus,
  StorefrontPageKind,
  StorefrontSettings,
  TradeStatus,
  WebOrderStatus,
  WebPaymentMethod,
  WebPaymentStatus,
  WebQuoteStatus,
} from "@devsfleet/shared-types";
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { productVariants, products, units } from "./catalog.js";
import { customers } from "./partners.js";
import { orders } from "./sales.js";
import { activeFlag, money, percent, primaryId, quantity, timestamps } from "./_shared.js";
import { branches, tenantScope } from "./tenants.js";

/**
 * ONLINE STORE
 *
 * A sales channel on the same rows the POS uses — not a copy of them. There is
 * no product, price, stock or order table here: a web order IS an `orders` row
 * (source "web"), its lines price through PriceResolverService and total
 * through calculateDocument, and confirming it reserves the same stock a
 * counter sale would draw on. That is what makes overselling a transaction
 * problem rather than a sync problem.
 *
 * What does live here is what only a shop window needs: the domain it answers
 * on, which products are listed and how they are presented, the shopper's
 * login, cart and addresses, and the delivery/payment side of an order.
 */

export const storefronts = pgTable(
  "storefronts",
  {
    id: primaryId(),
    ...tenantScope(),
    name: varchar({ length: 255 }).notNull(),
    settings: jsonb().$type<Partial<StorefrontSettings>>().notNull().default({}),
    ...activeFlag(),
    ...timestamps(),
  },
  // One per tenant for now. A second brand on one tenant is a real request
  // some day; until then every "this tenant's store" lookup stays one row.
  (t) => [uniqueIndex("uq_storefronts_tenant").on(t.tenantId)],
);

/**
 * The hostnames a storefront answers on.
 *
 * Unique ACROSS tenants — this is the lookup that turns an anonymous request
 * into a tenant, so two tenants claiming one host would make it a guess. The
 * lookup runs before there is any tenant context, through runAsPlatformAdmin,
 * exactly like resolving a WhatsApp phone number id.
 */
export const storefrontDomains = pgTable(
  "storefront_domains",
  {
    id: primaryId(),
    ...tenantScope(),
    storefrontId: uuid()
      .notNull()
      .references(() => storefronts.id, { onDelete: "cascade" }),
    /** Lowercase, no scheme, no port: "shop.al-lahiq.ae". */
    domain: varchar({ length: 255 }).notNull(),
    isPrimary: boolean().notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("uq_storefront_domains_domain").on(t.domain),
    index("idx_storefront_domains_storefront").on(t.storefrontId),
    check("ck_storefront_domains_lowercase", sql`domain = lower(domain)`),
  ],
);

/**
 * How a product is presented online. 1:1 with `products`, and a separate
 * table on purpose: none of it is something a till needs, so it stays out of
 * the POS sync payload, and a product with no row here is simply not listed.
 */
export const productListings = pgTable(
  "product_listings",
  {
    id: primaryId(),
    ...tenantScope(),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    slug: varchar({ length: 255 }).notNull(),
    isPublished: boolean().notNull().default(false),
    isFeatured: boolean().notNull().default(false),
    /** Cement, rebar, large sheets: collected in store, never couriered. */
    pickupOnly: boolean().notNull().default(false),
    seoTitle: varchar({ length: 255 }),
    seoDescription: varchar({ length: 500 }),
    /** Display spec table: [{ label: "Material", value: "Brass" }]. */
    specs: jsonb().$type<{ label: string; value: string }[]>().notNull().default([]),
    /** Datasheets and manuals: [{ title, url, kind }]. */
    documents: jsonb().$type<{ title: string; url: string; kind: string }[]>().notNull().default([]),
    publishedAt: timestamp({ withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("uq_product_listings_product").on(t.productId),
    uniqueIndex("uq_product_listings_tenant_slug").on(t.tenantId, t.slug),
    index("idx_product_listings_published").on(t.tenantId, t.isPublished),
  ],
);

/** "Frequently bought together", related and alternative products. */
export const productLinks = pgTable(
  "product_links",
  {
    id: primaryId(),
    ...tenantScope(),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    linkedProductId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    kind: varchar({ length: 20 }).$type<ProductLinkKind>().notNull(),
    sortOrder: integer().notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("uq_product_links").on(t.productId, t.linkedProductId, t.kind),
    check("ck_product_links_not_self", sql`product_id <> linked_product_id`),
  ],
);

/** CMS pages and blog posts. Body is markdown. */
export const storefrontPages = pgTable(
  "storefront_pages",
  {
    id: primaryId(),
    ...tenantScope(),
    slug: varchar({ length: 255 }).notNull(),
    title: varchar({ length: 255 }).notNull(),
    body: text().notNull().default(""),
    kind: varchar({ length: 10 }).$type<StorefrontPageKind>().notNull().default("page"),
    excerpt: varchar({ length: 500 }),
    coverImageUrl: varchar({ length: 500 }),
    isPublished: boolean().notNull().default(false),
    publishedAt: timestamp({ withTimezone: true, mode: "date" }),
    seoTitle: varchar({ length: 255 }),
    seoDescription: varchar({ length: 500 }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("uq_storefront_pages_tenant_slug").on(t.tenantId, t.slug),
    index("idx_storefront_pages_kind").on(t.tenantId, t.kind, t.isPublished),
  ],
);

export const storefrontBanners = pgTable(
  "storefront_banners",
  {
    id: primaryId(),
    ...tenantScope(),
    placement: varchar({ length: 20 }).$type<BannerPlacement>().notNull().default("home_hero"),
    title: varchar({ length: 255 }).notNull(),
    subtitle: varchar({ length: 500 }),
    imageUrl: varchar({ length: 500 }),
    linkUrl: varchar({ length: 500 }),
    ctaLabel: varchar({ length: 50 }),
    sortOrder: integer().notNull().default(0),
    startsAt: timestamp({ withTimezone: true, mode: "date" }),
    endsAt: timestamp({ withTimezone: true, mode: "date" }),
    ...activeFlag(),
    ...timestamps(),
  },
  (t) => [index("idx_storefront_banners_placement").on(t.tenantId, t.placement, t.sortOrder)],
);

/** Searches, kept so "what did people look for and not find" is answerable. */
export const storefrontSearchLogs = pgTable(
  "storefront_search_logs",
  {
    id: primaryId(),
    ...tenantScope(),
    term: varchar({ length: 120 }).notNull(),
    results: integer().notNull(),
    createdAt: timestamp({ withTimezone: true, mode: "date" }).notNull().default(sql`now()`),
  },
  (t) => [index("idx_storefront_search_logs_created").on(t.tenantId, t.createdAt)],
);

// -----------------------------------------------------------------------------
// Shoppers
// -----------------------------------------------------------------------------

/**
 * A shopper's login. Every account is backed by a `customers` row, so a web
 * customer is the same person the counter and the WhatsApp bot see — same
 * price list, same credit, same history.
 *
 * Deliberately not `users`: those are staff, carry permissions and ABAC
 * claims, and sign tokens the staff guard accepts. A shopper token is signed
 * with a different key and can never pass that guard.
 */
export const shopperAccounts = pgTable(
  "shopper_accounts",
  {
    id: primaryId(),
    ...tenantScope(),
    customerId: uuid()
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    /** Stored lowercase. */
    email: varchar({ length: 255 }).notNull(),
    passwordHash: varchar({ length: 255 }).notNull(),
    firstName: varchar({ length: 100 }).notNull(),
    lastName: varchar({ length: 100 }).notNull(),
    phone: varchar({ length: 20 }),
    companyName: varchar({ length: 255 }),
    trn: varchar({ length: 20 }),
    /** A trade application. Approval assigns the customer a price list in the admin panel. */
    tradeStatus: varchar({ length: 10 }).$type<TradeStatus>().notNull().default("none"),
    tradeNote: text(),
    lastLoginAt: timestamp({ withTimezone: true, mode: "date" }),
    ...activeFlag(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("uq_shopper_accounts_tenant_email").on(t.tenantId, t.email),
    uniqueIndex("uq_shopper_accounts_customer").on(t.customerId),
    check("ck_shopper_accounts_email_lowercase", sql`email = lower(email)`),
  ],
);

/**
 * Refresh tokens, rotated on every use. Presenting one that was already
 * rotated revokes its whole family: somebody else has a copy.
 */
export const shopperSessions = pgTable(
  "shopper_sessions",
  {
    id: primaryId(),
    ...tenantScope(),
    accountId: uuid()
      .notNull()
      .references(() => shopperAccounts.id, { onDelete: "cascade" }),
    familyId: uuid().notNull(),
    /** SHA-256 of the token. The token itself is never stored. */
    tokenHash: varchar({ length: 64 }).notNull(),
    expiresAt: timestamp({ withTimezone: true, mode: "date" }).notNull(),
    revokedAt: timestamp({ withTimezone: true, mode: "date" }),
    createdAt: timestamp({ withTimezone: true, mode: "date" }).notNull().default(sql`now()`),
  },
  (t) => [
    uniqueIndex("uq_shopper_sessions_token").on(t.tokenHash),
    index("idx_shopper_sessions_family").on(t.familyId),
  ],
);

export const shopperAddresses = pgTable(
  "shopper_addresses",
  {
    id: primaryId(),
    ...tenantScope(),
    accountId: uuid()
      .notNull()
      .references(() => shopperAccounts.id, { onDelete: "cascade" }),
    label: varchar({ length: 100 }),
    fullName: varchar({ length: 255 }).notNull(),
    phone: varchar({ length: 20 }).notNull(),
    emirate: varchar({ length: 20 }).$type<Emirate>().notNull(),
    area: varchar({ length: 255 }).notNull(),
    street: varchar({ length: 255 }).notNull(),
    building: varchar({ length: 255 }),
    landmark: varchar({ length: 255 }),
    /** Map pin. Text, not float: a coordinate is an identifier, not a quantity. */
    lat: varchar({ length: 20 }),
    lng: varchar({ length: 20 }),
    isDefault: boolean().notNull().default(false),
    ...timestamps(),
  },
  (t) => [index("idx_shopper_addresses_account").on(t.accountId)],
);

/** Wishlist and project lists ("Villa bathroom"). */
export const shopperLists = pgTable(
  "shopper_lists",
  {
    id: primaryId(),
    ...tenantScope(),
    accountId: uuid()
      .notNull()
      .references(() => shopperAccounts.id, { onDelete: "cascade" }),
    name: varchar({ length: 100 }).notNull(),
    isWishlist: boolean().notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    index("idx_shopper_lists_account").on(t.accountId),
    uniqueIndex("uq_shopper_lists_wishlist").on(t.accountId).where(sql`is_wishlist = true`),
  ],
);

export const shopperListItems = pgTable(
  "shopper_list_items",
  {
    id: primaryId(),
    ...tenantScope(),
    listId: uuid()
      .notNull()
      .references(() => shopperLists.id, { onDelete: "cascade" }),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    unitId: uuid()
      .notNull()
      .references(() => units.id, { onDelete: "restrict" }),
    quantity: quantity().notNull().default("1"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("uq_shopper_list_items").on(t.listId, t.variantId, t.unitId)],
);

// -----------------------------------------------------------------------------
// Cart
// -----------------------------------------------------------------------------

/**
 * A guest cart is identified by its id, held in an httpOnly cookie. Logging
 * in merges it into the account's cart rather than replacing either.
 */
export const carts = pgTable(
  "carts",
  {
    id: primaryId(),
    ...tenantScope(),
    accountId: uuid().references(() => shopperAccounts.id, { onDelete: "set null" }),
    status: varchar({ length: 10 }).$type<CartStatus>().notNull().default("active"),
    couponCode: varchar({ length: 40 }),
    convertedOrderId: uuid().references(() => orders.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    index("idx_carts_account").on(t.accountId, t.status),
    index("idx_carts_updated").on(t.tenantId, t.status, t.updatedAt),
  ],
);

export const cartItems = pgTable(
  "cart_items",
  {
    id: primaryId(),
    ...tenantScope(),
    cartId: uuid()
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    /** The packaging being bought. The product's base unit when sold loose. */
    unitId: uuid()
      .notNull()
      .references(() => units.id, { onDelete: "restrict" }),
    quantity: quantity().notNull(),
    /**
     * The unit price shown when it went in. Checkout compares it against
     * today's resolved price, so a change is surfaced before payment rather
     * than noticed on the receipt.
     */
    seenUnitPrice: money(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("uq_cart_items").on(t.cartId, t.variantId, t.unitId),
    check("ck_cart_items_quantity_positive", sql`quantity > 0`),
  ],
);

export const coupons = pgTable(
  "coupons",
  {
    id: primaryId(),
    ...tenantScope(),
    /** Stored uppercase; matched case-insensitively. */
    code: varchar({ length: 40 }).notNull(),
    type: varchar({ length: 20 }).$type<CouponType>().notNull(),
    /** Percent (0-100) for `percent`, an amount for `fixed`, unused for `free_shipping`. */
    value: money().notNull().default("0"),
    /** Net subtotal the cart must reach. */
    minSubtotal: money().notNull().default("0"),
    maxUses: integer(),
    usedCount: integer().notNull().default(0),
    validFrom: timestamp({ withTimezone: true, mode: "date" }),
    validTo: timestamp({ withTimezone: true, mode: "date" }),
    ...activeFlag(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("uq_coupons_tenant_code").on(t.tenantId, t.code),
    check("ck_coupons_code_uppercase", sql`code = upper(code)`),
  ],
);

// -----------------------------------------------------------------------------
// Web orders
// -----------------------------------------------------------------------------

/**
 * The shopper's side of an `orders` row. 1:1, keyed on the order.
 *
 * The order itself — lines, prices, VAT, totals, the stock it holds — is the
 * POS's own document. This row adds who to deliver to, how they paid, and the
 * status the tracking page shows.
 */
export const webOrders = pgTable(
  "web_orders",
  {
    orderId: uuid()
      .primaryKey()
      .references(() => orders.id, { onDelete: "cascade" }),
    ...tenantScope(),
    storefrontId: uuid()
      .notNull()
      .references(() => storefronts.id, { onDelete: "restrict" }),
    accountId: uuid().references(() => shopperAccounts.id, { onDelete: "set null" }),
    /** Unguessable. A guest's only key to their own order. */
    trackingToken: uuid().notNull().defaultRandom(),
    /**
     * Minted by the browser per checkout attempt. A double click or a retry
     * after a timeout lands on the order already placed instead of a second
     * one — rule 6, for a browser instead of a till.
     */
    idempotencyKey: uuid().notNull(),
    status: varchar({ length: 20 }).$type<WebOrderStatus>().notNull(),
    paymentMethod: varchar({ length: 20 }).$type<WebPaymentMethod>().notNull(),
    paymentStatus: varchar({ length: 20 }).$type<WebPaymentStatus>().notNull().default("pending"),
    deliveryMethod: varchar({ length: 10 }).$type<DeliveryMethod>().notNull(),
    contactName: varchar({ length: 255 }).notNull(),
    contactEmail: varchar({ length: 255 }).notNull(),
    contactPhone: varchar({ length: 20 }).notNull(),
    companyName: varchar({ length: 255 }),
    trn: varchar({ length: 20 }),
    /** Snapshot at the time of the order — editing the saved address later must not move a parcel. */
    shippingAddress: jsonb().$type<Record<string, string>>(),
    pickupBranchId: uuid().references(() => branches.id, { onDelete: "restrict" }),
    pickupSlotStart: timestamp({ withTimezone: true, mode: "date" }),
    pickupSlotEnd: timestamp({ withTimezone: true, mode: "date" }),
    couponCode: varchar({ length: 40 }),
    /** Delivery fee, net. Also present as a line on the order, where it is taxed. */
    shippingAmount: money().notNull().default("0"),
    weightKg: quantity().notNull().default("0"),
    placedAt: timestamp({ withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("uq_web_orders_tracking").on(t.trackingToken),
    uniqueIndex("uq_web_orders_idempotency").on(t.tenantId, t.idempotencyKey),
    index("idx_web_orders_account").on(t.accountId, t.createdAt),
    index("idx_web_orders_status").on(t.tenantId, t.status, t.createdAt),
  ],
);

/** The tracking page's timeline. Written alongside every status change. */
export const webOrderEvents = pgTable(
  "web_order_events",
  {
    id: primaryId(),
    ...tenantScope(),
    orderId: uuid()
      .notNull()
      .references(() => webOrders.orderId, { onDelete: "cascade" }),
    status: varchar({ length: 20 }).$type<WebOrderStatus>().notNull(),
    note: text(),
    /** Staff member, or null for the system / the shopper. */
    actorId: uuid().references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true, mode: "date" }).notNull().default(sql`now()`),
  },
  (t) => [index("idx_web_order_events_order").on(t.orderId, t.createdAt)],
);

/**
 * Online payment attempts. The provider's reference is unique per provider,
 * so a webhook delivered twice updates one row.
 */
export const webPayments = pgTable(
  "web_payments",
  {
    id: primaryId(),
    ...tenantScope(),
    orderId: uuid()
      .notNull()
      .references(() => webOrders.orderId, { onDelete: "cascade" }),
    provider: varchar({ length: 30 }).notNull(),
    providerRef: varchar({ length: 255 }),
    method: varchar({ length: 20 }).$type<WebPaymentMethod>().notNull(),
    amount: money().notNull(),
    status: varchar({ length: 20 }).$type<WebPaymentStatus>().notNull(),
    raw: jsonb(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("uq_web_payments_provider_ref").on(t.provider, t.providerRef),
    index("idx_web_payments_order").on(t.orderId),
  ],
);

export const webShipments = pgTable(
  "web_shipments",
  {
    id: primaryId(),
    ...tenantScope(),
    orderId: uuid()
      .notNull()
      .references(() => webOrders.orderId, { onDelete: "cascade" }),
    courier: varchar({ length: 100 }).notNull(),
    trackingNumber: varchar({ length: 100 }),
    trackingUrl: varchar({ length: 500 }),
    status: varchar({ length: 30 }).notNull().default("created"),
    ...timestamps(),
  },
  (t) => [index("idx_web_shipments_order").on(t.orderId)],
);

/**
 * A tenant's own card gateway account. A row per tenant, never an env var: on
 * a platform, one key would put every shop's takings into one merchant
 * account.
 *
 * Stripe calls back at `/storefront/payments/stripe/webhook/:id`, and that id
 * is how a webhook — which carries no storefront host — finds its tenant
 * before any tenant context exists, through runAsPlatformAdmin, exactly like a
 * WhatsApp phone number id.
 *
 * SECRETS ARE STORED IN PLAINTEXT — the same known, deliberate gap as
 * `whatsapp_accounts`, closed by the same future envelope-encryption work.
 */
export const storefrontPaymentAccounts = pgTable(
  "storefront_payment_accounts",
  {
    id: primaryId(),
    ...tenantScope(),
    provider: varchar({ length: 30 }).notNull(),
    secretKey: text().notNull(),
    webhookSecret: text().notNull(),
    ...activeFlag(),
    ...timestamps(),
  },
  (t) => [uniqueIndex("uq_storefront_payment_accounts_provider").on(t.tenantId, t.provider)],
);

// -----------------------------------------------------------------------------
// Back-in-stock alerts
// -----------------------------------------------------------------------------

/**
 * "Tell me when this is back." Variant-level, because stock is: a shopper
 * waiting for the 20 mm elbow is not waiting for the 25 mm one.
 *
 * Unique on (tenant, variant, email) with the email stored lowercase, so a
 * repeated tap is the same row and the endpoint can answer identically whether
 * or not the address was already here — nothing to enumerate.
 */
export const stockAlertSubscriptions = pgTable(
  "stock_alert_subscriptions",
  {
    id: primaryId(),
    ...tenantScope(),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    /** Stored lowercase. */
    email: varchar({ length: 255 }).notNull(),
    phone: varchar({ length: 20 }),
    accountId: uuid().references(() => shopperAccounts.id, { onDelete: "set null" }),
    status: varchar({ length: 10 }).$type<StockAlertStatus>().notNull().default("pending"),
    /** When the product came back and the alert fired. */
    notifiedAt: timestamp({ withTimezone: true, mode: "date" }),
    /** When a message actually reached the shopper. Null until a transport exists to send one. */
    deliveredAt: timestamp({ withTimezone: true, mode: "date" }),
    /** Unguessable. The one-click unsubscribe link carries only this. */
    unsubscribeToken: uuid().notNull().defaultRandom(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("uq_stock_alerts_variant_email").on(t.tenantId, t.variantId, t.email),
    uniqueIndex("uq_stock_alerts_token").on(t.unsubscribeToken),
    index("idx_stock_alerts_pending").on(t.tenantId, t.status, t.productId),
    check("ck_stock_alerts_email_lowercase", sql`email = lower(email)`),
  ],
);

// -----------------------------------------------------------------------------
// Quotes (trade)
// -----------------------------------------------------------------------------

/**
 * A request for a price, from a cart. A document, so it snapshots what it
 * needs (rule 5): the lines below carry the product's name, SKU, VAT rate and
 * the price as they were. Renaming a product or moving its VAT must not
 * rewrite a quote a contractor is about to accept.
 *
 * Totals are the document's, from calculateDocument. While `requested` they
 * are an ESTIMATE at list price; staff pricing the lines replaces them.
 *
 * Accepting a quote does not place an order: stock reservation and payment
 * are the checkout's job. `convertedOrderId` is where staff link the order
 * they raise from an accepted quote.
 */
export const webQuotes = pgTable(
  "web_quotes",
  {
    id: primaryId(),
    ...tenantScope(),
    /** QT-WEB-2026-000012 — a label, not an identifier. */
    number: varchar({ length: 30 }).notNull(),
    accountId: uuid().references(() => shopperAccounts.id, { onDelete: "set null" }),
    /** Minted by the browser per submission; a retry returns the quote already created. */
    clientId: uuid().notNull(),
    status: varchar({ length: 10 }).$type<WebQuoteStatus>().notNull().default("requested"),
    contactName: varchar({ length: 255 }).notNull(),
    contactEmail: varchar({ length: 255 }).notNull(),
    contactPhone: varchar({ length: 20 }).notNull(),
    companyName: varchar({ length: 255 }),
    /** What the shopper wrote. */
    notes: text(),
    /** Visible to staff only. */
    staffNotes: text(),
    currency: varchar({ length: 3 }).notNull(),
    /** Snapshot: how this document's unit prices relate to VAT. */
    taxMode: varchar({ length: 10 }).notNull(),
    /** Staff may give one document-level percentage off. */
    discountPercent: percent().notNull().default("0"),
    subtotal: money().notNull().default("0"),
    discountAmount: money().notNull().default("0"),
    taxAmount: money().notNull().default("0"),
    total: money().notNull().default("0"),
    requestedAt: timestamp({ withTimezone: true, mode: "date" }).notNull().default(sql`now()`),
    quotedAt: timestamp({ withTimezone: true, mode: "date" }),
    quotedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    validUntil: timestamp({ withTimezone: true, mode: "date" }),
    /** When the shopper accepted or declined. */
    respondedAt: timestamp({ withTimezone: true, mode: "date" }),
    convertedOrderId: uuid().references(() => orders.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("uq_web_quotes_tenant_number").on(t.tenantId, t.number),
    uniqueIndex("uq_web_quotes_client").on(t.tenantId, t.clientId),
    index("idx_web_quotes_account").on(t.accountId, t.createdAt),
    index("idx_web_quotes_status").on(t.tenantId, t.status, t.createdAt),
  ],
);

export const webQuoteItems = pgTable(
  "web_quote_items",
  {
    id: primaryId(),
    ...tenantScope(),
    quoteId: uuid()
      .notNull()
      .references(() => webQuotes.id, { onDelete: "cascade" }),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    unitId: uuid()
      .notNull()
      .references(() => units.id, { onDelete: "restrict" }),
    sortOrder: integer().notNull().default(0),
    productName: varchar({ length: 255 }).notNull(),
    variantName: varchar({ length: 255 }),
    productSku: varchar({ length: 100 }).notNull(),
    uom: varchar({ length: 20 }).notNull(),
    taxPercent: percent().notNull(),
    quantity: quantity().notNull(),
    /** The list price when it was requested, in the document's tax mode. An estimate. */
    unitPrice: money().notNull(),
    /** Set by staff. Null until the line is priced; the shopper can never write it. */
    quotedUnitPrice: money(),
    ...timestamps(),
  },
  (t) => [
    index("idx_web_quote_items_quote").on(t.quoteId, t.sortOrder),
    check("ck_web_quote_items_quantity_positive", sql`quantity > 0`),
  ],
);

// -----------------------------------------------------------------------------
// Relations
// -----------------------------------------------------------------------------

export const storefrontsRelations = relations(storefronts, ({ many }) => ({
  domains: many(storefrontDomains),
}));

export const storefrontDomainsRelations = relations(storefrontDomains, ({ one }) => ({
  storefront: one(storefronts, {
    fields: [storefrontDomains.storefrontId],
    references: [storefronts.id],
  }),
}));

export const productListingsRelations = relations(productListings, ({ one }) => ({
  product: one(products, { fields: [productListings.productId], references: [products.id] }),
}));

export const cartsRelations = relations(carts, ({ many }) => ({
  items: many(cartItems),
}));

export const cartItemsRelations = relations(cartItems, ({ one }) => ({
  cart: one(carts, { fields: [cartItems.cartId], references: [carts.id] }),
  variant: one(productVariants, { fields: [cartItems.variantId], references: [productVariants.id] }),
  unit: one(units, { fields: [cartItems.unitId], references: [units.id] }),
}));

export const shopperListsRelations = relations(shopperLists, ({ many }) => ({
  items: many(shopperListItems),
}));

export const shopperListItemsRelations = relations(shopperListItems, ({ one }) => ({
  list: one(shopperLists, { fields: [shopperListItems.listId], references: [shopperLists.id] }),
}));

export const webOrdersRelations = relations(webOrders, ({ one, many }) => ({
  order: one(orders, { fields: [webOrders.orderId], references: [orders.id] }),
  events: many(webOrderEvents),
  payments: many(webPayments),
  shipments: many(webShipments),
}));

export const webOrderEventsRelations = relations(webOrderEvents, ({ one }) => ({
  order: one(webOrders, { fields: [webOrderEvents.orderId], references: [webOrders.orderId] }),
}));

export const webPaymentsRelations = relations(webPayments, ({ one }) => ({
  order: one(webOrders, { fields: [webPayments.orderId], references: [webOrders.orderId] }),
}));

export const webQuotesRelations = relations(webQuotes, ({ many }) => ({
  items: many(webQuoteItems),
}));

export const webQuoteItemsRelations = relations(webQuoteItems, ({ one }) => ({
  quote: one(webQuotes, { fields: [webQuoteItems.quoteId], references: [webQuotes.id] }),
}));

export const webShipmentsRelations = relations(webShipments, ({ one }) => ({
  order: one(webOrders, { fields: [webShipments.orderId], references: [webOrders.orderId] }),
}));

export type Storefront = typeof storefronts.$inferSelect;
export type StorefrontDomain = typeof storefrontDomains.$inferSelect;
export type ProductListing = typeof productListings.$inferSelect;
export type NewProductListing = typeof productListings.$inferInsert;
export type ProductLink = typeof productLinks.$inferSelect;
export type StorefrontPage = typeof storefrontPages.$inferSelect;
export type StorefrontBanner = typeof storefrontBanners.$inferSelect;
export type ShopperAccount = typeof shopperAccounts.$inferSelect;
export type ShopperAddress = typeof shopperAddresses.$inferSelect;
export type Cart = typeof carts.$inferSelect;
export type CartItem = typeof cartItems.$inferSelect;
export type Coupon = typeof coupons.$inferSelect;
export type WebOrder = typeof webOrders.$inferSelect;
export type WebPayment = typeof webPayments.$inferSelect;
export type StockAlertSubscription = typeof stockAlertSubscriptions.$inferSelect;
export type WebQuote = typeof webQuotes.$inferSelect;
export type WebQuoteItem = typeof webQuoteItems.$inferSelect;
export type StorefrontPaymentAccount = typeof storefrontPaymentAccounts.$inferSelect;
