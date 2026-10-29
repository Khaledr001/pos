import { and, count, desc, eq, ilike, inArray, or, schema, sql, type SQL, type Transaction } from "@devsfleet/db";
import { EINVOICE_STATUSES, type EinvoiceDocumentDetail, type EinvoiceDocumentPage, type EinvoiceDocumentRow, type EinvoiceStatus, type EinvoiceIssue } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES, Money } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { assertBranchInScope, branchScope } from "../../common/context/branch-scope.js";
import { containsPattern } from "../../common/db/list-query.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import { RETRYABLE } from "./delivery-policy.js";
import type { ListDocumentsDto } from "./dto.js";
import { HELD_UNTIL, isHeld, recordEvent } from "./events.js";

type Row = {
  id: string;
  saleId: string;
  documentNumber: string;
  docType: EinvoiceDocumentRow["docType"];
  status: EinvoiceStatus;
  uuid: string;
  total: string;
  currency: string;
  issuedAt: Date;
  submittedAt: Date | null;
  deliveredAt: Date | null;
  attempts: number;
  lastError: string | null;
  company: string | null;
  customerName: string | null;
};

const toRow = (r: Row): EinvoiceDocumentRow => ({
  id: r.id,
  saleId: r.saleId,
  documentNumber: r.documentNumber,
  docType: r.docType,
  status: r.status,
  uuid: r.uuid,
  buyerName: r.company?.trim() || r.customerName || null,
  total: Money.toDecimalString(Money.abs(Money.toMinor(r.total)), 2),
  currency: r.currency,
  issuedAt: r.issuedAt.toISOString(),
  submittedAt: r.submittedAt?.toISOString() ?? null,
  deliveredAt: r.deliveredAt?.toISOString() ?? null,
  attempts: r.attempts,
  lastError: r.lastError,
});

/** The e-invoice register: what was queued, sent, rejected, and why. */
@Injectable()
export class EinvoiceDocumentsService {
  constructor(private readonly db: TenantDatabase) {}

