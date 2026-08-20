import { and, count, desc, eq, gte, inArray, lte, schema, sql } from "@devsfleet/db";
import { resolveTenantSettings } from "@devsfleet/shared-types";
import {
  AppError,
  ERROR_CODES,
  Money,
  calculateDocument,
  formatDocumentNumber,
  sequenceKey,
} from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { assertBranchInScope, requireBranchId } from "../../common/context/branch-scope.js";
import { RequestContext } from "../../common/context/request-context.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import { OrdersService } from "../orders/orders.service.js";
import { PriceResolverService } from "../pricing/price-resolver.service.js";
import { SalesService } from "../sales/sales.service.js";
import { StorageService } from "../storage/storage.service.js";
import type {
  ConvertQuotationDto,
  ConvertQuotationToOrderDto,
  CreateQuotationDto,
  ListQuotationsDto,
} from "./dto.js";
import { renderQuotationPdf } from "./quotation-pdf.js";

type Transaction = Parameters<Parameters<TenantDatabase["run"]>[0]>[0];

/**
 * Quotations.
 *
 * A price promise with an expiry date, and nothing more: a quotation reserves
 * no stock and moves no money. Reserving would let a quote nobody accepts make
 * goods unsellable to the customer standing at the counter, and a builder who
 * collects five quotes would empty a shop that has sold nothing.
 *
 * Prices are SNAPSHOTTED at issue. Re-resolving them on read would quietly
 * reprice a document the customer is holding a printout of.
 */
