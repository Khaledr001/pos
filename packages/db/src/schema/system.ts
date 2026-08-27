import type { NotificationSeverity, NotificationType } from "@devsfleet/shared-types";
import { relations, sql } from "drizzle-orm";
import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { primaryId, timestamps } from "./_shared.js";
import { branches, tenantScope } from "./tenants.js";

/**
 * A user's in-app inbox — low-stock crossings, dues, sale/order lifecycle,
 * system messages. See INVENTRA-SPEC.md §6.10 and §8.16.
 *
 * Mutable, not a ledger: `isRead` moves from false to true in place. Nothing
 * here needs the append-only guarantee that protects inventory_transactions,
 * price_history and audit_log.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: primaryId(),
    ...tenantScope(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Narrows this to one branch's context. NULL still reaches a tenant-wide user. */
    branchId: uuid().references(() => branches.id, { onDelete: "set null" }),

    type: varchar({ length: 30 }).$type<NotificationType>().notNull(),
    severity: varchar({ length: 10 }).$type<NotificationSeverity>().notNull().default("info"),
    title: varchar({ length: 200 }).notNull(),
    message: text().notNull(),

    /** What this is about, for deep-linking — e.g. "product_variant" + its id. */
    referenceType: varchar({ length: 40 }),
    referenceId: uuid(),

    isRead: boolean().notNull().default(false),
    readAt: timestamp({ withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (t) => [
    index("idx_notifications_user_unread").on(t.userId, t.isRead, t.createdAt),

    /**
     * The dedupe mechanism. A second unread crossing for the same
     * (user, type, referenceType, referenceId) hits this index and is folded
     * into the existing row by onConflictDoUpdate rather than stacked as a
     * duplicate — see NotificationsService.notify(). Once read, a fresh
     * crossing is free to notify again.
     */
    uniqueIndex("uq_notifications_dedupe")
      .on(t.userId, t.type, t.referenceType, t.referenceId)
      .where(sql`is_read = false and reference_id is not null`),
  ],
);

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
  branch: one(branches, { fields: [notifications.branchId], references: [branches.id] }),
}));

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
