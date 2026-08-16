import type { InventoryTxType, TransferStatus } from "@devsfleet/shared-types";
import { relations, sql } from "drizzle-orm";
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { money, primaryId, quantity, timestamps } from "./_shared.js";
import { users } from "./auth.js";
import { productVariants } from "./catalog.js";
import { branches, tenantScope } from "./tenants.js";

/**
 * INVENTORY
 *
 * Two tables, and the split is the whole design:
 *
 *   inventory              — current balance per (product, branch). Mutable.
 *                            One row per pair, updated in place. Fast to read.
 *   inventory_transactions — append-only ledger of every movement. Immutable.
 *
 * The ledger is the truth; `inventory` is a materialised balance. Both are
 * written in the same transaction, and a nightly reconciliation replays the
 * ledger to catch drift. A mistake is corrected with a compensating
 * `adjustment` row — never by editing or deleting history, because an audit
 * that can be edited is not an audit.
 */

export const inventory = pgTable(
  "inventory",
  {
    id: primaryId(),
    ...tenantScope(),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    branchId: uuid()
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),

    /** On-hand in the product's base unit. May go negative when offline sales reconcile. */
    quantity: quantity().notNull().default("0"),
    /** Held by a confirmed quotation or an unfulfilled order. Not yet shipped. */
    reservedQuantity: quantity().notNull().default("0"),

    reorderLevel: quantity().notNull().default("0"),
    reorderQuantity: quantity().notNull().default("0"),

    /**
     * Weighted-average cost at this branch, recomputed on every goods receipt.
     * Used to snapshot `sale_items.costPrice` so margin survives later price
     * changes.
     */
    averageCost: money(),

    /** Physical location within the branch: aisle, rack, bin. */
    binLocation: varchar({ length: 50 }),
    lastCountedAt: timestamp({ withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("uq_inventory_variant_branch").on(t.variantId, t.branchId),
    index("idx_inventory_branch").on(t.branchId),
    index("idx_inventory_updated").on(t.tenantId, t.updatedAt),
    /** Low-stock report: available (quantity - reserved) at or below reorder level. */
    index("idx_inventory_low_stock")
      .on(t.branchId, t.variantId)
      .where(sql`quantity - reserved_quantity <= reorder_level`),
  ],
);

/**
 * Append-only stock ledger.
 *
 * `balanceAfter` is the running balance at that branch immediately after this
 * movement, computed inside the transaction that writes it. Storing it means a
 * stock-card report is a single indexed range scan instead of a window function
 * over the whole history of a product.
 */
export const inventoryTransactions = pgTable(
  "inventory_transactions",
  {
    id: primaryId(),
    ...tenantScope(),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    branchId: uuid()
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),

    type: varchar({ length: 30 }).$type<InventoryTxType>().notNull(),
    /** Signed: positive is stock in, negative is stock out. Never zero. */
    quantity: quantity().notNull(),
    balanceAfter: quantity().notNull(),

    /** Unit cost at the time of this movement. Feeds the weighted-average cost. */
    unitCost: money(),

    /** What caused it: "sale", "purchase_order", "stock_transfer", "adjustment". */
    referenceType: varchar({ length: 30 }),
    referenceId: uuid(),

    notes: text(),
    createdBy: uuid().references(() => users.id, { onDelete: "set null" }),
    /** Which terminal, when the movement originated from a POS sale. */
    deviceId: uuid(),
    createdAt: timestamps().createdAt,
  },
  (t) => [
    /** The stock-card query: one product, one branch, newest first. */
    index("idx_inv_tx_variant_branch").on(t.variantId, t.branchId, t.createdAt),
    index("idx_inv_tx_reference").on(t.referenceType, t.referenceId),
    index("idx_inv_tx_tenant_created").on(t.tenantId, t.createdAt),
  ],
);

/**
 * Inter-branch transfers.
 *
 * Stock leaves the source when the transfer is *shipped* and arrives at the
 * destination when it is *received* — not both at approval. In between it is
 * genuinely in transit and belongs to neither branch, which is the only model
 * that survives a van that breaks down.
 */
