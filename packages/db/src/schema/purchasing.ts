import type { Currency, PurchaseOrderStatus, TaxMode } from "@devsfleet/shared-types";
import { relations } from "drizzle-orm";
import {
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
import { money, percent, primaryId, quantity, timestamps } from "./_shared.js";
import { users } from "./auth.js";
import { productVariants, units } from "./catalog.js";
import { suppliers } from "./partners.js";
import { branches, tenantScope } from "./tenants.js";

/**
 * PURCHASING
 *
 * Purchase order -> goods receipt -> stock in.
 *
 * The receipt is a separate document from the order because deliveries arrive
 * short, split across days, or partly damaged. Stock moves on *receipt*, never
 * on order — otherwise a PO sent to a supplier who never ships would inflate
 * on-hand quantities.
 *
 * Each receipt also updates the branch's weighted-average cost, which is what
 * `sale_items.costPrice` snapshots from.
 */

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: primaryId(),
    ...tenantScope(),
    branchId: uuid()
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    poNumber: varchar({ length: 30 }).notNull(),
    supplierId: uuid()
      .notNull()
      .references(() => suppliers.id, { onDelete: "restrict" }),

    status: varchar({ length: 20 })
      .$type<PurchaseOrderStatus>()
      .notNull()
      .default("draft"),

    currency: varchar({ length: 3 }).$type<Currency>().notNull().default("AED"),
    exchangeRate: money().notNull().default("1"),
    taxMode: varchar({ length: 10 }).$type<TaxMode>().notNull().default("exclusive"),

    subtotal: money().notNull().default("0"),
    discountAmount: money().notNull().default("0"),
    taxAmount: money().notNull().default("0"),
    /** Freight, customs, handling. Spread across lines when computing landed cost. */
    shippingAmount: money().notNull().default("0"),
    total: money().notNull().default("0"),

    expectedDate: date({ mode: "string" }),
    sentAt: timestamp({ withTimezone: true, mode: "date" }),
    /** Supplier's own reference, for chasing a late delivery. */
    supplierReference: varchar({ length: 100 }),

    notes: text(),
    createdBy: uuid().references(() => users.id, { onDelete: "set null" }),
    approvedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("uq_purchase_orders_number").on(t.tenantId, t.poNumber),
    index("idx_po_supplier").on(t.supplierId, t.createdAt),
    index("idx_po_branch_status").on(t.branchId, t.status),
  ],
);

export const purchaseOrderItems = pgTable(
  "purchase_order_items",
  {
    id: primaryId(),
    ...tenantScope(),
    purchaseOrderId: uuid()
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    productName: varchar({ length: 500 }).notNull(),
    variantName: varchar({ length: 255 }).notNull().default("Default"),
    productSku: varchar({ length: 64 }).notNull(),

    unitId: uuid().references(() => units.id, { onDelete: "set null" }),
    unitConversionFactor: quantity().notNull().default("1"),

    quantity: quantity().notNull(),
    /** Running total across every receipt against this line. */
    receivedQuantity: quantity().notNull().default("0"),
    unitPrice: money().notNull(),
    discountPercent: percent().notNull().default("0"),
    taxPercent: percent().notNull().default("0"),
    taxAmount: money().notNull().default("0"),
    lineSubtotal: money().notNull().default("0"),
    total: money().notNull(),

    sortOrder: integer().notNull().default(0),
    notes: text(),
    ...timestamps(),
  },
  (t) => [index("idx_po_items_po").on(t.purchaseOrderId, t.sortOrder)],
);

