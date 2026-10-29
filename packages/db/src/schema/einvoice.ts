import type { EinvoiceDocType, EinvoiceProvider, EinvoiceStatus } from "@devsfleet/shared-types";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { primaryId, timestamps } from "./_shared.js";
import { sales } from "./sales.js";
import { branchScope, tenantScope } from "./tenants.js";

/**
 * UAE E-INVOICING
 *
 * `einvoice_documents` is both the queue and the legal record: one row per
 * issued invoice or credit note that has to go to the tax authority's network,
 * carrying the snapshot it was built from, the PINT AE XML and its hash. Once a
 * document has been sent, none of those can change (trigger) — a correction is
 * a credit note, never an edit.
 */

/** The tenant's connection to its accredited service provider (ASP). */
export const einvoiceAccounts = pgTable(
  "einvoice_accounts",
  {
    id: primaryId(),
    ...tenantScope(),
    provider: varchar({ length: 12 }).$type<EinvoiceProvider>().notNull().default("sandbox"),
    /** `gateway` only: where documents are POSTed. https. */
    endpointUrl: varchar({ length: 500 }),
    /** AES-256-GCM ciphertext of the provider credentials (SecretBox). Never returned by any endpoint. */
    credentialsEnc: text(),
    /** The unguessable part of the callback URL the ASP calls with status updates. */
    callbackToken: uuid().notNull().defaultRandom(),
    isActive: boolean().notNull().default(true),
    lastTestAt: timestamp({ withTimezone: true, mode: "date" }),
    lastTestOk: boolean(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("uq_einvoice_accounts_tenant").on(t.tenantId),
    uniqueIndex("uq_einvoice_accounts_callback").on(t.callbackToken),
  ],
);

export const einvoiceDocuments = pgTable(
  "einvoice_documents",
  {
    id: primaryId(),
    ...tenantScope(),
    ...branchScope(),
    /** The sale (or return) this document reports. One document per sale. */
    saleId: uuid()
      .notNull()
      .references(() => sales.id, { onDelete: "restrict" }),
    docType: varchar({ length: 12 }).$type<EinvoiceDocType>().notNull(),
    /** Printed number, copied so the register reads without a join. */
    documentNumber: varchar({ length: 40 }).notNull(),
    /** PINT AE unique identifier number (BTAE-07). Minted once, never reused. */
    uuid: uuid().notNull().defaultRandom(),
    status: varchar({ length: 12 }).$type<EinvoiceStatus>().notNull().default("queued"),
    attempts: integer().notNull().default(0),
    nextAttemptAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
    lastError: text(),
    /** Validation findings from the last build: [{code, message, field?, severity}]. */
    issues: jsonb().$type<{ code: string; message: string; field?: string; severity: "error" | "warning" }[]>().notNull().default([]),
    /** Everything the XML was built from, frozen (rule 5). */
    snapshot: jsonb().$type<Record<string, unknown>>(),
    xml: text(),
    xmlSha256: varchar({ length: 64 }),
    /** The PINT AE version the XML was built against, e.g. "1.0.4". */
    pintVersion: varchar({ length: 12 }),
    providerRef: varchar({ length: 200 }),
    /** What the ASP accepted this under: sandbox or live. A sandbox document is never "reported". */
    mode: varchar({ length: 8 }).notNull().default("sandbox"),
    issuedAt: timestamp({ withTimezone: true, mode: "date" }).notNull(),
    submittedAt: timestamp({ withTimezone: true, mode: "date" }),
    deliveredAt: timestamp({ withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("uq_einvoice_documents_sale").on(t.saleId),
    uniqueIndex("uq_einvoice_documents_uuid").on(t.uuid),
    index("idx_einvoice_documents_sweep").on(t.status, t.nextAttemptAt),
    index("idx_einvoice_documents_register").on(t.tenantId, t.status, t.createdAt),
  ],
);

/** What happened to a document, in order. Append-only (trigger). */
export const einvoiceEvents = pgTable(
  "einvoice_events",
  {
    id: primaryId(),
    ...tenantScope(),
    documentId: uuid()
      .notNull()
      .references(() => einvoiceDocuments.id, { onDelete: "restrict" }),
    status: varchar({ length: 12 }).$type<EinvoiceStatus>().notNull(),
    message: text().notNull(),
    detail: jsonb().$type<Record<string, unknown>>(),
    createdAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("idx_einvoice_events_document").on(t.documentId, t.createdAt)],
);
