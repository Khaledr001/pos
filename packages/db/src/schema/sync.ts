import type {
  DeviceType,
  OfflineStockAllocation,
  SyncDirection,
  SyncEntity,
  SyncStatus,
} from "@devsfleet/shared-types";
import { relations, sql } from "drizzle-orm";
import {
  bigint,
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
import { activeFlag, primaryId, timestamps } from "./_shared.js";
import { branches, tenantScope } from "./tenants.js";

/**
 * SYNC & DEVICES
 */

export const devices = pgTable(
  "devices",
  {
    id: primaryId(),
    ...tenantScope(),
    branchId: uuid()
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    name: varchar({ length: 100 }).notNull(),
    type: varchar({ length: 20 }).$type<DeviceType>().notNull().default("pos"),

    /**
     * Hardware fingerprint from the Electron main process. A device row is
     * bound to it on first activation, so a stolen installer cannot be used to
     * register a rogue terminal against this tenant.
     */
    hardwareId: varchar({ length: 128 }),
    /** Single-use code an installer redeems to bind itself to this row. */
    activationCode: varchar({ length: 32 }),
    activatedAt: timestamp({ withTimezone: true, mode: "date" }),

    appVersion: varchar({ length: 20 }),
    lastSeenAt: timestamp({ withTimezone: true, mode: "date" }),
    lastSyncAt: timestamp({ withTimezone: true, mode: "date" }),
    /** The high-water mark this device last acknowledged. */
    lastCheckpoint: varchar({ length: 64 }),

    /**
     * This terminal's slice of branch stock while offline.
     * Shape: OfflineStockAllocation from @devsfleet/shared-types. Slices across
     * a branch's terminals are disjoint, so two terminals selling offline
     * simultaneously cannot oversell the same units.
     */
    offlineStockAllocation: jsonb()
      .$type<OfflineStockAllocation | Record<string, never>>()
      .notNull()
      .default({}),

    /** Printer model, drawer settings, scanner prefix. Set per terminal. */
    hardwareConfig: jsonb().$type<Record<string, unknown>>().notNull().default({}),

    ...activeFlag(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("uq_devices_tenant_name").on(t.tenantId, t.name),
    uniqueIndex("uq_devices_hardware").on(t.hardwareId),
    index("idx_devices_branch").on(t.branchId),
  ],
);

/**
 * Sync journal.
 *
 * One row per pushed or pulled item. This is not the transport — it is the
 * record of what happened, kept so that "the sale from terminal 2 on Tuesday
 * never arrived" is an answerable question rather than a guess.
 *
 * Rows older than the retention window are pruned by a scheduled job; the
 * documents they describe live in their own tables and are never pruned.
 */
export const syncEvents = pgTable(
  "sync_events",
  {
    id: primaryId(),
    ...tenantScope(),
    deviceId: uuid()
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),

    direction: varchar({ length: 10 }).$type<SyncDirection>().notNull(),
    entityType: varchar({ length: 30 }).$type<SyncEntity>().notNull(),
    entityId: uuid(),
    /** The terminal's idempotency key for this record. Push only. */
    clientId: uuid(),
    /** Terminal-local monotonic sequence. Orders operations from one device. */
    sequence: bigint({ mode: "number" }),

    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    status: varchar({ length: 20 }).$type<SyncStatus>().notNull().default("pending"),

    /** What the server found when it disagreed with the terminal. */
    conflictData: jsonb().$type<Record<string, unknown>>(),
    /** Stable code from ERROR_CODES when status is conflict or rejected. */
    errorCode: varchar({ length: 50 }),
    errorMessage: text(),
    attemptCount: integer().notNull().default(0),

    syncedAt: timestamp({ withTimezone: true, mode: "date" }),
    createdAt: timestamps().createdAt,
  },
  (t) => [
    /** Replay protection: one applied row per client id. */
    uniqueIndex("uq_sync_events_client")
      .on(t.deviceId, t.clientId, t.entityType)
      .where(sql`client_id IS NOT NULL`),
    index("idx_sync_events_device_created").on(t.deviceId, t.createdAt),
    index("idx_sync_events_status").on(t.tenantId, t.status, t.createdAt),
  ],
);

/**
 * Document number counters.
 *
 * A counter per (tenant, branch, kind, year), incremented inside the same
 * transaction as the document it numbers.
 *
 * Deliberately not a Postgres SEQUENCE: sequences are non-transactional, so a
 * rolled-back sale would burn INV-2026-000042 and leave a permanent gap in the
 * invoice series. Tax authorities ask about gaps. A row with `SELECT ... FOR
 * UPDATE` gives a gapless series at the cost of serialising numbering within
 * one branch — which at counter throughput is not a real constraint.
 */
export const documentSequences = pgTable(
  "document_sequences",
  {
    id: primaryId(),
    ...tenantScope(),
    /** From sequenceKey() in @devsfleet/shared-utils: "sale:DXB:2026". */
    key: varchar({ length: 64 }).notNull(),
    currentValue: bigint({ mode: "number" }).notNull().default(0),
    ...timestamps(),
  },
  (t) => [uniqueIndex("uq_document_sequences").on(t.tenantId, t.key)],
);

export const devicesRelations = relations(devices, ({ one, many }) => ({
  branch: one(branches, { fields: [devices.branchId], references: [branches.id] }),
  syncEvents: many(syncEvents),
}));

export const syncEventsRelations = relations(syncEvents, ({ one }) => ({
  device: one(devices, { fields: [syncEvents.deviceId], references: [devices.id] }),
}));

export type Device = typeof devices.$inferSelect;
export type NewDevice = typeof devices.$inferInsert;
export type SyncEvent = typeof syncEvents.$inferSelect;
export type NewSyncEvent = typeof syncEvents.$inferInsert;
export type DocumentSequence = typeof documentSequences.$inferSelect;