@Injectable()
export class QuotationsService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly prices: PriceResolverService,
    private readonly sales: SalesService,
    private readonly orders: OrdersService,
    private readonly storage: StorageService,
  ) {}

  async create(dto: CreateQuotationDto): Promise<unknown> {
    const tenantId = RequestContext.requireTenantId();
    const user = RequestContext.requireUser();
    const branchId = requireBranchId(dto.branchId);

    return this.db.run(async (tx) => {
      const settings = await this.settings(tx);

      const resolved = await this.prices.resolveMany(tx, {
        variantIds: dto.lines.map((line) => line.variantId),
        customerId: dto.customerId ?? null,
        quantities: Object.fromEntries(
          dto.lines.map((line) => [line.variantId, String(line.quantity)]),
        ),
      });
      const priceByVariant = new Map(resolved.map((price) => [price.variantId, price]));

      const variants = await this.loadVariants(
        tx,
        dto.lines.map((line) => line.variantId),
      );

      const lines = dto.lines.map((line) => {
        const price = priceByVariant.get(line.variantId);
        if (!price) {
          throw new AppError(
            ERROR_CODES.NO_PRICE_FOR_PRODUCT,
            `No price is set for ${variants.get(line.variantId)?.sku ?? line.variantId}`,
          );
        }

        return {
          ...line,
          unitPrice: line.unitPrice ?? price.unitPrice,
          taxPercent: variants.get(line.variantId)!.taxRate ?? String(settings.tax.defaultRate),
        };
      });

      const totals = calculateDocument({
        lines: lines.map((line) => ({
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          ...(line.discountPercent ? { discountPercent: line.discountPercent } : {}),
          taxPercent: line.taxPercent,
        })),
        taxMode: settings.tax.mode,
        ...(dto.documentDiscountPercent
          ? { documentDiscountPercent: dto.documentDiscountPercent }
          : {}),
        decimals: settings.currency.decimals,
      });

      const quotationNumber = await this.nextNumber(tx, branchId);

      const [quotation] = await tx
        .insert(schema.quotations)
        .values({
          tenantId,
          branchId,
          quotationNumber,
          customerId: dto.customerId ?? null,
          source: "manual",
          status: "draft",
          currency: settings.currency.base,
          taxMode: settings.tax.mode,
          subtotal: Money.toDecimalString(totals.subtotal, 4),
          discountAmount: Money.toDecimalString(totals.discountAmount, 4),
          taxAmount: Money.toDecimalString(totals.taxAmount, 4),
          total: Money.toDecimalString(totals.total, 4),
          validUntil: dto.validUntil ?? defaultValidUntil(),
          ...(dto.notes ? { notes: dto.notes } : {}),
          createdBy: user.id,
          ...(dto.localId ? { localId: dto.localId } : {}),
          ...(dto.occurredAt ? { createdAt: new Date(dto.occurredAt), updatedAt: new Date(dto.occurredAt) } : {}),
        })
        .returning();

      if (!quotation) throw new AppError(ERROR_CODES.INTERNAL_ERROR, "Could not create the quotation");

      await tx.insert(schema.quotationItems).values(
        lines.map((line, index) => {
          const variant = variants.get(line.variantId)!;
          const computed = totals.lines[index]!;

          return {
            tenantId,
            quotationId: quotation.id,
            variantId: line.variantId,
            productName: variant.productName,
            variantName: variant.variantName ?? "Default",
            productSku: variant.sku,
            quantity: String(line.quantity),
            unitPrice: line.unitPrice,
            discountPercent: String(line.discountPercent ?? 0),
            discountAmount: Money.toDecimalString(computed.discount, 4),
            taxPercent: line.taxPercent,
            taxAmount: Money.toDecimalString(computed.tax, 4),
            lineSubtotal: Money.toDecimalString(computed.net, 4),
            total: Money.toDecimalString(computed.total, 4),
            sortOrder: index,
          };
        }),
      );

      return this.findById(quotation.id, tx);
    });
  }

  /** Mark it sent. Records when, which is what an expiry is measured from. */
  async send(id: string): Promise<unknown> {
    return this.db.run(async (tx) => {
      const quotation = await this.require(tx, id);
      if (quotation.status !== "draft") {
        throw new AppError(ERROR_CODES.CONFLICT, `This quotation is already ${quotation.status}`);
      }

      await tx
        .update(schema.quotations)
        .set({ status: "sent", sentAt: new Date() })
        .where(eq(schema.quotations.id, id));

      return this.findById(id, tx);
    });
  }

  /**
   * Turn an accepted quotation into a sale.
   *
   * The quoted prices are passed through as explicit unit prices, so the sale
   * charges what was promised even if the price list has moved since. The stock
   * check happens now, for the first time — which is exactly why an expired
   * quotation is refused rather than quietly honoured.
   */
  async convert(id: string, dto: ConvertQuotationDto): Promise<unknown> {
    const quotation = await this.db.run(async (tx) => {
      const found = await this.require(tx, id);

      if (found.status === "converted") {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          "This quotation has already been converted to a sale.",
        );
      }
      if (found.status === "cancelled") {
        throw new AppError(ERROR_CODES.CONFLICT, "This quotation was cancelled.");
      }

      if (found.validUntil && found.validUntil < today()) {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          `This quotation expired on ${found.validUntil}. Raise a new one at today's prices.`,
        );
      }

      const items = await tx.query.quotationItems.findMany({
        where: (t, { eq: e }) => e(t.quotationId, id),
        orderBy: (t, { asc: a }) => a(t.sortOrder),
      });

      return { ...found, items };
    });

    /**
     * The sale is created in its OWN transaction, through the normal service.
     *
     * That is deliberate: a quotation converting must go through the same
     * stock, credit and ABAC checks as anything else rung up at the counter.
     * A second path into `sales` is a second set of rules to keep in step.
     */
    const sale = (await this.sales.create({
      branchId: dto.branchId ?? quotation.branchId,
      customerId: quotation.customerId,
      cashSessionId: dto.cashSessionId ?? null,
      source: "pos",
      lines: quotation.items.map((item) => ({
        variantId: item.variantId,
        quantity: Number(item.quantity),
        unitPrice: item.unitPrice,
        ...(Number(item.discountPercent) > 0
          ? { discountPercent: Number(item.discountPercent) }
          : {}),
      })),
      payments: dto.payments.map((payment) => ({
        method: payment.method as never,
        amount: payment.amount,
        ...(payment.reference ? { reference: payment.reference } : {}),
      })),
    })) as { id: string; saleNumber: string };

    await this.db.run(async (tx) => {
      await tx
        .update(schema.quotations)
        .set({
          status: "converted",
          convertedAt: new Date(),
          convertedToOrderId: sale.id,
        })
        .where(eq(schema.quotations.id, id));
    });

    return sale;
  }

  /**
   * Turn an accepted quotation into a COMMITMENT rather than an immediate
   * sale: an order, reserving nothing yet either, until it is confirmed —
   * for the customer who wants to lock in today's price and pick up the
   * goods over the coming days rather than paying right now.
   *
   * `quotations.convertedToOrderId` — despite its name — has always held the
   * id of the SALE `convert()` produces, because that was the only
   * conversion path this column's name ever anticipated. This is the first
   * path where it holds what it says.
   */
  async convertToOrder(id: string, dto: ConvertQuotationToOrderDto): Promise<unknown> {
    const quotation = await this.db.run(async (tx) => {
      const found = await this.require(tx, id);

      if (found.status === "converted") {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          "This quotation has already been converted.",
        );
      }
      if (found.status === "cancelled") {
        throw new AppError(ERROR_CODES.CONFLICT, "This quotation was cancelled.");
      }
      if (found.validUntil && found.validUntil < today()) {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          `This quotation expired on ${found.validUntil}. Raise a new one at today's prices.`,
        );
      }

      const items = await tx.query.quotationItems.findMany({
        where: (t, { eq: e }) => e(t.quotationId, id),
        orderBy: (t, { asc: a }) => a(t.sortOrder),
      });

      return { ...found, items };
    });

    // Created through the normal service, in its own transaction — an order
    // from a quotation needs no different price resolution than one rung up
    // directly, and a second path into `orders` is a second set of rules.
    const order = (await this.orders.create({
      branchId: dto.branchId ?? quotation.branchId,
      customerId: quotation.customerId,
      quotationId: quotation.id,
      lines: quotation.items.map((item) => ({
        variantId: item.variantId,
        quantity: Number(item.quantity),
        unitPrice: item.unitPrice,
        ...(Number(item.discountPercent) > 0
          ? { discountPercent: Number(item.discountPercent) }
          : {}),
      })),
      ...(dto.expectedReadyAt ? { expectedReadyAt: dto.expectedReadyAt } : {}),
    })) as { id: string };

    await this.db.run(async (tx) => {
      await tx
        .update(schema.quotations)
        .set({ status: "converted", convertedAt: new Date(), convertedToOrderId: order.id })
        .where(eq(schema.quotations.id, id));
    });

    return order;
  }

  async cancel(id: string): Promise<unknown> {
    return this.db.run(async (tx) => {
      const quotation = await this.require(tx, id);
      if (quotation.status === "converted") {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          "This quotation became a sale. Void the sale instead.",
        );
      }

      await tx
        .update(schema.quotations)
        .set({ status: "cancelled" })
        .where(eq(schema.quotations.id, id));

      return this.findById(id, tx);
    });
  }

  async findById(id: string, existing?: Transaction): Promise<unknown> {
    const read = async (tx: Transaction) => {
      const quotation = await this.require(tx, id);

      const items = await tx.query.quotationItems.findMany({
        where: (t, { eq: e }) => e(t.quotationId, id),
        orderBy: (t, { asc: a }) => a(t.sortOrder),
      });

      const customer = quotation.customerId
        ? await tx.query.customers.findFirst({
            where: (t, { eq: e }) => e(t.id, quotation.customerId!),
            columns: { id: true, name: true, company: true, phone: true, trn: true },
          })
        : null;

      return {
        ...quotation,
        // Derived, not stored: a quotation that quietly flipped to `expired` in
        // the database would need a job to run, and a job that does not run
        // leaves stale documents looking live.
        expired: Boolean(quotation.validUntil && quotation.validUntil < today()),
        customer,
        items,
      };
    };

    return existing ? read(existing) : this.db.run(read);
  }

  /**
   * Render, upload, and record the PDF for one quotation — regenerated on
   * every call rather than served from cache, since `pdfUrl` only marks that
   * one has ever existed, not that the quotation has not changed since.
   */
  async generatePdf(id: string): Promise<{ pdfUrl: string }> {
    const tenantId = RequestContext.requireTenantId();

    const quotation = (await this.findById(id)) as {
      quotationNumber: string;
      currency: string;
      createdAt: Date;
      validUntil: string | null;
      notes: string | null;
      subtotal: string;
      discountAmount: string;
      taxAmount: string;
      total: string;
      customer: { name: string; company: string | null; phone: string | null } | null;
      items: Array<{
        productName: string;
        variantName: string;
        productSku: string;
        quantity: string;
        unitPrice: string;
        discountPercent: string;
        taxPercent: string;
        total: string;
      }>;
    };

    const tenant = await this.db.run((tx) =>
      tx.query.tenants.findFirst({ columns: { name: true } }),
    );

    const buffer = await renderQuotationPdf({
      tenantName: tenant?.name ?? "",
      quotationNumber: quotation.quotationNumber,
      currency: quotation.currency,
      createdAt: quotation.createdAt,
      validUntil: quotation.validUntil,
      customer: quotation.customer,
      items: quotation.items,
      subtotal: quotation.subtotal,
      discountAmount: quotation.discountAmount,
      taxAmount: quotation.taxAmount,
      total: quotation.total,
      notes: quotation.notes,
    });

    const pdfUrl = await this.storage.upload(
      `${tenantId}/quotations/${quotation.quotationNumber}.pdf`,
      buffer,
      "application/pdf",
    );

    await this.db.run((tx) =>
      tx.update(schema.quotations).set({ pdfUrl }).where(eq(schema.quotations.id, id)),
    );

    return { pdfUrl };
  }

  async list(query: ListQuotationsDto): Promise<{ items: unknown[]; total: number }> {
    if (query.branchId) assertBranchInScope(query.branchId);

    return this.db.run(async (tx) => {
      const where = and(
        query.branchId ? eq(schema.quotations.branchId, query.branchId) : undefined,
        query.customerId ? eq(schema.quotations.customerId, query.customerId) : undefined,
        query.status ? eq(schema.quotations.status, query.status) : undefined,
        query.from
          ? gte(schema.quotations.createdAt, new Date(`${query.from}T00:00:00Z`))
          : undefined,
        query.to
          ? lte(schema.quotations.createdAt, new Date(`${query.to}T23:59:59.999Z`))
          : undefined,
      );

      const [total] = await tx.select({ value: count() }).from(schema.quotations).where(where);

      const items = await tx
        .select({
          id: schema.quotations.id,
          quotationNumber: schema.quotations.quotationNumber,
          status: schema.quotations.status,
          customerName: schema.customers.name,
          total: schema.quotations.total,
          validUntil: schema.quotations.validUntil,
          expired: sql<boolean>`${schema.quotations.validUntil} < current_date`,
          createdAt: schema.quotations.createdAt,
        })
        .from(schema.quotations)
        .leftJoin(schema.customers, eq(schema.quotations.customerId, schema.customers.id))
        .where(where)
        .orderBy(desc(schema.quotations.createdAt))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);

      return { items, total: total?.value ?? 0 };
    });
  }

  // ---------------------------------------------------------------------------

  private async require(tx: Transaction, id: string) {
    const quotation = await tx.query.quotations.findFirst({
      where: (t, { eq: e }) => e(t.id, id),
    });
    if (!quotation) throw new AppError(ERROR_CODES.NOT_FOUND, `Quotation ${id} not found`);
    assertBranchInScope(quotation.branchId);
    return quotation;
  }

  private async loadVariants(tx: Transaction, variantIds: string[]) {
    const rows = await tx
      .select({
        id: schema.productVariants.id,
        sku: schema.productVariants.sku,
        variantName: schema.productVariants.variantName,
        productName: schema.products.name,
        taxRate: schema.products.taxRate,
      })
      .from(schema.productVariants)
      .innerJoin(schema.products, eq(schema.productVariants.productId, schema.products.id))
      .where(inArray(schema.productVariants.id, [...new Set(variantIds)]));

    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const id of variantIds) {
      if (!byId.has(id)) {
        throw new AppError(ERROR_CODES.PRODUCT_NOT_FOUND, `Product variant ${id} not found`);
      }
    }
    return byId;
  }

  private async settings(tx: Transaction) {
    const tenant = await tx.query.tenants.findFirst({ columns: { settings: true } });
    return resolveTenantSettings(tenant?.settings);
  }

  private async nextNumber(tx: Transaction, branchId: string): Promise<string> {
    const tenantId = RequestContext.requireTenantId();
    const year = new Date().getFullYear();

    const branch = await tx.query.branches.findFirst({
      where: (t, { eq: e }) => e(t.id, branchId),
      columns: { code: true },
    });

    const [seq] = await tx.execute<{ next_document_number: number }>(
      sql`SELECT next_document_number(${tenantId}::uuid, ${sequenceKey("quotation", year, branch?.code ?? null)})`,
    );

    return formatDocumentNumber({
      kind: "quotation",
      year,
      sequence: Number((seq as { next_document_number?: number })?.next_document_number ?? 1),
      ...(branch?.code ? { branchCode: branch.code } : {}),
    });
  }
}

function today(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

/** Thirty days. Long enough for a builder to decide, short enough to reprice. */
function defaultValidUntil(): string {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return date.toISOString().slice(0, 10);
}
