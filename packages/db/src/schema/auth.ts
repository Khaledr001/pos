import type { Locale, PermissionGrant } from "@devsfleet/shared-types";
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { activeFlag, primaryId, softDelete, timestamps } from "./_shared.js";
import { branches, tenantScope } from "./tenants.js";

/**
 * Roles are data, not code.
 *
 * A tenant seeds admin/manager/cashier/warehouse (see DEFAULT_ROLE_PERMISSIONS
 * in @devsfleet/shared-types) and can then add its own. Nothing in the API
 * branches on the role *name* — authorisation is always a permission check, so
 * a tenant inventing a "supervisor" role never requires a code change.
 */
export const roles = pgTable(
  "roles",
  {
    id: primaryId(),
    ...tenantScope(),
    name: varchar({ length: 100 }).notNull(),
    description: text(),
    /** Array of Permission strings, or ["*"] for the owner role. */
    permissions: jsonb().$type<PermissionGrant[]>().notNull().default([]),
    /** Seeded roles cannot be deleted; their permissions remain editable. */
    isSystem: boolean().notNull().default(false),
    ...timestamps(),
  },
  (t) => [uniqueIndex("uq_roles_tenant_name").on(t.tenantId, t.name)],
);

export const users = pgTable(
  "users",
  {
    id: primaryId(),
    ...tenantScope(),
    /**
     * NULL = may act on every branch in the tenant (owner, area manager).
     * A cashier is always pinned to one branch.
     */
    branchId: uuid().references(() => branches.id, { onDelete: "restrict" }),
    roleId: uuid()
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    name: varchar({ length: 255 }).notNull(),
    email: varchar({ length: 255 }),
    phone: varchar({ length: 20 }),
    /**
     * Bcrypt hash of the 4-6 digit counter PIN — never the PIN itself.
     * A PIN is low-entropy by design, which is why PIN login is additionally
     * bound to a registered device and a branch.
     */
    pinHash: varchar({ length: 255 }),
    passwordHash: varchar({ length: 255 }).notNull(),
    locale: varchar({ length: 5 }).$type<Locale>().notNull().default("en"),
    lastLoginAt: timestamp({ withTimezone: true, mode: "date" }),
    ...activeFlag(),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    /**
     * Email is unique per tenant — the same person may work for two tenants.
     * Partial on deleted_at so a removed user does not permanently reserve
     * their address.
     */
    uniqueIndex("uq_users_tenant_email")
      .on(t.tenantId, t.email)
      .where(sql`deleted_at IS NULL`),
    index("idx_users_tenant_branch").on(t.tenantId, t.branchId),
    index("idx_users_role").on(t.roleId),
  ],
);

/**
 * Refresh tokens are stored hashed so a database read cannot mint sessions.
 *
 * They are rows rather than stateless JWTs because a lost POS terminal or a
 * cashier who leaves must be revocable immediately — a stateless refresh token
 * stays valid until it expires, which for a terminal is 90 days.
 */
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: primaryId(),
    ...tenantScope(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 of the token. Lookup is by hash; the plaintext is never stored. */
    tokenHash: varchar({ length: 128 }).notNull().unique(),
    /** Set when the session belongs to a POS terminal rather than a browser. */
    deviceId: uuid(),
    userAgent: text(),
    ipAddress: varchar({ length: 45 }),
    expiresAt: timestamp({ withTimezone: true, mode: "date" }).notNull(),
    /** Set on logout, on rotation, or when an admin kills the session. */
    revokedAt: timestamp({ withTimezone: true, mode: "date" }),
    /**
     * Set when this token was exchanged for a new one. If a token that was
     * revoked *by rotation* is presented again, the family is compromised and
     * every session for that user is killed.
     */
    replacedByHash: varchar({ length: 128 }),
    ...timestamps(),
  },
  (t) => [
    index("idx_refresh_user").on(t.userId),
    index("idx_refresh_expires").on(t.expiresAt),
  ],
);

/**
 * Append-only record of who changed what.
 *
 * Written by an interceptor for any route carrying `@Audited()`, plus
 * unconditionally for price changes, stock adjustments, voids and permission
 * edits — the four places money goes missing in a retail business.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: primaryId(),
    ...tenantScope(),
    branchId: uuid().references(() => branches.id, { onDelete: "set null" }),
    userId: uuid().references(() => users.id, { onDelete: "set null" }),
    /** Table name, e.g. "product_prices". */
    entityType: varchar({ length: 50 }).notNull(),
    entityId: uuid(),
    /** create | update | delete | void | approve | login | export */
    action: varchar({ length: 30 }).notNull(),
    /** Only the fields that changed, as { field: [before, after] }. */
    changes: jsonb().$type<Record<string, [unknown, unknown]>>(),
    reason: text(),
    ipAddress: varchar({ length: 45 }),
    requestId: varchar({ length: 64 }),
    createdAt: timestamps().createdAt,
  },
  (t) => [
    index("idx_audit_tenant_created").on(t.tenantId, t.createdAt),
    index("idx_audit_entity").on(t.entityType, t.entityId),
    index("idx_audit_user").on(t.userId, t.createdAt),
  ],
);

export const rolesRelations = relations(roles, ({ many }) => ({
  users: many(users),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  role: one(roles, { fields: [users.roleId], references: [roles.id] }),
  branch: one(branches, { fields: [users.branchId], references: [branches.id] }),
  refreshTokens: many(refreshTokens),
}));

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, { fields: [refreshTokens.userId], references: [users.id] }),
}));

export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;
