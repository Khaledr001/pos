import type {
  Currency,
  DocumentSource,
  OrderStatus,
  QuotationStatus,
  SaleStatus,
  TaxMode,
} from "@devsfleet/shared-types";
import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { money, percent, primaryId, quantity, syncable, timestamps } from "./_shared.js";
import { users } from "./auth.js";
import { productVariants, units } from "./catalog.js";
import { customers } from "./partners.js";
import { cashSessions } from "./payments.js";
import { branches, branchScope, tenantScope } from "./tenants.js";

/**
 * QUOTATION -> ORDER -> SALE
 *
 * Three documents rather than one status column, because they are genuinely
 * different things:
 *
 *   quotation  a price offer. Reserves nothing until confirmed. Expires.
 *   order      a commitment. Reserves stock. Can be picked up over days.
 *   sale       money changed hands. Deducts stock. Immutable once completed.
 *
 * A walk-in POS sale skips straight to `sales`. A WhatsApp enquiry travels the
 * full path. Both end in the same table, so reporting never has to union.
 *
 * Every document snapshots its own currency, FX rate and tax mode. Restating a
 * two-year-old invoice must not depend on today's tenant settings.
 */

/** Fields every money document carries. Defined once so totals mean the same everywhere. */
const documentTotals = {
  currency: varchar({ length: 3 }).$type<Currency>().notNull().default("AED"),
  /** Rate to the tenant's base currency at issue time. 1 when they match. */
  exchangeRate: money().notNull().default("1"),
  taxMode: varchar({ length: 10 }).$type<TaxMode>().notNull().default("exclusive"),

  /** Sum of line nets, after all discounts, before tax. */
  subtotal: money().notNull().default("0"),
  discountAmount: money().notNull().default("0"),
  taxAmount: money().notNull().default("0"),
  /** subtotal + taxAmount. What the customer owes. */
  total: money().notNull().default("0"),
};

/** Fields every line item carries. */
const lineItemFields = {
  variantId: uuid()
    .notNull()
    .references(() => productVariants.id, { onDelete: "restrict" }),
  /**
   * Name, variant and SKU as they were when the document was issued.
   * A product renamed or re-SKU'd next year must not silently rewrite last
   * year's invoice.
   */
  productName: varchar({ length: 500 }).notNull(),
  variantName: varchar({ length: 255 }).notNull().default("Default"),
  productSku: varchar({ length: 64 }).notNull(),

  /** Packaging sold. NULL = the product's base unit. */
  unitId: uuid().references(() => units.id, { onDelete: "set null" }),
  /** Base units per sold unit, snapshotted. Box of 100 -> 100. */
  unitConversionFactor: quantity().notNull().default("1"),

  quantity: quantity().notNull(),
  unitPrice: money().notNull(),
  discountPercent: percent().notNull().default("0"),
  discountAmount: money().notNull().default("0"),
  /** Snapshotted, not read from tenant settings — VAT rates change. */
  taxPercent: percent().notNull().default("0"),
  taxAmount: money().notNull().default("0"),
  /** Line net after discount, before tax. */
  lineSubtotal: money().notNull().default("0"),
  /** lineSubtotal + taxAmount. */
  total: money().notNull(),

  sortOrder: integer().notNull().default(0),
  notes: text(),
};

// -----------------------------------------------------------------------------
// Quotations
// -----------------------------------------------------------------------------

