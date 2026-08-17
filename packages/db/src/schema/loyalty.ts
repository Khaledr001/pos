import type { LoyaltyType, PaymentMethod } from "@devsfleet/shared-types";
import { relations } from "drizzle-orm";
import { index, integer, pgTable, text, uuid, varchar } from "drizzle-orm/pg-core";
import { money, primaryId, timestamps } from "./_shared.js";
import { users } from "./auth.js";
import { customers } from "./partners.js";
import { tenantScope } from "./tenants.js";

/**
 * Loyalty points and customer payments.
 *
 * Both are append-only ledgers against `customers`, on the same principle as
 * `inventory_transactions`: the customer row carries a cached running total
 * (`loyaltyPoints`, `creditBalance`) for cheap reads, and every row here is
 * what that total must reconcile against. If the two ever disagree, the
 * ledger is the truth and the cache gets corrected — never the other way.
 */
export const loyaltyTransactions = pgTable(
  "loyalty_transactions",
  {
    id: primaryId(),
    ...tenantScope(),
    customerId: uuid()
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    /** Signed: positive earned, negative redeemed. The sign is the direction. */
    points: integer().notNull(),
    type: varchar({ length: 20 }).$type<LoyaltyType>().notNull(),
    /** e.g. "sale". What earned or spent the points. */
    referenceType: varchar({ length: 40 }),
    referenceId: uuid(),
    notes: text(),
    createdBy: uuid().references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    index("idx_loyalty_customer").on(t.customerId, t.createdAt),
    index("idx_loyalty_reference").on(t.referenceType, t.referenceId),
  ],
);

/**
 * Settling an old credit invoice. Decreases `customers.creditBalance` by
 * `amount` in the same transaction — the payment row and the balance move
 * together or not at all.
 */
export const customerPayments = pgTable(
  "customer_payments",
  {
    id: primaryId(),
    ...tenantScope(),
    customerId: uuid()
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    amount: money().notNull(),
    method: varchar({ length: 20 }).$type<PaymentMethod>().notNull(),
    referenceNumber: varchar({ length: 80 }),
    notes: text(),
    createdBy: uuid().references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [index("idx_customer_payments_customer").on(t.customerId, t.createdAt)],
);

export const loyaltyTransactionsRelations = relations(loyaltyTransactions, ({ one }) => ({
  customer: one(customers, {
    fields: [loyaltyTransactions.customerId],
    references: [customers.id],
  }),
}));

export const customerPaymentsRelations = relations(customerPayments, ({ one }) => ({
  customer: one(customers, {
    fields: [customerPayments.customerId],
    references: [customers.id],
  }),
}));

export type LoyaltyTransaction = typeof loyaltyTransactions.$inferSelect;
export type CustomerPayment = typeof customerPayments.$inferSelect;
