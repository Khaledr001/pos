import { eq, schema, type Transaction } from "@devsfleet/db";
import type { EinvoiceDocType } from "@devsfleet/shared-types";
import { buildSnapshot, type SnapshotSource } from "./pint-ae/snapshot.js";
import type { EinvoiceSnapshot } from "./pint-ae/snapshot-types.js";

type DocumentRef = { saleId: string; uuid: string; docType: EinvoiceDocType };

/** Reads everything a document is built from, as the rows stand NOW. Frozen into the snapshot only once the document is sent. */
export async function loadSnapshotSource(tx: Transaction, doc: DocumentRef): Promise<SnapshotSource | null> {
  const sale = await tx.query.sales.findFirst({ where: (t, { eq: e }) => e(t.id, doc.saleId) });
  if (!sale) return null;

  const [items, payments, tenant, customer, original] = await Promise.all([
    tx.select().from(schema.saleItems).where(eq(schema.saleItems.saleId, sale.id)).orderBy(schema.saleItems.sortOrder),
    tx.select({ method: schema.payments.method, amount: schema.payments.amount }).from(schema.payments).where(eq(schema.payments.saleId, sale.id)),
    tx.query.tenants.findFirst({ columns: { name: true, settings: true } }),
    sale.customerId ? tx.query.customers.findFirst({ where: (t, { eq: e }) => e(t.id, sale.customerId!) }) : Promise.resolve(undefined),
    sale.returnOfSaleId
      ? tx.query.sales.findFirst({ where: (t, { eq: e }) => e(t.id, sale.returnOfSaleId!), columns: { saleNumber: true, occurredAt: true } })
      : Promise.resolve(undefined),
  ]);
  if (!tenant) return null;

  return {
    docType: doc.docType,
    uuid: doc.uuid,
    sale: {
      saleNumber: sale.saleNumber,
      occurredAt: sale.occurredAt,
      currency: sale.currency,
      exchangeRate: sale.exchangeRate,
      taxMode: sale.taxMode === "inclusive" ? "inclusive" : "exclusive",
      subtotal: sale.subtotal,
      taxAmount: sale.taxAmount,
      total: sale.total,
      dueAmount: sale.dueAmount,
      creditReason: sale.creditReason ?? null,
    },
    lines: items.map((i) => ({
      sortOrder: i.sortOrder,
      productName: i.productName,
      variantName: i.variantName,
      productSku: i.productSku,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      taxPercent: i.taxPercent,
      taxAmount: i.taxAmount,
      lineSubtotal: i.lineSubtotal,
      taxCategory: i.taxCategory,
      taxExemptionCode: i.taxExemptionCode ?? null,
      unitCode: i.unitCode,
    })),
    payments,
    tenant: { name: tenant.name, settings: tenant.settings },
    customer: customer
      ? {
          name: customer.name,
          company: customer.company,
          trn: customer.trn,
          email: customer.email,
          phone: customer.phone,
          paymentTermDays: customer.paymentTermDays,
          addressLine1: customer.addressLine1,
          addressLine2: customer.addressLine2,
          addressCity: customer.addressCity,
          addressSubdivision: customer.addressSubdivision,
          addressPostalCode: customer.addressPostalCode,
          addressCountry: customer.addressCountry,
          einvoiceScheme: customer.einvoiceScheme,
          einvoiceEndpoint: customer.einvoiceEndpoint,
        }
      : null,
    original: original ? { saleNumber: original.saleNumber, occurredAt: original.occurredAt } : null,
  };
}

export async function loadSnapshot(tx: Transaction, doc: DocumentRef): Promise<EinvoiceSnapshot | null> {
  const source = await loadSnapshotSource(tx, doc);
  return source ? buildSnapshot(source) : null;
}