  async list(query: ListDocumentsDto): Promise<EinvoiceDocumentPage> {
    const t = schema.einvoiceDocuments;
    return this.db.run(async (tx) => {
      const scope = branchScope();
      const pattern = containsPattern(query.q);
      const shared: (SQL | undefined)[] = [
        query.type ? eq(t.docType, query.type) : undefined,
        scope ? inArray(t.branchId, scope) : undefined,
        pattern ? or(ilike(t.documentNumber, pattern), ilike(schema.customers.name, pattern), ilike(schema.customers.company, pattern)) : undefined,
      ];
      const base = () =>
        tx.select({ n: count() }).from(t).innerJoin(schema.sales, eq(schema.sales.id, t.saleId)).leftJoin(schema.customers, eq(schema.customers.id, schema.sales.customerId));

      const [rows, totalRow, grouped] = await Promise.all([
        tx
          .select({
            id: t.id,
            saleId: t.saleId,
            documentNumber: t.documentNumber,
            docType: t.docType,
            status: t.status,
            uuid: t.uuid,
            total: schema.sales.total,
            currency: schema.sales.currency,
            issuedAt: t.issuedAt,
            submittedAt: t.submittedAt,
            deliveredAt: t.deliveredAt,
            attempts: t.attempts,
            lastError: t.lastError,
            company: schema.customers.company,
            customerName: schema.customers.name,
          })
          .from(t)
          .innerJoin(schema.sales, eq(schema.sales.id, t.saleId))
          .leftJoin(schema.customers, eq(schema.customers.id, schema.sales.customerId))
          .where(and(...shared, query.status ? eq(t.status, query.status) : undefined))
          .orderBy(desc(t.issuedAt), desc(t.createdAt))
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize),
        base().where(and(...shared, query.status ? eq(t.status, query.status) : undefined)),
        tx
          .select({ status: t.status, n: count() })
          .from(t)
          .innerJoin(schema.sales, eq(schema.sales.id, t.saleId))
          .leftJoin(schema.customers, eq(schema.customers.id, schema.sales.customerId))
          .where(and(...shared))
          .groupBy(t.status),
      ]);

      const counts = Object.fromEntries(EINVOICE_STATUSES.map((s) => [s, 0])) as Record<EinvoiceStatus, number>;
      for (const g of grouped) counts[g.status] = Number(g.n);
      return { total: Number(totalRow[0]?.n ?? 0), page: query.page, items: (rows as Row[]).map(toRow), counts };
    });
  }

  async get(id: string): Promise<EinvoiceDocumentDetail> {
    return this.db.run(async (tx) => {
      const doc = await this.load(tx, id);
      const [events, row] = await Promise.all([
        tx.query.einvoiceEvents.findMany({ where: (t, { eq: e }) => e(t.documentId, id), orderBy: (t, { asc }) => asc(t.createdAt) }),
        this.summaryRow(tx, id),
      ]);
      return {
        ...row,
        issues: doc.issues as EinvoiceIssue[],
        events: events.map((e) => ({ at: e.createdAt.toISOString(), status: e.status, message: e.message })),
        providerRef: doc.providerRef,
        xmlSha256: doc.xmlSha256,
        pintVersion: doc.pintVersion,
      };
    });
  }

  async xml(id: string): Promise<{ filename: string; body: string }> {
    return this.db.run(async (tx) => {
      const doc = await this.load(tx, id);
      if (!doc.xml) throw new AppError(ERROR_CODES.NOT_FOUND, "This document has not been built yet.");
      return { filename: `${doc.documentNumber.replace(/[^A-Za-z0-9._-]/g, "_")}.xml`, body: doc.xml };
    });
  }

  /** A rejected or failed document goes back in the queue and is REBUILT from the rows as they stand now. */
  async retry(id: string): Promise<EinvoiceDocumentRow> {
    return this.db.run(async (tx) => {
      const doc = await this.load(tx, id);
      if (!(RETRYABLE as readonly string[]).includes(doc.status)) {
        throw new AppError(ERROR_CODES.CONFLICT, `A ${doc.status} document cannot be retried.`);
      }
      const t = schema.einvoiceDocuments;
      await tx
        .update(t)
        .set({ status: "queued", attempts: 0, nextAttemptAt: new Date(), lastError: null, issues: [], snapshot: null, xml: null, xmlSha256: null, pintVersion: null })
        .where(and(eq(t.id, id), inArray(t.status, ["rejected", "failed"])));
      await recordEvent(tx, { tenantId: doc.tenantId, documentId: id, status: "queued", message: "Retried: queued to be rebuilt from the current data." });
      return this.summaryRow(tx, id);
    });
  }

  /** Release a document held for review. */
  async send(id: string): Promise<EinvoiceDocumentRow> {
    return this.db.run(async (tx) => {
      const doc = await this.load(tx, id);
      if (doc.status !== "queued" || !isHeld(doc.nextAttemptAt)) {
        throw new AppError(ERROR_CODES.CONFLICT, "Only a document held for review can be sent this way.");
      }
      const t = schema.einvoiceDocuments;
      await tx.update(t).set({ nextAttemptAt: new Date(), issues: [] }).where(and(eq(t.id, id), eq(t.status, "queued"), sql`${t.nextAttemptAt} >= ${HELD_UNTIL.toISOString()}::timestamptz`));
      await recordEvent(tx, { tenantId: doc.tenantId, documentId: id, status: "queued", message: "Released for sending." });
      return this.summaryRow(tx, id);
    });
  }

  private async load(tx: Transaction, id: string) {
    const doc = await tx.query.einvoiceDocuments.findFirst({ where: (t, { eq: e }) => e(t.id, id) });
    if (!doc) throw new AppError(ERROR_CODES.NOT_FOUND, "E-invoice document not found.");
    assertBranchInScope(doc.branchId);
    return doc;
  }

  private async summaryRow(tx: Transaction, id: string): Promise<EinvoiceDocumentRow> {
    const t = schema.einvoiceDocuments;
    const [row] = await tx
      .select({
        id: t.id,
        saleId: t.saleId,
        documentNumber: t.documentNumber,
        docType: t.docType,
        status: t.status,
        uuid: t.uuid,
        total: schema.sales.total,
        currency: schema.sales.currency,
        issuedAt: t.issuedAt,
        submittedAt: t.submittedAt,
        deliveredAt: t.deliveredAt,
        attempts: t.attempts,
        lastError: t.lastError,
        company: schema.customers.company,
        customerName: schema.customers.name,
      })
      .from(t)
      .innerJoin(schema.sales, eq(schema.sales.id, t.saleId))
      .leftJoin(schema.customers, eq(schema.customers.id, schema.sales.customerId))
      .where(eq(t.id, id));
    if (!row) throw new AppError(ERROR_CODES.NOT_FOUND, "E-invoice document not found.");
    return toRow(row as Row);
  }
}