export const goodsReceipts = pgTable(
  "goods_receipts",
  {
    id: primaryId(),
    ...tenantScope(),
    branchId: uuid()
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    /** NULL for a direct receipt with no prior PO — happens with cash purchases. */
    purchaseOrderId: uuid().references(() => purchaseOrders.id, { onDelete: "restrict" }),
    supplierId: uuid()
      .notNull()
      .references(() => suppliers.id, { onDelete: "restrict" }),
    grnNumber: varchar({ length: 30 }).notNull(),

    /** The supplier's delivery note / invoice number. */
    supplierInvoiceNumber: varchar({ length: 100 }),
    supplierInvoiceDate: date({ mode: "string" }),

    receivedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    receivedAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
    notes: text(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("uq_goods_receipts_number").on(t.tenantId, t.grnNumber),
    index("idx_grn_po").on(t.purchaseOrderId),
    index("idx_grn_branch_received").on(t.branchId, t.receivedAt),
  ],
);

export const goodsReceiptItems = pgTable(
  "goods_receipt_items",
  {
    id: primaryId(),
    ...tenantScope(),
    goodsReceiptId: uuid()
      .notNull()
      .references(() => goodsReceipts.id, { onDelete: "cascade" }),
    /** NULL on a direct receipt with no PO line to match against. */
    purchaseOrderItemId: uuid().references(() => purchaseOrderItems.id, {
      onDelete: "set null",
    }),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),

    quantity: quantity().notNull(),
    /**
     * Unit price including this line's share of shipping and duty.
     * This is what feeds `inventory.averageCost` — using the invoice price
     * alone systematically understates cost and overstates margin.
     */
    landedUnitCost: money(),
    /** Received but unsellable. Recorded, not added to sellable stock. */
    damagedQuantity: quantity().notNull().default("0"),
    batchNumber: varchar({ length: 50 }),
    expiryDate: date({ mode: "string" }),
    notes: text(),
    ...timestamps(),
  },
  (t) => [
    index("idx_grn_items_grn").on(t.goodsReceiptId),
    index("idx_grn_items_variant").on(t.variantId, t.createdAt),
  ],
);

export const purchaseOrdersRelations = relations(purchaseOrders, ({ one, many }) => ({
  supplier: one(suppliers, {
    fields: [purchaseOrders.supplierId],
    references: [suppliers.id],
  }),
  branch: one(branches, { fields: [purchaseOrders.branchId], references: [branches.id] }),
  items: many(purchaseOrderItems),
  receipts: many(goodsReceipts),
}));

export const purchaseOrderItemsRelations = relations(purchaseOrderItems, ({ one }) => ({
  purchaseOrder: one(purchaseOrders, {
    fields: [purchaseOrderItems.purchaseOrderId],
    references: [purchaseOrders.id],
  }),
  variant: one(productVariants, {
      fields: [purchaseOrderItems.variantId],
      references: [productVariants.id],
    }),
}));

export const goodsReceiptsRelations = relations(goodsReceipts, ({ one, many }) => ({
  purchaseOrder: one(purchaseOrders, {
    fields: [goodsReceipts.purchaseOrderId],
    references: [purchaseOrders.id],
  }),
  supplier: one(suppliers, {
    fields: [goodsReceipts.supplierId],
    references: [suppliers.id],
  }),
  items: many(goodsReceiptItems),
}));

export const goodsReceiptItemsRelations = relations(goodsReceiptItems, ({ one }) => ({
  goodsReceipt: one(goodsReceipts, {
    fields: [goodsReceiptItems.goodsReceiptId],
    references: [goodsReceipts.id],
  }),
  variant: one(productVariants, {
      fields: [goodsReceiptItems.variantId],
      references: [productVariants.id],
    }),
}));

export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type NewPurchaseOrder = typeof purchaseOrders.$inferInsert;
export type PurchaseOrderItem = typeof purchaseOrderItems.$inferSelect;
export type NewPurchaseOrderItem = typeof purchaseOrderItems.$inferInsert;
export type GoodsReceipt = typeof goodsReceipts.$inferSelect;
export type NewGoodsReceipt = typeof goodsReceipts.$inferInsert;
export type GoodsReceiptItem = typeof goodsReceiptItems.$inferSelect;
export type NewGoodsReceiptItem = typeof goodsReceiptItems.$inferInsert;
