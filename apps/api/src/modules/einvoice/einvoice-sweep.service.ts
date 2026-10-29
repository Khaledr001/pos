import { createHash } from "node:crypto";
import { eq, schema, sql, type Transaction } from "@devsfleet/db";
import { resolveTenantSettings, trialStatus, type EinvoiceIssue } from "@devsfleet/shared-types";
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import { afterTransientFailure, LEASE_MS, STUCK_SUBMITTING_MS } from "./delivery-policy.js";
import { recordEvent } from "./events.js";
import { PINT_AE_VERSION } from "./pint-ae/constants.js";
import { renderPintAeXml } from "./pint-ae/render.js";
import { validateSnapshot } from "./pint-ae/validate.js";
import { ProviderResolver } from "./provider-resolver.js";
import type { AspSubmission } from "./providers/asp-provider.js";
import { loadSnapshot } from "./snapshot-loader.js";

const SWEEP_EVERY_MS = 30_000;
const TENANT_LIMIT = 50;
const BATCH_PER_TENANT = 10;

type Claimed = { id: string; sale_id: string; doc_type: "invoice" | "credit_note"; uuid: string; attempts: number; status: "queued" | "submitting"; xml: string | null; xml_sha256: string | null; document_number: string; issued_at: Date };

/**
 * Builds, validates and sends what the e-invoice queue holds.
 *
 * A plain interval, like the notification and payment sweeps. A document is
 * CLAIMED in one statement (`FOR UPDATE SKIP LOCKED`) by leasing it — pushing
 * its next attempt ten minutes out — so two API instances never take the same
 * one; the status only becomes `submitting` after the XML is stored, because a
 * sending document is frozen by the database and its content must be final
 * first. Nothing holds a transaction open across the provider's network call.
 *
 * A document that fails validation is `rejected`, not retried: nothing a retry
 * does would change it. Staff correct the data (customer address, product tax
 * category…), press Retry, and the document is rebuilt from the corrected rows.
 */