export const quotations = pgTable(
  "quotations",
  {
    id: primaryId(),
    ...tenantScope(),
    ...branchScope(),
    quotationNumber: varchar({ length: 30 }).notNull(),
    customerId: uuid().references(() => customers.id, { onDelete: "restrict" }),

    source: varchar({ length: 20 }).$type<DocumentSource>().notNull().default("manual"),
    status: varchar({ length: 20 }).$type<QuotationStatus>().notNull().default("draft"),
    ...documentTotals,

    validUntil: date({ mode: "string" }),
    notes: text(),
    /** Terms printed on the PDF. Snapshotted from tenant settings at issue. */
    termsText: text(),
    pdfUrl: varchar({ length: 500 }),

    /** Set once converted. The order also points back, so either direction resolves. */
    convertedToOrderId: uuid(),
    convertedAt: timestamp({ withTimezone: true, mode: "date" }),
    sentAt: timestamp({ withTimezone: true, mode: "date" }),

    createdBy: uuid().references(() => users.id, { onDelete: "set null" }),
    /** Set when the WhatsApp AI built this quotation rather than a person. */
    conversationId: uuid(),
    ...syncable(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("uq_quotations_number").on(t.tenantId, t.quotationNumber),
    index("idx_quotations_customer").on(t.customerId, t.createdAt),
    index("idx_quotations_branch_status").on(t.branchId, t.status),
    index("idx_quotations_tenant_created").on(t.tenantId, t.createdAt),
  ],
);

export const quotationItems = pgTable(
  "quotation_items",
  {
    id: primaryId(),
    ...tenantScope(),
    quotationId: uuid()
      .notNull()
      .references(() => quotations.id, { onDelete: "cascade" }),
    ...lineItemFields,
    ...timestamps(),
  },
  (t) => [index("idx_quotation_items_quotation").on(t.quotationId, t.sortOrder)],
);

// -----------------------------------------------------------------------------
// Orders
// -----------------------------------------------------------------------------

export const orders = pgTable(
  "orders",
  {
    id: primaryId(),
    ...tenantScope(),
    ...branchScope(),
    orderNumber: varchar({ length: 30 }).notNull(),
    customerId: uuid().references(() => customers.id, { onDelete: "restrict" }),
    quotationId: uuid().references((): AnyPgColumn => quotations.id, {
      onDelete: "set null",
    }),

    source: varchar({ length: 20 }).$type<DocumentSource>().notNull(),
    status: varchar({ length: 20 }).$type<OrderStatus>().notNull().default("pending"),
    ...documentTotals,

    /** Set while status is pending/processing/ready; released on completion or cancel. */
    stockReserved: timestamp({ withTimezone: true, mode: "date" }),
    expectedReadyAt: timestamp({ withTimezone: true, mode: "date" }),
    completedAt: timestamp({ withTimezone: true, mode: "date" }),
    cancelledAt: timestamp({ withTimezone: true, mode: "date" }),
    cancellationReason: text(),

    notes: text(),
    createdBy: uuid().references(() => users.id, { onDelete: "set null" }),
    conversationId: uuid(),
    ...syncable(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("uq_orders_number").on(t.tenantId, t.orderNumber),
    index("idx_orders_customer").on(t.customerId, t.createdAt),
    index("idx_orders_branch_status").on(t.branchId, t.status),
    index("idx_orders_tenant_created").on(t.tenantId, t.createdAt),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: primaryId(),
    ...tenantScope(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    ...lineItemFields,
    /** Handed over so far. Supports collecting a large order across several visits. */
    fulfilledQuantity: quantity().notNull().default("0"),
    ...timestamps(),
  },
  (t) => [index("idx_order_items_order").on(t.orderId, t.sortOrder)],
);

// -----------------------------------------------------------------------------
// Sales
// -----------------------------------------------------------------------------

/**
 * The final transaction. Immutable once `completed`.
 *
 * A mistake is corrected by a return (a linked negative sale) or a void, never
 * by editing the row — every one of these is a tax document.
 */
export const sales = pgTable(
  "sales",
  {
    id: primaryId(),
    ...tenantScope(),
    ...branchScope(),
    /** Assigned by the server, even for a sale created offline. */
    saleNumber: varchar({ length: 30 }).notNull(),

    orderId: uuid().references(() => orders.id, { onDelete: "set null" }),
    customerId: uuid().references(() => customers.id, { onDelete: "restrict" }),
    cashSessionId: uuid().references(() => cashSessions.id, { onDelete: "set null" }),

    source: varchar({ length: 20 }).$type<DocumentSource>().notNull(),
    status: varchar({ length: 20 }).$type<SaleStatus>().notNull().default("completed"),
    ...documentTotals,

    /** Sum of `payments` rows. Below `total` on a credit sale. */
    paidAmount: money().notNull().default("0"),
    /** total - paidAmount. Non-zero means it went on the customer's account. */
    dueAmount: money().notNull().default("0"),

    /** Points at the original sale when this row is a return. */
    returnOfSaleId: uuid().references((): AnyPgColumn => sales.id, {
      onDelete: "restrict",
    }),
    voidedAt: timestamp({ withTimezone: true, mode: "date" }),
    voidedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    voidReason: text(),

    notes: text(),
    createdBy: uuid().references(() => users.id, { onDelete: "set null" }),

    /**
     * OFFLINE ORIGIN
     *
     * `localId` is minted on the terminal and is the idempotency key — the
     * server upserts on it, so a push retried after a timeout cannot create a
     * second invoice. `occurredAt` is the terminal's wall clock at the moment
     * of sale, which is what belongs on the receipt; `createdAt` is when the
     * server first saw it. On an offline sale these differ by hours.
     */
    ...syncable(),
    occurredAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
    /** true = the row arrived through the sync endpoint, not created online. */
    createdOffline: timestamp({ withTimezone: true, mode: "date" }),

    ...timestamps(),
  },
  (t) => [
    uniqueIndex("uq_sales_number").on(t.tenantId, t.saleNumber),
    index("idx_sales_branch_occurred").on(t.branchId, t.occurredAt),
    index("idx_sales_customer").on(t.customerId, t.occurredAt),
    index("idx_sales_tenant_occurred").on(t.tenantId, t.occurredAt),
    index("idx_sales_cash_session").on(t.cashSessionId),
    index("idx_sales_device").on(t.deviceId, t.occurredAt),
    /**
     * The offline idempotency key. Named explicitly rather than via
     * `.unique()` on the shared builder — see the note in _shared.ts.
     * Partial, because online sales carry no localId and NULLs would
     * otherwise all be distinct.
     */
    uniqueIndex("uq_sales_client")
      .on(t.localId)
      .where(sql`local_id IS NOT NULL`),
  ],
);

export const saleItems = pgTable(
  "sale_items",
  {
    id: primaryId(),
    ...tenantScope(),
    saleId: uuid()
      .notNull()
      .references(() => sales.id, { onDelete: "cascade" }),
    ...lineItemFields,

    /**
     * Weighted-average cost at the moment of sale.
     *
     * Snapshotted because margin reporting must not shift when the next
     * purchase order changes the average. Never shown to a user lacking
     * `report:financial`.
     */
    costPrice: money(),

    /** Set when a manager authorised selling below min_selling_price. */
    floorPriceOverriddenBy: uuid().references(() => users.id, { onDelete: "set null" }),

    /** Units returned so far. Caps how much of this line can still come back. */
    returnedQuantity: quantity().notNull().default("0"),

    /**
     * Set only on a RETURN's own line — never on the original sale it points
     * back to. "restock" moves the units back into sellable inventory
     * (StockService.addStock, referenceType "sale" — resolves to the
     * sale_return ledger type); "scrap" records that they came back damaged
     * and were written off, with no stock movement at all. Nullable because
     * an ordinary sale line has no disposition — it has not been returned.
     */
    returnDisposition: varchar({ length: 10 }).$type<"restock" | "scrap">(),
    ...timestamps(),
  },
  (t) => [
    index("idx_sale_items_sale").on(t.saleId, t.sortOrder),
    /** Product sales history — feeds the "what sells" report and reorder suggestions. */
    index("idx_sale_items_variant").on(t.variantId, t.createdAt),
  ],
);

export const quotationsRelations = relations(quotations, ({ one, many }) => ({
  customer: one(customers, { fields: [quotations.customerId], references: [customers.id] }),
  branch: one(branches, { fields: [quotations.branchId], references: [branches.id] }),
  items: many(quotationItems),
}));

export const quotationItemsRelations = relations(quotationItems, ({ one }) => ({
  quotation: one(quotations, {
    fields: [quotationItems.quotationId],
    references: [quotations.id],
  }),
  variant: one(productVariants, { fields: [quotationItems.variantId], references: [productVariants.id] }),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  customer: one(customers, { fields: [orders.customerId], references: [customers.id] }),
  branch: one(branches, { fields: [orders.branchId], references: [branches.id] }),
  quotation: one(quotations, { fields: [orders.quotationId], references: [quotations.id] }),
  items: many(orderItems),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  variant: one(productVariants, { fields: [orderItems.variantId], references: [productVariants.id] }),
}));

export const salesRelations = relations(sales, ({ one, many }) => ({
  customer: one(customers, { fields: [sales.customerId], references: [customers.id] }),
  branch: one(branches, { fields: [sales.branchId], references: [branches.id] }),
  order: one(orders, { fields: [sales.orderId], references: [orders.id] }),
  items: many(saleItems),
}));

export const saleItemsRelations = relations(saleItems, ({ one }) => ({
  sale: one(sales, { fields: [saleItems.saleId], references: [sales.id] }),
  variant: one(productVariants, { fields: [saleItems.variantId], references: [productVariants.id] }),
}));

export type Quotation = typeof quotations.$inferSelect;
export type NewQuotation = typeof quotations.$inferInsert;
export type QuotationItem = typeof quotationItems.$inferSelect;
export type NewQuotationItem = typeof quotationItems.$inferInsert;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type OrderItem = typeof orderItems.$inferSelect;
export type NewOrderItem = typeof orderItems.$inferInsert;
export type Sale = typeof sales.$inferSelect;
export type NewSale = typeof sales.$inferInsert;
export type SaleItem = typeof saleItems.$inferSelect;
export type NewSaleItem = typeof saleItems.$inferInsert;