export const stockTransfers = pgTable(
  "stock_transfers",
  {
    id: primaryId(),
    ...tenantScope(),
    transferNumber: varchar({ length: 30 }).notNull(),
    fromBranchId: uuid()
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    toBranchId: uuid()
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    status: varchar({ length: 20 })
      .$type<TransferStatus>()
      .notNull()
      .default("requested"),

    requestedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    approvedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    shippedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    receivedBy: uuid().references(() => users.id, { onDelete: "set null" }),

    approvedAt: timestamp({ withTimezone: true, mode: "date" }),
    shippedAt: timestamp({ withTimezone: true, mode: "date" }),
    receivedAt: timestamp({ withTimezone: true, mode: "date" }),

    notes: text(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("uq_stock_transfers_number").on(t.tenantId, t.transferNumber),
    index("idx_transfers_from").on(t.fromBranchId, t.status),
    index("idx_transfers_to").on(t.toBranchId, t.status),
  ],
);

export const stockTransferItems = pgTable(
  "stock_transfer_items",
  {
    id: primaryId(),
    ...tenantScope(),
    transferId: uuid()
      .notNull()
      .references(() => stockTransfers.id, { onDelete: "cascade" }),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    requestedQuantity: quantity().notNull(),
    /** NULL until shipped. May be less than requested. */
    shippedQuantity: quantity(),
    /** NULL until received. A shortfall against shipped is shrinkage — flag it. */
    receivedQuantity: quantity(),
    notes: text(),
    ...timestamps(),
  },
  (t) => [index("idx_transfer_items_transfer").on(t.transferId)],
);

/**
 * Physical stock counts.
 *
 * A count is a document, not a direct edit: staff record what they see, a
 * manager approves, and only then does the system write `adjustment` rows for
 * the variances. Without the approval step, a stock count is an unaudited
 * write channel straight into inventory.
 */
export const stockCounts = pgTable(
  "stock_counts",
  {
    id: primaryId(),
    ...tenantScope(),
    branchId: uuid()
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    countNumber: varchar({ length: 30 }).notNull(),
    /** draft | counting | pending_approval | approved | cancelled */
    status: varchar({ length: 20 }).notNull().default("draft"),
    /** NULL = full count; set = a single category was counted. */
    categoryId: uuid(),
    countedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    approvedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp({ withTimezone: true, mode: "date" }),
    notes: text(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("uq_stock_counts_number").on(t.tenantId, t.countNumber),
    index("idx_stock_counts_branch").on(t.branchId, t.status),
  ],
);

export const stockCountItems = pgTable(
  "stock_count_items",
  {
    id: primaryId(),
    ...tenantScope(),
    stockCountId: uuid()
      .notNull()
      .references(() => stockCounts.id, { onDelete: "cascade" }),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    /** What the system believed, captured when the count sheet was generated. */
    systemQuantity: quantity().notNull(),
    /** What was actually on the shelf. */
    countedQuantity: quantity(),
    /** countedQuantity - systemQuantity. Stored so the report needs no recompute. */
    variance: quantity(),
    notes: text(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("uq_stock_count_items").on(t.stockCountId, t.variantId),
    index("idx_stock_count_items_count").on(t.stockCountId),
  ],
);

export const inventoryRelations = relations(inventory, ({ one }) => ({
  variant: one(productVariants, { fields: [inventory.variantId], references: [productVariants.id] }),
  branch: one(branches, { fields: [inventory.branchId], references: [branches.id] }),
}));

export const inventoryTransactionsRelations = relations(
  inventoryTransactions,
  ({ one }) => ({
    variant: one(productVariants, {
      fields: [inventoryTransactions.variantId],
      references: [productVariants.id],
    }),
    branch: one(branches, {
      fields: [inventoryTransactions.branchId],
      references: [branches.id],
    }),
  }),
);

export const stockTransfersRelations = relations(stockTransfers, ({ one, many }) => ({
  fromBranch: one(branches, {
    fields: [stockTransfers.fromBranchId],
    references: [branches.id],
    relationName: "transfer_from",
  }),
  toBranch: one(branches, {
    fields: [stockTransfers.toBranchId],
    references: [branches.id],
    relationName: "transfer_to",
  }),
  items: many(stockTransferItems),
}));

export const stockTransferItemsRelations = relations(stockTransferItems, ({ one }) => ({
  transfer: one(stockTransfers, {
    fields: [stockTransferItems.transferId],
    references: [stockTransfers.id],
  }),
  variant: one(productVariants, {
    fields: [stockTransferItems.variantId],
    references: [productVariants.id],
  }),
}));

export type Inventory = typeof inventory.$inferSelect;
export type NewInventory = typeof inventory.$inferInsert;
export type InventoryTransaction = typeof inventoryTransactions.$inferSelect;
export type NewInventoryTransaction = typeof inventoryTransactions.$inferInsert;
export type StockTransfer = typeof stockTransfers.$inferSelect;
export type NewStockTransfer = typeof stockTransfers.$inferInsert;
export type StockTransferItem = typeof stockTransferItems.$inferSelect;
export type StockCount = typeof stockCounts.$inferSelect;
export type StockCountItem = typeof stockCountItems.$inferSelect;