@Injectable()
export class EinvoiceSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EinvoiceSweepService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly db: TenantDatabase,
    private readonly providers: ProviderResolver,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    if (this.config.get("NODE_ENV", { infer: true }) === "test") return;
    this.timer = setInterval(() => void this.sweep(), SWEEP_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Returns how many documents were processed. Never throws: a failed sweep is logged and the next one tries again. */
  async sweep(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const due = await this.db.runAsPlatformAdmin((tx) =>
        tx
          .selectDistinct({
            tenantId: schema.einvoiceDocuments.tenantId,
            isActive: schema.tenants.isActive,
            deletedAt: schema.tenants.deletedAt,
            suspendedAt: schema.tenants.suspendedAt,
            planId: schema.tenants.planId,
            trialEndsAt: schema.tenants.trialEndsAt,
          })
          .from(schema.einvoiceDocuments)
          .innerJoin(schema.tenants, eq(schema.tenants.id, schema.einvoiceDocuments.tenantId))
          .where(
            sql`(${schema.einvoiceDocuments.status} = 'queued' AND ${schema.einvoiceDocuments.nextAttemptAt} <= now())
              OR (${schema.einvoiceDocuments.status} = 'submitting' AND ${schema.einvoiceDocuments.updatedAt} < now() - make_interval(secs => ${STUCK_SUBMITTING_MS / 1000}))`,
          )
          .limit(TENANT_LIMIT),
      );

      let processed = 0;
      for (const t of due) {
        // A suspended tenant or a lapsed trial sends nothing: the same answer the shop window gives.
        if (!t.isActive || t.deletedAt || t.suspendedAt) continue;
        if (trialStatus(t.planId, t.trialEndsAt, new Date()).expired) continue;
        processed += await this.processTenant(t.tenantId);
      }
      if (processed > 0) this.logger.log(`Processed ${processed} e-invoice document(s)`);
      return processed;
    } catch (error) {
      this.logger.error({ err: error }, "E-invoice sweep failed");
      return 0;
    } finally {
      this.running = false;
    }
  }

  private async processTenant(tenantId: string): Promise<number> {
    const claimed = await this.db.runAs(tenantId, async (tx) => {
      const tenant = await tx.query.tenants.findFirst({ columns: { settings: true } });
      if (!resolveTenantSettings(tenant?.settings).einvoice.enabled) return [] as Claimed[];

      const queued = await tx.execute<Claimed>(sql`
        UPDATE einvoice_documents
           SET attempts = attempts + 1, next_attempt_at = now() + make_interval(secs => ${LEASE_MS / 1000})
         WHERE id IN (
           SELECT id FROM einvoice_documents
            WHERE status = 'queued' AND next_attempt_at <= now()
            ORDER BY next_attempt_at
            LIMIT ${BATCH_PER_TENANT}
              FOR UPDATE SKIP LOCKED)
        RETURNING id, sale_id, doc_type, uuid, attempts, status, xml, xml_sha256, document_number, issued_at`);
      const stuck = await tx.execute<Claimed>(sql`
        UPDATE einvoice_documents
           SET attempts = attempts + 1
         WHERE id IN (
           SELECT id FROM einvoice_documents
            WHERE status = 'submitting' AND updated_at < now() - make_interval(secs => ${STUCK_SUBMITTING_MS / 1000})
            ORDER BY updated_at
            LIMIT ${BATCH_PER_TENANT}
              FOR UPDATE SKIP LOCKED)
        RETURNING id, sale_id, doc_type, uuid, attempts, status, xml, xml_sha256, document_number, issued_at`);
      return [...queued, ...stuck];
    });

    for (const row of claimed) {
      try {
        await this.process(tenantId, row);
      } catch (error) {
        // A bug must not wedge the queue or retry forever: bounded retries, then failed.
        this.logger.error({ err: error, documentId: row.id }, "E-invoice processing threw");
        await this.recordTransient(tenantId, row, "An unexpected error occurred while processing the document.");
      }
    }
    return claimed.length;
  }

  private async process(tenantId: string, row: Claimed): Promise<void> {
    // 1. Build and validate (fresh documents; a retry after a transient failure reuses what was already stored).
    let xml = row.xml;
    let sha = row.xml_sha256;
    if (row.status === "queued" && !xml) {
      const built = await this.db.runAs(tenantId, (tx) => this.build(tx, tenantId, row));
      if (!built) return;
      xml = built.xml;
      sha = built.sha;
    }
    if (!xml || !sha) {
      await this.recordTransient(tenantId, row, "The document has no stored XML to send.");
      return;
    }
    // A retry after a transient failure reuses the XML it already has (a send may have reached the provider, which de-duplicates on the uuid), so it only needs freezing again.
    if (row.status === "queued" && row.xml) {
      const frozen = await this.db.runAs(tenantId, async (tx) => {
        const table = schema.einvoiceDocuments;
        const moved = await tx.update(table).set({ status: "submitting" }).where(sql`${table.id} = ${row.id} AND ${table.status} = 'queued'`).returning({ id: table.id });
        if (moved.length > 0) await recordEvent(tx, { tenantId, documentId: row.id, status: "submitting", message: "Sending again." });
        return moved.length > 0;
      });
      if (!frozen) return;
    }

    // 2. Pick the provider and send — no transaction open across the call.
    const { settings, provider } = await this.db.runAs(tenantId, async (tx) => {
      const tenant = await tx.query.tenants.findFirst({ columns: { settings: true } });
      const s = resolveTenantSettings(tenant?.settings).einvoice;
      return { settings: s, provider: await this.providers.resolve(tx, s) };
    });
    if (!provider.ok) {
      await this.fail(tenantId, row, provider.message);
      return;
    }

    const submission: AspSubmission = {
      uuid: row.uuid,
      docType: row.doc_type,
      documentNumber: row.document_number,
      issuedAt: new Date(row.issued_at).toISOString(),
      xml,
      xmlSha256: sha,
      sandbox: settings.mode !== "live",
    };
    const result = await provider.provider.submit(submission);

    // 3. Record the outcome. Guarded on `submitting`: a document someone else moved on is left alone.
    await this.db.runAs(tenantId, async (tx) => {
      const guard = sql`${schema.einvoiceDocuments.id} = ${row.id} AND ${schema.einvoiceDocuments.status} = 'submitting'`;
      const table = schema.einvoiceDocuments;
      if (result.ok) {
        const now = new Date();
        const updated = await tx
          .update(table)
          .set({ status: result.status, providerRef: result.providerRef, submittedAt: now, mode: settings.mode, lastError: null, issues: [], ...(result.status === "delivered" ? { deliveredAt: now } : {}) })
          .where(guard)
          .returning({ id: table.id });
        if (updated.length === 0) return;
        await recordEvent(tx, { tenantId, documentId: row.id, status: "submitted", message: `Accepted by the provider (${provider.provider.name}).`, detail: { providerRef: result.providerRef, mode: settings.mode } });
        if (result.status === "delivered") await recordEvent(tx, { tenantId, documentId: row.id, status: "delivered", message: "Delivery confirmed." });
        return;
      }
      if (result.kind === "rejected") {
        const issues: EinvoiceIssue[] = result.errors.map((e) => ({ code: e.code, message: e.message, severity: "error" }));
        await tx.update(table).set({ status: "rejected", issues, lastError: summary(issues), ...(result.providerRef ? { providerRef: result.providerRef } : {}) }).where(guard);
        await recordEvent(tx, { tenantId, documentId: row.id, status: "rejected", message: `Rejected by the provider: ${summary(issues)}` });
        return;
      }
      if (result.kind === "permanent") {
        await tx.update(table).set({ status: "failed", lastError: result.message }).where(guard);
        await recordEvent(tx, { tenantId, documentId: row.id, status: "failed", message: result.message });
        return;
      }
      await this.applyTransient(tx, tenantId, row, result.message, guard);
    });
  }

  /** Validate, render and store; leaves the row `submitting` (frozen) on success, `rejected` on a validation error. Null = stop. */
  private async build(tx: Transaction, tenantId: string, row: Claimed): Promise<{ xml: string; sha: string } | null> {
    const snapshot = await loadSnapshot(tx, { saleId: row.sale_id, uuid: row.uuid, docType: row.doc_type });
    const table = schema.einvoiceDocuments;
    if (!snapshot) {
      await tx.update(table).set({ status: "failed", lastError: "The sale this document reports no longer exists." }).where(eq(table.id, row.id));
      await recordEvent(tx, { tenantId, documentId: row.id, status: "failed", message: "The sale this document reports no longer exists." });
      return null;
    }

    const issues = validateSnapshot(snapshot);
    const errors = issues.filter((i) => i.severity === "error");
    if (errors.length > 0) {
      await tx.update(table).set({ status: "rejected", issues, snapshot: snapshot as unknown as Record<string, unknown>, lastError: summary(errors) }).where(eq(table.id, row.id));
      await recordEvent(tx, { tenantId, documentId: row.id, status: "rejected", message: `Not sent: ${errors.length} problem${errors.length === 1 ? "" : "s"} to fix. ${summary(errors)}`, detail: { codes: errors.map((e) => e.code) } });
      return null;
    }

    const xml = renderPintAeXml(snapshot);
    const sha = createHash("sha256").update(xml).digest("hex");
    const stored = await tx
      .update(table)
      .set({ status: "submitting", snapshot: snapshot as unknown as Record<string, unknown>, xml, xmlSha256: sha, pintVersion: PINT_AE_VERSION, issues, lastError: null })
      .where(sql`${table.id} = ${row.id} AND ${table.status} = 'queued'`)
      .returning({ id: table.id });
    if (stored.length === 0) return null;
    await recordEvent(tx, { tenantId, documentId: row.id, status: "submitting", message: "Built and validated; sending.", detail: { pintVersion: PINT_AE_VERSION, xmlSha256: sha } });
    return { xml, sha };
  }

  private async fail(tenantId: string, row: Claimed, message: string): Promise<void> {
    await this.db.runAs(tenantId, async (tx) => {
      const table = schema.einvoiceDocuments;
      await tx.update(table).set({ status: "failed", lastError: message }).where(sql`${table.id} = ${row.id} AND ${table.status} IN ('submitting', 'queued')`);
      await recordEvent(tx, { tenantId, documentId: row.id, status: "failed", message });
    });
  }

  private async recordTransient(tenantId: string, row: Claimed, message: string): Promise<void> {
    await this.db.runAs(tenantId, async (tx) => {
      const table = schema.einvoiceDocuments;
      await this.applyTransient(tx, tenantId, row, message, sql`${table.id} = ${row.id} AND ${table.status} IN ('submitting', 'queued')`);
    });
  }

  private async applyTransient(tx: Transaction, tenantId: string, row: Claimed, message: string, where: ReturnType<typeof sql>): Promise<void> {
    const table = schema.einvoiceDocuments;
    const next = afterTransientFailure(row.attempts);
    if (next.status === "failed") {
      await tx.update(table).set({ status: "failed", lastError: message }).where(where);
      await recordEvent(tx, { tenantId, documentId: row.id, status: "failed", message: `${message} Giving up after ${row.attempts} attempts; press Retry once the cause is fixed.` });
    } else {
      await tx.update(table).set({ status: "queued", lastError: message, nextAttemptAt: next.nextAttemptAt }).where(where);
      await recordEvent(tx, { tenantId, documentId: row.id, status: "queued", message: `${message} Will retry.`, detail: { attempt: row.attempts, nextAttemptAt: next.nextAttemptAt.toISOString() } });
    }
  }
}

/** The first few problems on one line, for a list view and a log message. */
export function summary(issues: { message: string }[]): string {
  const text = issues.slice(0, 3).map((i) => i.message).join(" ");
  return (issues.length > 3 ? `${text} (and ${issues.length - 3} more)` : text).slice(0, 480);
}
