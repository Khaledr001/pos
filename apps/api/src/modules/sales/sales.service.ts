import { and, desc, eq, schema, sql } from "@devsfleet/db";
import { resolveTenantSettings, type PaymentMethod } from "@devsfleet/shared-types";
import {
  AppError,
  ERROR_CODES,
  Money,
  calculateDocument,
  formatDocumentNumber,
  sequenceKey,
} from "@devsfleet/shared-utils";
import { Injectable, Logger } from "@nestjs/common";
import { RequestContext } from "../../common/context/request-context.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import { StockService } from "../inventory/stock.service.js";
import { PriceResolverService } from "../pricing/price-resolver.service.js";
import type { CreateSaleDto } from "./dto.js";

/**
 * Creating a sale — the most consequential write in the system.
 *
 * One transaction covers the sale, its lines, its payments, the stock ledger
 * and the customer's balance. Any of those succeeding without the others
 * produces a business that cannot be reconciled: stock gone with no invoice,
 * or an invoice for stock that never left.
 *
 * The order of the checks below is deliberate. Everything that can refuse the
 * sale runs BEFORE anything is written, so a rejection leaves no trace and no
 * half-applied movement.
 */
@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);

  constructor(
    private readonly db: TenantDatabase,
    private readonly stock: StockService,
    private readonly prices: PriceResolverService,
  ) {}

  async create(dto: CreateSaleDto): Promise<unknown> {
    const tenantId = RequestContext.requireTenantId();
    const user = RequestContext.requireUser();

    return this.db.run(async (tx) => {
      /**
       * IDEMPOTENCY, first.
       *
       * The POS mints `clientId` when the sale is rung up and resends it on
       * every push attempt. A terminal that times out and retries must not
       * create a second invoice — so a known id returns the original sale
       * rather than making another.
       */
      if (dto.clientId) {
        const existing = await tx.query.sales.findFirst({
          where: (t, { eq: e }) => e(t.clientId, dto.clientId!),
        });
        if (existing) {
          this.logger.log({ clientId: dto.clientId }, "Duplicate push — returning the original");
          return this.findById(existing.id, tx);
        }
      }

      const tenant = await tx.query.tenants.findFirst();
      const settings = resolveTenantSettings(tenant?.settings);

      // --- resolve prices -------------------------------------------------
      const resolved = await this.prices.resolveMany(tx, {
        variantIds: dto.lines.map((l) => l.variantId),
        customerId: dto.customerId ?? null,
        includeCost: true, // snapshotted onto the line, never returned to a cashier
      });
      const priceBy = new Map(resolved.map((p) => [p.variantId, p]));

      const variants = await tx
        .select({
          id: schema.productVariants.id,
          sku: schema.productVariants.sku,
          variantName: schema.productVariants.variantName,
          productName: schema.products.name,
          taxRate: schema.products.taxRate,
          isStockTracked: schema.products.isStockTracked,
        })
        .from(schema.productVariants)
        .innerJoin(schema.products, eq(schema.productVariants.productId, schema.products.id))
        .where(
          sql`${schema.productVariants.id} = ANY(${sql.raw(
            `ARRAY['${dto.lines.map((l) => l.variantId).join("','")}']::uuid[]`,
          )})`,
        );
      const variantBy = new Map(variants.map((v) => [v.id, v]));

      // --- validate every line before writing anything --------------------
      const canOverrideFloor = user.permissions.includes("*") ||
        user.permissions.includes("price:override_floor");
      const maxDiscount = Money.toMinor(user.abac.maxDiscountPercent);

      const lines = dto.lines.map((line) => {
        const variant = variantBy.get(line.variantId);
        if (!variant) {
          throw new AppError(
            ERROR_CODES.PRODUCT_NOT_FOUND,
            `Variant ${line.variantId} does not exist`,
          );
        }

        const price = priceBy.get(line.variantId);
        // An explicit unit price is an override; otherwise the ladder decides.
        const unitPrice = line.unitPrice ?? price?.unitPrice;
        if (!unitPrice) {
          throw new AppError(
            ERROR_CODES.NO_PRICE_FOR_PRODUCT,
            `${variant.productName} has no price. Set one before selling it.`,
          );
        }

        const discountPercent = String(line.discountPercent ?? 0);

        /**
         * ABAC: the discount ceiling.
         *
         * Re-checked here even though the POS greys out the control, because
         * the POS is a client and a client can be modified. A hidden button is
         * a courtesy; this is the control.
         */
        if (Money.toMinor(discountPercent) > maxDiscount) {
          throw new AppError(
            ERROR_CODES.DISCOUNT_EXCEEDS_LIMIT,
            `You may discount up to ${user.abac.maxDiscountPercent}%. This line is ${discountPercent}%.`,
            { line: variant.sku, requested: discountPercent, allowed: user.abac.maxDiscountPercent },
          );
        }

        // The floor is checked on the price AFTER discount — a 20% discount
        // off list lands in the same place as typing the discounted figure.
        const floor = this.prices.checkFloor({
          unitPrice,
          discountPercent,
          minSellingPrice: price?.minSellingPrice ?? null,
          canOverrideFloor,
        });
        if (!floor.allowed) {
          throw new AppError(
            ERROR_CODES.BELOW_FLOOR_PRICE,
            `${variant.productName} cannot be sold below ${floor.floor}. A manager must approve this.`,
            { line: variant.sku, effective: floor.effectivePrice, floor: floor.floor },
          );
        }

        return {
          ...line,
          variant,
          unitPrice,
          discountPercent,
          taxPercent: variant.taxRate ?? String(settings.tax.defaultRate),
          costPrice: price?.purchasePrice ?? null,
        };
      });

      // --- totals, from the shared engine ---------------------------------
      const totals = calculateDocument({
        taxMode: settings.tax.mode,
        decimals: settings.currency.decimals,
        ...(dto.documentDiscountPercent
          ? { documentDiscountPercent: String(dto.documentDiscountPercent) }
          : {}),
        lines: lines.map((l) => ({
          quantity: String(l.quantity),
          unitPrice: l.unitPrice,
          discountPercent: l.discountPercent,
          taxPercent: l.taxPercent,
        })),
      });

      /** ABAC: the per-sale ceiling. */
      if (user.abac.maxSaleAmount) {
        const ceiling = Money.toMinor(user.abac.maxSaleAmount);
        if (totals.total > ceiling) {
          throw new AppError(
            ERROR_CODES.AMOUNT_EXCEEDS_LIMIT,
            `This sale is ${Money.toDecimalString(totals.total, 2)}, above your ${user.abac.maxSaleAmount} limit.`,
          );
        }
      }

      // --- payment and credit ---------------------------------------------
      /**
       * Tendered is not the same as taken.
       *
       * A customer hands over 100 for a 5.78 basket; 94.22 goes straight back
       * as change. Recording the tender would book that change as revenue —
       * the drawer reads 94.22 over at close-out, the day's cash total is
       * wrong, and every VAT figure derived from it is wrong too.
       *
       * So each tender is ALLOCATED against what is still owed, and only the
       * allocated part becomes a payment row.
       */
      const tendered = (dto.payments ?? []).reduce<bigint>(
        (sum, p) => Money.add(sum, Money.toMinor(String(p.amount))),
        0n,
      );
      const paid = Money.min(tendered, totals.total);
      const due = Money.max(Money.subtract(totals.total, paid), 0n);
      const change = Money.max(Money.subtract(tendered, totals.total), 0n);

      if (Money.isPositive(due)) {
        // Unpaid means it goes on an account, and a walk-in has none.
        if (!dto.customerId) {
          throw new AppError(
            ERROR_CODES.VALIDATION_FAILED,
            "A partly paid sale must be attached to a customer.",
          );
        }

        const customer = await tx.query.customers.findFirst({
          where: (t, { eq: e }) => e(t.id, dto.customerId!),
        });
        if (!customer) throw new AppError(ERROR_CODES.CUSTOMER_NOT_FOUND, "Customer not found");

        if (customer.creditOnHold) {
          throw new AppError(
            ERROR_CODES.CREDIT_LIMIT_EXCEEDED,
            `${customer.name} is on credit hold.`,
          );
        }

        if (settings.sales.enforceCreditLimit) {
          const after = Money.add(Money.toMinor(customer.creditBalance), due);
          if (after > Money.toMinor(customer.creditLimit)) {
            throw new AppError(
              ERROR_CODES.CREDIT_LIMIT_EXCEEDED,
              `This would take ${customer.name} to ${Money.toDecimalString(after, 2)}, past their ${customer.creditLimit} limit.`,
              { limit: customer.creditLimit, balance: customer.creditBalance, due: Money.toDecimalString(due, 2) },
            );
          }
        }
      }

      // --- everything below WRITES ----------------------------------------

      const branch = await tx.query.branches.findFirst({
        where: (t, { eq: e }) => e(t.id, dto.branchId),
        columns: { code: true },
      });
      const year = new Date().getFullYear();
      const [seq] = await tx.execute<{ next_document_number: number }>(
        sql`SELECT next_document_number(${tenantId}::uuid, ${sequenceKey("sale", year, branch?.code ?? null)})`,
      );
      const saleNumber = formatDocumentNumber({
        kind: "sale",
        year,
        sequence: Number((seq as { next_document_number?: number })?.next_document_number ?? 1),
        ...(branch?.code ? { branchCode: branch.code } : {}),
      });

      const [sale] = await tx
        .insert(schema.sales)
        .values({
          tenantId,
          branchId: dto.branchId,
          saleNumber,
          customerId: dto.customerId ?? null,
          cashSessionId: dto.cashSessionId ?? null,
          source: dto.source ?? "pos",
          status: "completed",
          currency: settings.currency.base,
          taxMode: settings.tax.mode,
          subtotal: Money.toDecimalString(totals.subtotal, 4),
          discountAmount: Money.toDecimalString(totals.discountAmount, 4),
          taxAmount: Money.toDecimalString(totals.taxAmount, 4),
          total: Money.toDecimalString(totals.total, 4),
          paidAmount: Money.toDecimalString(paid, 4),
          dueAmount: Money.toDecimalString(due, 4),
          createdBy: user.id,
          ...(dto.clientId ? { clientId: dto.clientId } : {}),
          ...(user.deviceId ? { deviceId: user.deviceId } : {}),
          // The terminal's clock is what belongs on the receipt; createdAt is
          // when the server first saw it. On an offline sale they differ.
          ...(dto.occurredAt ? { occurredAt: new Date(dto.occurredAt) } : {}),
          ...(dto.notes ? { notes: dto.notes } : {}),
        })
        .returning();

      if (!sale) throw new AppError(ERROR_CODES.INTERNAL_ERROR, "Could not create the sale");

      for (const [index, line] of lines.entries()) {
        const computed = totals.lines[index]!;

        await tx.insert(schema.saleItems).values({
          tenantId,
          saleId: sale.id,
          variantId: line.variantId,
          // Snapshotted: renaming a product must not rewrite last year's invoice.
          productName: line.variant.productName,
          variantName: line.variant.variantName,
          productSku: line.variant.sku,
          quantity: String(line.quantity),
          unitPrice: line.unitPrice,
          discountPercent: line.discountPercent,
          discountAmount: Money.toDecimalString(computed.discount, 4),
          taxPercent: line.taxPercent,
          taxAmount: Money.toDecimalString(computed.tax, 4),
          lineSubtotal: Money.toDecimalString(computed.net, 4),
          total: Money.toDecimalString(computed.total, 4),
          // Margin must not shift when the next purchase order changes the
          // average cost, so it is captured here.
          ...(line.costPrice ? { costPrice: line.costPrice } : {}),
          sortOrder: index,
        });

        // Services and labour have no stock to move.
        if (line.variant.isStockTracked) {
          await this.stock.deductStock({
            tx,
            variantId: line.variantId,
            branchId: dto.branchId,
            quantity: String(line.quantity),
            referenceType: "sale",
            referenceId: sale.id,
            ...(line.costPrice ? { unitCost: line.costPrice } : {}),
            ...(user.deviceId ? { deviceId: user.deviceId } : {}),
          });
        }
      }

      let unallocated = totals.total;
      for (const payment of dto.payments ?? []) {
        const offered = Money.toMinor(String(payment.amount));
        const applied = Money.min(offered, unallocated);
        unallocated = Money.subtract(unallocated, applied);

        /**
         * Change comes out of the drawer, so only cash can produce it. A card
         * charged above the total is an overcharge, not change — silently
         * dropping the excess would leave the customer's statement and the
         * receipt disagreeing, with nothing recorded to explain it.
         */
        if (applied !== offered && payment.method !== "cash") {
          throw new AppError(
            ERROR_CODES.VALIDATION_FAILED,
            `A ${payment.method} payment cannot exceed the amount due. Change can only be given in cash.`,
          );
        }

        // A tender that lands entirely on already-settled value is not a
        // payment at all — recording a zero row would clutter every statement.
        if (!Money.isPositive(applied)) continue;

        await tx.insert(schema.payments).values({
          tenantId,
          branchId: dto.branchId,
          saleId: sale.id,
          customerId: dto.customerId ?? null,
          cashSessionId: dto.cashSessionId ?? null,
          method: payment.method as PaymentMethod,
          amount: Money.toDecimalString(applied, 4),
          currency: settings.currency.base,
          ...(payment.reference ? { reference: payment.reference } : {}),
          createdBy: user.id,
          ...(dto.occurredAt ? { occurredAt: new Date(dto.occurredAt) } : {}),
        });
      }

      // The cached balance moves in the same transaction as the sale that
      // caused it, so the two can never disagree.
      if (Money.isPositive(due) && dto.customerId) {
        await tx
          .update(schema.customers)
          .set({
            creditBalance: sql`${schema.customers.creditBalance} + ${Money.toDecimalString(due, 4)}::numeric`,
          })
          .where(eq(schema.customers.id, dto.customerId));
      }

      const created = await this.findById(sale.id, tx);
      return { ...(created as object), change: Money.toDecimalString(change, 2) };
    });
  }

  async findById(
    id: string,
    existingTx?: Parameters<Parameters<TenantDatabase["run"]>[0]>[0],
  ): Promise<unknown> {
    const read = async (tx: Parameters<Parameters<TenantDatabase["run"]>[0]>[0]) => {
      const sale = await tx.query.sales.findFirst({
        where: (t, { eq: e }) => e(t.id, id),
      });
      if (!sale) throw new AppError(ERROR_CODES.NOT_FOUND, `Sale ${id} not found`);

      const [items, payments] = await Promise.all([
        tx
          .select()
          .from(schema.saleItems)
          .where(eq(schema.saleItems.saleId, id))
          .orderBy(schema.saleItems.sortOrder),
        tx.select().from(schema.payments).where(eq(schema.payments.saleId, id)),
      ]);

      const canViewCost = RequestContext.get()?.user?.abac.canViewCost ?? false;

      return {
        ...sale,
        items: items.map(({ costPrice, ...item }) =>
          canViewCost ? { ...item, costPrice } : item,
        ),
        payments,
      };
    };

    return existingTx ? read(existingTx) : this.db.run(read);
  }

  async list(query: {
    page: number;
    limit: number;
    branchId?: string;
    customerId?: string;
    from?: string;
    to?: string;
  }): Promise<unknown> {
    const offset = (query.page - 1) * query.limit;

    return this.db.run(async (tx) => {
      const where = and(
        query.branchId ? eq(schema.sales.branchId, query.branchId) : undefined,
        query.customerId ? eq(schema.sales.customerId, query.customerId) : undefined,
        query.from ? sql`${schema.sales.occurredAt} >= ${query.from}::date` : undefined,
        query.to ? sql`${schema.sales.occurredAt} < (${query.to}::date + 1)` : undefined,
      );

      const items = await tx
        .select({
          id: schema.sales.id,
          saleNumber: schema.sales.saleNumber,
          occurredAt: schema.sales.occurredAt,
          total: schema.sales.total,
          paidAmount: schema.sales.paidAmount,
          dueAmount: schema.sales.dueAmount,
          status: schema.sales.status,
          branchName: schema.branches.name,
          customerName: schema.customers.name,
          cashierName: schema.users.name,
        })
        .from(schema.sales)
        .innerJoin(schema.branches, eq(schema.sales.branchId, schema.branches.id))
        .leftJoin(schema.customers, eq(schema.sales.customerId, schema.customers.id))
        .leftJoin(schema.users, eq(schema.sales.createdBy, schema.users.id))
        .where(where)
        .orderBy(desc(schema.sales.occurredAt))
        .limit(query.limit)
        .offset(offset);

      return { items, meta: { page: query.page, limit: query.limit } };
    });
  }
}
