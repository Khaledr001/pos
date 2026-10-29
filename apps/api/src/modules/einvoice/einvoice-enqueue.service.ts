import { eq, schema, type Transaction } from "@devsfleet/db";
import { EINVOICE_SENT_STATUSES, resolveTenantSettings, type EinvoiceStatus } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { decideEligibility } from "./eligibility.js";
import { HELD_ISSUE, HELD_UNTIL, recordEvent } from "./events.js";
import { localParts } from "./pint-ae/format.js";

/** A document that has not been sent can still be called off. */
const CANCELLABLE: readonly EinvoiceStatus[] = ["queued", "rejected", "failed"];

/**
 * The one door the sales code uses to hand a freshly issued invoice or credit
 * note to the e-invoicing pipeline.
 *
 * Called INSIDE the transaction that creates the sale or return, so the queue
 * row commits atomically with the document: a crash cannot issue an invoice that
 * is never reported, and a rollback cannot report one that was never issued.
 * Idempotent — one document per sale, enforced by a unique index.
 */
@Injectable()
export class EinvoiceEnqueueService {
  /** Queue the sale for e-invoicing if the business has it on and the sale qualifies. Never throws for "not eligible". */
  async enqueueForSale(tx: Transaction, saleId: string): Promise<void> {
    const sale = await tx.query.sales.findFirst({ where: (t, { eq: e }) => e(t.id, saleId) });
    if (!sale) return;
    const tenant = await tx.query.tenants.findFirst({ columns: { settings: true } });
    const settings = resolveTenantSettings(tenant?.settings);
    const isCredit = sale.returnOfSaleId !== null;

    const [originalDoc, customer] = await Promise.all([
      isCredit
        ? tx.query.einvoiceDocuments.findFirst({ where: (t, { eq: e }) => e(t.saleId, sale.returnOfSaleId!), columns: { status: true } })
        : Promise.resolve(undefined),
      !isCredit && sale.customerId ? tx.query.customers.findFirst({ where: (t, { eq: e }) => e(t.id, sale.customerId!), columns: { trn: true } }) : Promise.resolve(undefined),
    ]);

    const decision = decideEligibility({
      settings: settings.einvoice,
      issueDate: localParts(sale.occurredAt, settings.locale.timezone).date,
      voided: sale.voidedAt !== null,
      isCredit,
      originalHasDocument: !!originalDoc && originalDoc.status !== "cancelled",
      buyerTrn: customer?.trn ?? null,
      hasCustomer: !!customer,
    });
    if (!decision.eligible) return;

    const hold = !settings.einvoice.autoSubmit;
    const [created] = await tx
      .insert(schema.einvoiceDocuments)
      .values({
        tenantId: sale.tenantId,
        branchId: sale.branchId,
        saleId: sale.id,
        docType: isCredit ? "credit_note" : "invoice",
        documentNumber: sale.saleNumber,
        status: "queued",
        mode: settings.einvoice.mode,
        issuedAt: sale.occurredAt,
        ...(hold ? { nextAttemptAt: HELD_UNTIL, issues: [HELD_ISSUE] } : {}),
      })
      .onConflictDoNothing({ target: schema.einvoiceDocuments.saleId })
      .returning({ id: schema.einvoiceDocuments.id });
    if (!created) return;

    await recordEvent(tx, {
      tenantId: sale.tenantId,
      documentId: created.id,
      status: "queued",
      message: hold ? "Queued. Held for review: automatic sending is off." : "Queued for sending.",
    });
  }

  /** Has this sale's e-invoice already gone to the network? A sent invoice cannot be voided — it is corrected with a credit note. */
  async hasBeenSent(tx: Transaction, saleId: string): Promise<boolean> {
    const doc = await tx.query.einvoiceDocuments.findFirst({ where: (t, { eq: e }) => e(t.saleId, saleId), columns: { status: true } });
    return !!doc && (EINVOICE_SENT_STATUSES as readonly string[]).includes(doc.status);
  }

  /**
   * The sale is being voided. A document not yet sent is cancelled; one that has
   * been sent cannot be, and the void is refused — the correction is a credit note.
   */
  async cancelForSale(tx: Transaction, saleId: string, reason: string): Promise<void> {
    const doc = await tx.query.einvoiceDocuments.findFirst({ where: (t, { eq: e }) => e(t.saleId, saleId) });
    if (!doc || doc.status === "cancelled") return;

    if ((EINVOICE_SENT_STATUSES as readonly string[]).includes(doc.status)) {
      throw new AppError(
        ERROR_CODES.EINVOICE_ALREADY_SENT,
        `${doc.documentNumber} has been sent to the e-invoicing network and cannot be voided. Issue a credit note instead.`,
      );
    }
    if (!(CANCELLABLE as readonly string[]).includes(doc.status)) return;

    await tx.update(schema.einvoiceDocuments).set({ status: "cancelled", nextAttemptAt: HELD_UNTIL, lastError: null, issues: [] }).where(eq(schema.einvoiceDocuments.id, doc.id));
    await recordEvent(tx, { tenantId: doc.tenantId, documentId: doc.id, status: "cancelled", message: `Cancelled before sending: ${reason}`.slice(0, 500) });
  }
}
