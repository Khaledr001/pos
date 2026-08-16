import type { DayCloseStatus } from "@devsfleet/shared-types";
import { relations, sql } from "drizzle-orm";
import {
  date,
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
import { money, primaryId, softDelete, syncable, timestamps } from "./_shared.js";
import { users } from "./auth.js";
import { customers } from "./partners.js";
import { branches, tenantScope } from "./tenants.js";

/**
 * DAY CLOSE, EXPENSES, HELD CARTS
 *
 * Two levels of cash reconciliation, and they answer different questions:
 *
 *   `cash_sessions` — one drawer, one shift, one cashier. Answers "who was on
 *                     the till when this went missing".
 *   `daily_closings` — one branch, one calendar day. Answers "did the branch
 *                     take what it says it took", and is the row a manager
 *                     signs off.
 *
 * A branch with three tills has three sessions and one closing.
 */

export const dailyClosings = pgTable(
  "daily_closings",
  {
    id: primaryId(),
    ...tenantScope(),
    /**
     * Per BRANCH, not per tenant.
     *
     * The reference spec is single-location. Here two branches close their own
     * days, on their own schedules — a shared row would make one branch's
     * shortfall disappear into the other's surplus.
     */
    branchId: uuid()
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),

    closingDate: date().notNull(),
    status: varchar({ length: 20 }).$type<DayCloseStatus>().notNull().default("open"),

    /** Cash physically in the drawer when the day was opened. */
    openingFloat: money().notNull().default("0"),

    /**
     * Everything below is a SNAPSHOT, frozen at close and never recomputed.
     *
     * Voiding a sale next week must not silently rewrite a day somebody has
     * already counted and signed off. A figure that can change after the
     * signature is not a reconciliation.
     */
    totalSales: money(),
    totalReturns: money(),
    totalExpenses: money(),
    cashTotal: money(),
    cardTotal: money(),
    bankTotal: money(),
    creditTotal: money(),
    saleCount: integer(),

    /** openingFloat + cashTotal - cashExpenses. */
    expectedCash: money(),
    countedCash: money(),
    /** countedCash - expectedCash. Negative is short. */
    cashVariance: money(),

    notes: text(),

    openedBy: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    openedAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
    closedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    closedAt: timestamp({ withTimezone: true, mode: "date" }),

    ...timestamps(),
  },
  (t) => [
    // One row per branch per calendar day. The constraint, not application
    // code, is what stops two managers opening the same day concurrently.
    uniqueIndex("uq_daily_closings_day").on(t.tenantId, t.branchId, t.closingDate),
    index("idx_daily_closings_date").on(t.tenantId, t.closingDate),
  ],
);

export const expenses = pgTable(
  "expenses",
  {
    id: primaryId(),
    ...tenantScope(),
    branchId: uuid()
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),

    title: varchar({ length: 200 }).notNull(),
    amount: money().notNull(),
    /** Free text. The distinct set is offered as autocomplete rather than an enum —
     *  every trade invents its own categories, and a fixed list gets worked around. */
    category: varchar({ length: 80 }),
    expenseDate: date().notNull(),

    /**
     * Cash expenses come out of the drawer and reduce expected cash. A bank
     * transfer for the same amount does not — conflating them makes every
     * close-out look short by the value of the month's rent.
     */
    paymentMethod: varchar({ length: 20 }).notNull().default("cash"),

    notes: text(),

    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** Set when the covering day is closed, so a frozen day can list its expenses. */
    dailyClosingId: uuid().references(() => dailyClosings.id, { onDelete: "set null" }),

    ...softDelete(),
    ...timestamps(),
  },
  (t) => [
    index("idx_expenses_date").on(t.tenantId, t.branchId, t.expenseDate),
    index("idx_expenses_category").on(t.tenantId, t.category),
    index("idx_expenses_closing").on(t.dailyClosingId),
  ],
);

/**
 * A parked cart.
 *
 * Deliberately opaque JSON, not normalised lines. A held cart is a draft, not
 * a document: it has no number, appears in no report, and is not a promise to
 * anybody. Normalising it would mean every future cart field needs a migration,
 * and a half-typed cart from a build two versions ago would fail to restore.
 *
 * Held carts do NOT reserve stock. A cart held over lunch must not make the
 * last tap unsellable to the customer standing at the counter; the stock check
 * happens when it is completed.
 */
export const heldCarts = pgTable(
  "held_carts",
  {
    id: primaryId(),
    ...tenantScope(),
    branchId: uuid()
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),

    /** Cashier-supplied, e.g. "blue van guy". The only way to tell two apart. */
    label: varchar({ length: 80 }),

    /** Serialised cart: lines, quantities, prices, discounts, customer. */
    cartData: jsonb().notNull(),

    /** Denormalised for the list view, so restoring is not needed to choose. */
    lineCount: integer().notNull().default(0),
    total: money().notNull().default("0"),

    customerId: uuid().references(() => customers.id, { onDelete: "set null" }),

    /** Owner. A cashier sees only their own; a manager sees the branch's. */
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    ...syncable(),
    ...timestamps(),
  },
  (t) => [
    index("idx_held_carts_user").on(t.tenantId, t.branchId, t.userId),
    // Partial, matching every other syncable table: a cart held on the admin
    // side carries no clientId, and NULLs would otherwise all be distinct.
    uniqueIndex("uq_held_carts_client_id")
      .on(t.clientId)
      .where(sql`client_id IS NOT NULL`),
  ],
);

export const dailyClosingsRelations = relations(dailyClosings, ({ one, many }) => ({
  branch: one(branches, {
    fields: [dailyClosings.branchId],
    references: [branches.id],
  }),
  openedByUser: one(users, {
    fields: [dailyClosings.openedBy],
    references: [users.id],
  }),
  expenses: many(expenses),
}));

export const expensesRelations = relations(expenses, ({ one }) => ({
  branch: one(branches, { fields: [expenses.branchId], references: [branches.id] }),
  user: one(users, { fields: [expenses.userId], references: [users.id] }),
  dailyClosing: one(dailyClosings, {
    fields: [expenses.dailyClosingId],
    references: [dailyClosings.id],
  }),
}));

export const heldCartsRelations = relations(heldCarts, ({ one }) => ({
  branch: one(branches, { fields: [heldCarts.branchId], references: [branches.id] }),
  user: one(users, { fields: [heldCarts.userId], references: [users.id] }),
  customer: one(customers, {
    fields: [heldCarts.customerId],
    references: [customers.id],
  }),
}));
