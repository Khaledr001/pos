import type {
  CashMovementType,
  CashSessionStatus,
  Currency,
  PaymentMethod,
} from "@devsfleet/shared-types";
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
import { money, primaryId, syncable, timestamps } from "./_shared.js";
import { users } from "./auth.js";
import { customers } from "./partners.js";
import { branches, tenantScope } from "./tenants.js";

/**
 * PAYMENTS & CASH REGISTER
 *
 * A payment is a separate row from a sale, not a column on it. That is what
 * makes split tender work (part cash, part card), lets a customer settle an old
 * credit invoice weeks later, and keeps a refund from having to mutate the
 * original sale.
 */

export const payments = pgTable(
  "payments",
  {
    id: primaryId(),
    ...tenantScope(),
    branchId: uuid()
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),

    /** NULL when settling an account balance rather than paying one invoice. */
    saleId: uuid(),
    customerId: uuid().references(() => customers.id, { onDelete: "restrict" }),
    /** Ties cash payments to the drawer session they landed in. */
    cashSessionId: uuid(),

    method: varchar({ length: 20 }).$type<PaymentMethod>().notNull(),
    /** Negative on a refund. The sign is the direction; there is no separate table. */
    amount: money().notNull(),
    currency: varchar({ length: 3 }).$type<Currency>().notNull().default("AED"),
    exchangeRate: money().notNull().default("1"),

    /** Cash tendered, so the receipt can print change given. Cash payments only. */
    tenderedAmount: money(),
    changeAmount: money(),

    /** Card auth code, transfer reference, cheque number. */
    reference: varchar({ length: 100 }),
    /** Cheque clearing date, for post-dated cheques. */
    clearingDate: timestamp({ withTimezone: true, mode: "date" }),

    notes: text(),
    createdBy: uuid().references(() => users.id, { onDelete: "set null" }),

    ...syncable(),
    occurredAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    index("idx_payments_sale").on(t.saleId),
    index("idx_payments_customer").on(t.customerId, t.occurredAt),
    index("idx_payments_branch_occurred").on(t.branchId, t.occurredAt),
    index("idx_payments_cash_session").on(t.cashSessionId),
    uniqueIndex("uq_payments_client_id")
      .on(t.localId)
      .where(sql`local_id IS NOT NULL`),
  ],
);

/**
 * One drawer, one shift, one cashier.
 *
 * Opening float and closing count are recorded so the difference is explicit
 * rather than absorbed. `expectedAmount` is computed from the session's
 * movements at close time; `difference` is what the cashier has to explain.
 */
export const cashSessions = pgTable(
  "cash_sessions",
  {
    id: primaryId(),
    ...tenantScope(),
    branchId: uuid()
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    /** `deviceId` arrives with ...syncable below — a drawer belongs to a terminal. */
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    sessionNumber: varchar({ length: 30 }).notNull(),

    openingAmount: money().notNull(),
    /** What the cashier physically counted at close. NULL while open. */
    closingAmount: money(),
    /** opening + cash sales + cash in - refunds - cash out. Computed at close. */
    expectedAmount: money(),
    /** closingAmount - expectedAmount. Negative is short. */
    difference: money(),

    status: varchar({ length: 20 }).$type<CashSessionStatus>().notNull().default("open"),
    openedAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
    closedAt: timestamp({ withTimezone: true, mode: "date" }),
    closedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    notes: text(),

    ...syncable(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("uq_cash_sessions_number").on(t.tenantId, t.sessionNumber),
    index("idx_cash_sessions_branch_status").on(t.branchId, t.status),
    index("idx_cash_sessions_user").on(t.userId, t.openedAt),
    uniqueIndex("uq_cash_sessions_client_id")
      .on(t.localId)
      .where(sql`local_id IS NOT NULL`),
  ],
);

/**
 * Every movement of physical cash in or out of a drawer.
 *
 * Sales and refunds write here automatically; `cash_in`/`cash_out`/`payout` are
 * manual and require a reason. The reason field is the point — an unexplained
 * drawer movement is exactly what a shrinkage report is looking for.
 */
export const cashMovements = pgTable(
  "cash_movements",
  {
    id: primaryId(),
    ...tenantScope(),
    cashSessionId: uuid()
      .notNull()
      .references(() => cashSessions.id, { onDelete: "cascade" }),
    type: varchar({ length: 20 }).$type<CashMovementType>().notNull(),
    /** Signed: positive into the drawer, negative out. */
    amount: money().notNull(),
    /** Mandatory for manual movements; auto-filled for sales and refunds. */
    reason: text(),
    referenceType: varchar({ length: 30 }),
    referenceId: uuid(),
    createdBy: uuid().references(() => users.id, { onDelete: "set null" }),

    ...syncable(),
    occurredAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
    createdAt: timestamps().createdAt,
  },
  (t) => [
    index("idx_cash_movements_session").on(t.cashSessionId, t.occurredAt),
    uniqueIndex("uq_cash_movements_client_id")
      .on(t.localId)
      .where(sql`local_id IS NOT NULL`),
  ],
);

export const paymentsRelations = relations(payments, ({ one }) => ({
  customer: one(customers, { fields: [payments.customerId], references: [customers.id] }),
  branch: one(branches, { fields: [payments.branchId], references: [branches.id] }),
}));

export const cashSessionsRelations = relations(cashSessions, ({ one, many }) => ({
  branch: one(branches, { fields: [cashSessions.branchId], references: [branches.id] }),
  user: one(users, { fields: [cashSessions.userId], references: [users.id] }),
  movements: many(cashMovements),
}));

export const cashMovementsRelations = relations(cashMovements, ({ one }) => ({
  session: one(cashSessions, {
    fields: [cashMovements.cashSessionId],
    references: [cashSessions.id],
  }),
}));

export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
export type CashSession = typeof cashSessions.$inferSelect;
export type NewCashSession = typeof cashSessions.$inferInsert;
export type CashMovement = typeof cashMovements.$inferSelect;
export type NewCashMovement = typeof cashMovements.$inferInsert;
