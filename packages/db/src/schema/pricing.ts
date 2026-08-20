import type { Currency, PriceListType } from "@devsfleet/shared-types";
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { activeFlag, money, primaryId, quantity, timestamps } from "./_shared.js";
import { tenantScope } from "./tenants.js";
import { users } from "./auth.js";
import { productVariants } from "./catalog.js";
import { customers } from "./partners.js";

/**
 * PRICING ENGINE
 *
 * Resolution order, highest priority first — implemented once, in
 * apps/api/src/modules/pricing/price-resolver.service.ts, and used by the POS,
 * the WhatsApp bot and the admin panel alike:
 *
 *   1. customer_prices        — a negotiated price for this customer + product
 *   2. product_prices         — on the customer's assigned price list
 *   3. product_prices         — on the tenant's default price list
 *   4. error NO_PRICE_FOR_PRODUCT (never fall back to zero or to cost)
 *
 * Every tier is date-bounded, so a promotional price expires by itself rather
 * than needing a job to unwind it.
 */

export const priceLists = pgTable(
  "price_lists",
  {
    id: primaryId(),
    ...tenantScope(),
    name: varchar({ length: 255 }).notNull(),
    type: varchar({ length: 20 }).$type<PriceListType>().notNull(),
    /** Books currency for this list. Lets a USD export list coexist with AED retail. */
    currency: varchar({ length: 3 }).$type<Currency>().notNull().default("AED"),
    /** The fallback list when a customer has none assigned. Exactly one per tenant. */
    isDefault: boolean().notNull().default(false),
    ...activeFlag(),
    ...timestamps(),
  },
  (t) => [
    index("idx_price_lists_tenant").on(t.tenantId),
    uniqueIndex("uq_price_lists_default")
      .on(t.tenantId)
      .where(sql`is_default = true`),
  ],
);

export const productPrices = pgTable(
  "product_prices",
  {
    id: primaryId(),
    ...tenantScope(),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    priceListId: uuid()
      .notNull()
      .references(() => priceLists.id, { onDelete: "cascade" }),

    /**
     * Landed cost. Visible only to holders of `report:financial` — a cashier
     * must not be able to see margin from the POS.
     */
    purchasePrice: money(),
    sellingPrice: money().notNull(),
    /**
     * Floor. A cashier with `sale:discount` cannot go below it; only
     * `price:override_floor` (manager) can, and doing so writes an audit row.
     * This is the single most effective control against counter discounting.
     *
     * Deliberately NOT tiered by `minQuantity` in practice — the floor exists
     * to stop selling below cost/margin, which does not vary with quantity
     * the way a promotional price does. Only the tier-1 (minQuantity = "1")
     * row is expected to carry one; other tiers may leave it null.
     */
    minSellingPrice: money(),

    /**
     * Quantity break: this tier applies once the sold quantity reaches this
     * figure. "1" (the default) is the ordinary, untiered price every row had
     * before quantity breaks existed — a tenant that never configures a
     * second tier sees no change at all.
     */
    minQuantity: quantity().notNull().default("1"),

    effectiveFrom: date({ mode: "string" }).notNull().defaultNow(),
    /** NULL = still current. Set when superseded, never deleted. */
    effectiveTo: date({ mode: "string" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("uq_product_prices_effective").on(
      t.variantId,
      t.priceListId,
      t.minQuantity,
      t.effectiveFrom,
    ),
    /**
     * The hot path: "current price for this product, this list, this
     * quantity". Partial on effective_to so the index only holds live rows —
     * after a few years of price history that is a fraction of the table.
     */
    index("idx_product_prices_current")
      .on(t.variantId, t.priceListId, t.minQuantity)
      .where(sql`effective_to IS NULL`),
    index("idx_product_prices_list").on(t.priceListId),
  ],
);

/**
 * Immutable audit of every price change.
 *
 * Separate from the date-bounded rows above because the questions differ:
 * `product_prices` answers "what does this cost today", `price_history`
 * answers "who changed it, when, and why" — which is what gets asked after a
 * margin drops without explanation.
 */
export const priceHistory = pgTable(
  "price_history",
  {
    id: primaryId(),
    ...tenantScope(),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    priceListId: uuid()
      .notNull()
      .references(() => priceLists.id, { onDelete: "cascade" }),
    /** Which tier changed — a variant can hold several independent ones. */
    minQuantity: quantity().notNull().default("1"),
    oldPurchasePrice: money(),
    newPurchasePrice: money(),
    oldSellingPrice: money(),
    newSellingPrice: money(),
    oldMinSellingPrice: money(),
    newMinSellingPrice: money(),
    changedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    reason: text(),
    /** Set when the change came from a bulk import rather than a person. */
    importBatchId: uuid(),
    createdAt: timestamps().createdAt,
  },
  (t) => [
    index("idx_price_history_variant").on(t.variantId, t.createdAt),
    index("idx_price_history_tenant_created").on(t.tenantId, t.createdAt),
  ],
);

/** Negotiated per-customer pricing. Beats every price list. */
export const customerPrices = pgTable(
  "customer_prices",
  {
    id: primaryId(),
    ...tenantScope(),
    customerId: uuid()
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    specialPrice: money().notNull(),
    /** Why this customer gets this rate — shown to whoever approves it later. */
    notes: text(),
    effectiveFrom: date({ mode: "string" }).notNull().defaultNow(),
    effectiveTo: date({ mode: "string" }),
    createdBy: uuid().references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("uq_customer_prices_effective").on(
      t.customerId,
      t.variantId,
      t.effectiveFrom,
    ),
    index("idx_customer_prices_current")
      .on(t.customerId, t.variantId)
      .where(sql`effective_to IS NULL`),
  ],
);

export const priceListsRelations = relations(priceLists, ({ many }) => ({
  prices: many(productPrices),
}));

export const productPricesRelations = relations(productPrices, ({ one }) => ({
  variant: one(productVariants, { fields: [productPrices.variantId], references: [productVariants.id] }),
  priceList: one(priceLists, {
    fields: [productPrices.priceListId],
    references: [priceLists.id],
  }),
}));

export const customerPricesRelations = relations(customerPrices, ({ one }) => ({
  customer: one(customers, {
    fields: [customerPrices.customerId],
    references: [customers.id],
  }),
  variant: one(productVariants, { fields: [customerPrices.variantId], references: [productVariants.id] }),
}));

export type PriceList = typeof priceLists.$inferSelect;
export type NewPriceList = typeof priceLists.$inferInsert;
export type ProductPrice = typeof productPrices.$inferSelect;
export type NewProductPrice = typeof productPrices.$inferInsert;
export type PriceHistoryEntry = typeof priceHistory.$inferSelect;
export type NewPriceHistoryEntry = typeof priceHistory.$inferInsert;
export type CustomerPrice = typeof customerPrices.$inferSelect;
export type NewCustomerPrice = typeof customerPrices.$inferInsert;
