import type { BranchSettings, PlanId, TenantSettings } from "@devsfleet/shared-types";
import { relations } from "drizzle-orm";
import {
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

/**
 * The multi-tenancy root.
 *
 * Your own business is tenant #1. Everything below this table is scoped by
 * `tenant_id` and enforced by row-level security, so the platform is sellable
 * to a second business without a data-model change.
 *
 * `tenants` itself has no tenant_id, so it gets no generated RLS policy — it is
 * readable only through the migrator role or a deliberate platform-admin
 * context. Application code reaches a tenant through the JWT, never by listing.
 */
export const tenants = pgTable(
  "tenants",
  {
    id: primaryId(),
    name: varchar({ length: 255 }).notNull(),
    /** URL-safe identifier, used for login scoping: pos.devsfleet.com/t/<slug>. */
    slug: varchar({ length: 100 }).notNull().unique(),
    /** Shape: TenantSettings from @devsfleet/shared-types. VAT rate, currency, locales. */
    settings: jsonb().$type<Partial<TenantSettings>>().notNull().default({}),

    /**
     * SUBSCRIPTION
     *
     * `planId` names a plan defined in code (see PLANS in @devsfleet/shared-types),
     * not a row. Changing what a plan includes is a deployment, not a data edit —
     * which means a tenant cannot be silently moved onto limits nobody reviewed,
     * and the limits are testable.
     *
     * An unrecognised id resolves to `free`. Failing closed matters: a typo must
     * shrink a tenant's allowance, never grant an unlimited one.
     */
    planId: varchar({ length: 30 }).$type<PlanId>().notNull().default("trial"),
    /** Set to now + 14 days at self-registration. NULL once subscribed. */
    trialEndsAt: timestamp({ withTimezone: true, mode: "date" }),
    /** End of the current paid period. */
    subscriptionEndsAt: timestamp({ withTimezone: true, mode: "date" }),
    /** External payment-processor references. Opaque to this system. */
    paymentCustomerId: varchar({ length: 100 }),
    paymentSubscriptionId: varchar({ length: 100 }),
    /** Set when an operator suspends the tenant, for the message shown at login. */
    suspendedAt: timestamp({ withTimezone: true, mode: "date" }),
    suspendedReason: text(),
    ...activeFlag(),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [index("idx_tenants_slug").on(t.slug), index("idx_tenants_plan").on(t.planId)],
);

/**
 * A physical location: shop, warehouse, or both.
 *
 * Inventory lives per branch, not per tenant — "do you have it in Sharjah" is
 * the single most common question the WhatsApp bot has to answer.
 */
export const branches = pgTable(
  "branches",
  {
    id: primaryId(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    name: varchar({ length: 255 }).notNull(),
    /** Short code used in document numbers: DXB, SHJ, AUH. Unique per tenant. */
    code: varchar({ length: 20 }).notNull(),
    address: text(),
    phone: varchar({ length: 20 }),
    email: varchar({ length: 255 }),
    /** Shape: BranchSettings. Narrow by design — a branch cannot redefine tax. */
    settings: jsonb().$type<Partial<BranchSettings>>().notNull().default({}),
    ...activeFlag(),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    // Codes are unique per tenant, not globally: two tenants may both have "DXB".
    index("idx_branches_tenant").on(t.tenantId),
    uniqueIndex("uq_branches_tenant_code").on(t.tenantId, t.code),
  ],
);

/**
 * Tenant scope. Every tenant-owned table spreads exactly this, and RLS policies
 * are generated for any table that ends up with the column (see sql/rls.sql).
 *
 * Defined here rather than in _shared.ts because it references `tenants.id`,
 * and _shared.ts is imported by every schema file — putting it there would make
 * the dependency graph cyclic.
 *
 * `onDelete: "restrict"` is deliberate: deleting a tenant must be a scripted,
 * intentional operation, never something a stray cascade can trigger.
 */
export const tenantScope = () => ({
  tenantId: uuid()
    .notNull()
    .references(() => tenants.id, { onDelete: "restrict" }),
});

export const tenantsRelations = relations(tenants, ({ many }) => ({
  branches: many(branches),
}));

export const branchesRelations = relations(branches, ({ one }) => ({
  tenant: one(tenants, { fields: [branches.tenantId], references: [tenants.id] }),
}));

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type Branch = typeof branches.$inferSelect;
export type NewBranch = typeof branches.$inferInsert;
