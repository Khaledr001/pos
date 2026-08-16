import type { CustomerType, Locale } from "@devsfleet/shared-types";
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { activeFlag, money, primaryId, softDelete, timestamps } from "./_shared.js";
import { branches, tenantScope } from "./tenants.js";

/**
 * CUSTOMERS & SUPPLIERS
 */

export const customers = pgTable(
  "customers",
  {
    id: primaryId(),
    ...tenantScope(),
    /** Where they usually buy. Does not restrict them — it defaults the branch on new documents. */
    branchId: uuid().references(() => branches.id, { onDelete: "set null" }),

    name: varchar({ length: 255 }).notNull(),
    company: varchar({ length: 255 }),
    phone: varchar({ length: 20 }),
    email: varchar({ length: 255 }),
    /** UAE Tax Registration Number. Required on a tax invoice above the threshold. */
    trn: varchar({ length: 20 }),
    address: text(),
    type: varchar({ length: 20 }).$type<CustomerType>().notNull().default("retail"),
    /** Language for WhatsApp replies and printed documents. */
    locale: varchar({ length: 5 }).$type<Locale>().notNull().default("en"),

    /** Which tier they buy at. NULL = the tenant's default list. */
    priceListId: uuid(),

    /**
     * CREDIT
     *
     * Credit is granted per customer at the owner's discretion — not tied to
     * the wholesale flag. `creditLimit` 0 means cash only.
     *
     * `creditBalance` is a cached running total, maintained inside the same
     * transaction as every credit sale and every payment. It is a cache of
     * SUM(sales on credit) - SUM(payments), and the reconciliation report
     * recomputes it from those tables; if the two ever disagree, the ledger
     * wins and this column is corrected.
     */
    creditLimit: money().notNull().default("0"),
    creditBalance: money().notNull().default("0"),
    /** Days until a credit invoice is due. 0 = due on receipt. */
    paymentTermDays: integer().notNull().default(0),
    /** Set by an owner to stop further credit without deactivating the customer. */
    creditOnHold: boolean().notNull().default(false),

    /**
     * The number the WhatsApp bot matches an inbound message against, in E.164.
     * Separate from `phone` because the business contact and the person who
     * actually messages are frequently different people.
     */
    whatsappPhone: varchar({ length: 20 }),

    notes: text(),
    ...activeFlag(),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    index("idx_customers_tenant_phone").on(t.tenantId, t.phone),
    // The bot's very first query on every inbound message — must be a unique hit.
    uniqueIndex("uq_customers_tenant_whatsapp")
      .on(t.tenantId, t.whatsappPhone)
      .where(sql`whatsapp_phone IS NOT NULL AND deleted_at IS NULL`),
    index("idx_customers_tenant_name").on(t.tenantId, t.name),
    index("idx_customers_updated").on(t.tenantId, t.updatedAt),
    /** Report: everyone currently over their limit. */
    index("idx_customers_credit")
      .on(t.tenantId, t.creditBalance)
      .where(sql`credit_balance > 0`),
  ],
);

export const suppliers = pgTable(
  "suppliers",
  {
    id: primaryId(),
    ...tenantScope(),
    name: varchar({ length: 255 }).notNull(),
    company: varchar({ length: 255 }),
    phone: varchar({ length: 20 }),
    email: varchar({ length: 255 }),
    trn: varchar({ length: 20 }),
    address: text(),
    /** Days from invoice to payment due. */
    paymentTermDays: integer().notNull().default(0),
    /** What we owe them. Mirror of customers.creditBalance, opposite direction. */
    outstandingBalance: money().notNull().default("0"),
    contactPerson: varchar({ length: 255 }),
    notes: text(),
    ...activeFlag(),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    index("idx_suppliers_tenant_name").on(t.tenantId, t.name),
    index("idx_suppliers_tenant_phone").on(t.tenantId, t.phone),
  ],
);

export const customersRelations = relations(customers, ({ one }) => ({
  branch: one(branches, { fields: [customers.branchId], references: [branches.id] }),
}));

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
export type Supplier = typeof suppliers.$inferSelect;
export type NewSupplier = typeof suppliers.$inferInsert;
