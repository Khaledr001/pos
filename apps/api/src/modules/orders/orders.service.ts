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
import { StockService } from "../inventory/stock.service.js";
import { PriceResolverService } from "../pricing/price-resolver.service.js";
import { SalesService } from "../sales/sales.service.js";
import type { CancelOrderDto, CreateOrderDto, FulfillOrderDto, ListOrdersDto } from "./dto.js";

type Transaction = Parameters<Parameters<TenantDatabase["run"]>[0]>[0];

/**
 * Orders: a commitment, unlike a quotation. Confirming one RESERVES stock —
 * it is no longer free to promise to whoever else walks in — and it can be
 * picked up over several visits rather than all at once.
 *
 * Every fulfilment is its own sale, created through `SalesService.create()`
 * exactly like a walk-in — same stock, credit and ABAC checks, no second set
 * of rules to keep in step. `create()`/`confirm()` themselves stay as simple
 * as a quotation's: nothing is charged and nothing has to clear a floor check
 * until goods actually change hands at fulfilment.
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly prices: PriceResolverService,
    private readonly stock: StockService,
    private readonly sales: SalesService,
  ) {}

  async create(dto: CreateOrderDto): Promise<unknown> {
    const tenantId = RequestContext.requireTenantId();
    const user = RequestContext.requireUser();
    const branchId = requireBranchId(dto.branchId);

    return this.db.run(async (tx) => {
      if (dto.localId) {
        const existing = await tx.query.orders.findFirst({
          where: (t, { eq: e }) => e(t.localId, dto.localId!),
        });
        if (existing) return this.findById(existing.id, tx);
      }

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
        const unitPrice = line.unitPrice ?? price?.unitPrice;
        if (!unitPrice) {
          throw new AppError(
            ERROR_CODES.NO_PRICE_FOR_PRODUCT,
            `${variants.get(line.variantId)?.productName ?? line.variantId} has no price. Set one before ordering it.`,
          );
        }
        return {
          ...line,
          unitPrice,
          taxPercent: variants.get(line.variantId)!.taxRate ?? String(settings.tax.defaultRate),
        };
      });

      const totals = calculateDocument({
        taxMode: settings.tax.mode,
        decimals: settings.currency.decimals,
        ...(dto.documentDiscountPercent
          ? { documentDiscountPercent: String(dto.documentDiscountPercent) }
          : {}),
        lines: lines.map((line) => ({
          quantity: String(line.quantity),
          unitPrice: line.unitPrice,
          discountPercent: String(line.discountPercent ?? 0),
          taxPercent: line.taxPercent,
        })),
      });

      const orderNumber = await this.nextNumber(tx, branchId);

      const [order] = await tx
        .insert(schema.orders)
        .values({
          tenantId,
          branchId,
          orderNumber,
          customerId: dto.customerId ?? null,
          quotationId: dto.quotationId ?? null,
          source: "manual",
          status: "pending",
          currency: settings.currency.base,
          taxMode: settings.tax.mode,
          subtotal: Money.toDecimalString(totals.subtotal, 4),
          discountAmount: Money.toDecimalString(totals.discountAmount, 4),
          taxAmount: Money.toDecimalString(totals.taxAmount, 4),
          total: Money.toDecimalString(totals.total, 4),
          ...(dto.expectedReadyAt ? { expectedReadyAt: new Date(dto.expectedReadyAt) } : {}),
          ...(dto.notes ? { notes: dto.notes } : {}),
          createdBy: user.id,
          ...(dto.localId ? { localId: dto.localId } : {}),
          ...(user.deviceId ? { deviceId: user.deviceId } : {}),
          ...(dto.occurredAt
            ? { createdAt: new Date(dto.occurredAt), updatedAt: new Date(dto.occurredAt) }
            : {}),
        })
        .returning();

      if (!order) throw new AppError(ERROR_CODES.INTERNAL_ERROR, "Could not create the order");

      await tx.insert(schema.orderItems).values(
        lines.map((line, index) => {
          const variant = variants.get(line.variantId)!;
          const computed = totals.lines[index]!;

          return {
            tenantId,
            orderId: order.id,
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

      return this.findById(order.id, tx);
    });
  }

  /**
   * Reserve stock for every line. The moment this order stops being a mere
   * intention and starts being a hold on the shelf that some other customer
   * cannot also be promised.
   */
  async confirm(id: string): Promise<unknown> {
    return this.db.run(async (tx) => {
      const order = await this.require(tx, id);
      if (order.status !== "pending") {
        throw new AppError(ERROR_CODES.CONFLICT, `This order is already ${order.status}`);
      }

      const items = await this.itemsWithStockFlag(tx, id);
      for (const item of items) {
        if (!item.isStockTracked) continue;
        await this.stock.reserveStock({
          tx,
          variantId: item.variantId,
          branchId: order.branchId,
          quantity: item.quantity,
        });
      }

      await tx
        .update(schema.orders)
        .set({ status: "processing", stockReserved: new Date() })
        .where(eq(schema.orders.id, id));

      return this.findById(id, tx);
    });
  }

  /**
   * Release whatever is still reserved. Only the UNFULFILLED remainder — a
   * partially picked-up order that gets cancelled must not give back stock
   * that already left as an actual sale.
   */
  async cancel(id: string, dto: CancelOrderDto): Promise<unknown> {
    return this.db.run(async (tx) => {
      const order = await this.require(tx, id);
      if (order.status === "completed") {
        throw new AppError(ERROR_CODES.CONFLICT, "This order is already completed.");
      }
      if (order.status === "cancelled") {
        throw new AppError(ERROR_CODES.CONFLICT, "This order is already cancelled.");
      }

      if (order.status === "processing" || order.status === "ready") {
        const items = await this.itemsWithStockFlag(tx, id);
        for (const item of items) {
          if (!item.isStockTracked) continue;
          const remaining = Money.subtract(
            Money.toMinor(item.quantity),
            Money.toMinor(item.fulfilledQuantity),
          );
          if (!Money.isPositive(remaining)) continue;
          await this.stock.releaseReservedStock({
            tx,
            variantId: item.variantId,
            branchId: order.branchId,
            quantity: Money.toDecimalString(remaining, 4),
          });
        }
      }

      await tx
        .update(schema.orders)
        .set({ status: "cancelled", cancelledAt: new Date(), cancellationReason: dto.reason })
        .where(eq(schema.orders.id, id));

      return this.findById(id, tx);
    });
  }

  /**
   * Hand over some or all of what remains. Creates its own sale for exactly
   * the lines and quantities being taken today — a customer collecting a
   * large order across several visits pays each time, not once up front —
   * and releases that same amount from the order's reservation, since it is
   * no longer merely held, it is gone.
   */
  async fulfill(id: string, dto: FulfillOrderDto): Promise<unknown> {
    const order = await this.db.run(async (tx) => {
      const found = await this.require(tx, id);
      if (found.status !== "processing" && found.status !== "ready") {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          "This order must be confirmed before anything can be handed over.",
        );
      }
      return found;
    });

    const items = await this.db.run((tx) =>
      tx
        .select({
          id: schema.orderItems.id,
          variantId: schema.orderItems.variantId,
          quantity: schema.orderItems.quantity,
          fulfilledQuantity: schema.orderItems.fulfilledQuantity,
          unitPrice: schema.orderItems.unitPrice,
          discountPercent: schema.orderItems.discountPercent,
          isStockTracked: schema.products.isStockTracked,
        })
        .from(schema.orderItems)
        .innerJoin(schema.productVariants, eq(schema.orderItems.variantId, schema.productVariants.id))
        .innerJoin(schema.products, eq(schema.productVariants.productId, schema.products.id))
        .where(
          and(
            eq(schema.orderItems.orderId, id),
            inArray(schema.orderItems.id, dto.lines.map((l) => l.orderItemId)),
          ),
        ),
    );
    const byId = new Map(items.map((item) => [item.id, item]));

    const fulfilling = dto.lines.map((line) => {
      const item = byId.get(line.orderItemId);
      if (!item) {
        throw new AppError(
          ERROR_CODES.NOT_FOUND,
          `Order item ${line.orderItemId} does not belong to this order`,
        );
      }
      const remaining = Money.toMinor(item.quantity) - Money.toMinor(item.fulfilledQuantity);
      const requested = Money.toMinor(String(line.quantity));
      if (requested > remaining) {
        throw new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          `Only ${Money.toDecimalString(remaining, 2)} left to hand over on this line.`,
          { orderItemId: line.orderItemId, remaining: Money.toDecimalString(remaining, 2) },
        );
      }
      return { ...line, item };
    });

    // A real sale — same permission, floor and stock checks as a walk-in.
    // Charges each line at the price the ORDER quoted, not today's list.
    const sale = (await this.sales.create({
      branchId: order.branchId,
      customerId: order.customerId,
      cashSessionId: dto.cashSessionId ?? null,
      source: "pos",
      lines: fulfilling.map((line) => ({
        variantId: line.item.variantId,
        quantity: line.quantity,
        unitPrice: line.item.unitPrice,
        ...(Number(line.item.discountPercent) > 0
          ? { discountPercent: Number(line.item.discountPercent) }
          : {}),
      })),
      payments: dto.payments.map((payment) => ({
        method: payment.method as never,
        amount: payment.amount,
        ...(payment.reference ? { reference: payment.reference } : {}),
      })),
    })) as { id: string };

    return this.db.run(async (tx) => {
      await tx.update(schema.sales).set({ orderId: id }).where(eq(schema.sales.id, sale.id));

      for (const line of fulfilling) {
        await tx
          .update(schema.orderItems)
          .set({
            fulfilledQuantity: sql`${schema.orderItems.fulfilledQuantity} + ${String(line.quantity)}::numeric`,
          })
          .where(eq(schema.orderItems.id, line.orderItemId));

        if (line.item.isStockTracked) {
          await this.stock.releaseReservedStock({
            tx,
            variantId: line.item.variantId,
            branchId: order.branchId,
            quantity: String(line.quantity),
          });
        }
      }

      const allItems = await tx
        .select({ quantity: schema.orderItems.quantity, fulfilledQuantity: schema.orderItems.fulfilledQuantity })
        .from(schema.orderItems)
        .where(eq(schema.orderItems.orderId, id));

      const fullyFulfilled = allItems.every(
        (i) => Money.toMinor(i.fulfilledQuantity) >= Money.toMinor(i.quantity),
      );

      await tx
        .update(schema.orders)
        .set(
          fullyFulfilled
            ? { status: "completed", completedAt: new Date() }
            : { status: "processing" },
        )
        .where(eq(schema.orders.id, id));

      return this.findById(id, tx);
    });
  }

  async findById(id: string, existing?: Transaction): Promise<unknown> {
    const read = async (tx: Transaction) => {
      const order = await this.require(tx, id);

      const items = await tx.query.orderItems.findMany({
        where: (t, { eq: e }) => e(t.orderId, id),
        orderBy: (t, { asc: a }) => a(t.sortOrder),
      });

      const customer = order.customerId
        ? await tx.query.customers.findFirst({
            where: (t, { eq: e }) => e(t.id, order.customerId!),
            columns: { id: true, name: true, company: true, phone: true },
          })
        : null;

      return { ...order, customer, items };
    };

    return existing ? read(existing) : this.db.run(read);
  }

  async list(query: ListOrdersDto): Promise<{ items: unknown[]; total: number }> {
    if (query.branchId) assertBranchInScope(query.branchId);

    return this.db.run(async (tx) => {
      const where = and(
        query.branchId ? eq(schema.orders.branchId, query.branchId) : undefined,
        query.customerId ? eq(schema.orders.customerId, query.customerId) : undefined,
        query.status ? eq(schema.orders.status, query.status) : undefined,
        query.from ? gte(schema.orders.createdAt, new Date(`${query.from}T00:00:00Z`)) : undefined,
        query.to ? lte(schema.orders.createdAt, new Date(`${query.to}T23:59:59.999Z`)) : undefined,
      );

      const [total] = await tx.select({ value: count() }).from(schema.orders).where(where);

      const items = await tx
        .select({
          id: schema.orders.id,
          orderNumber: schema.orders.orderNumber,
          status: schema.orders.status,
          customerName: schema.customers.name,
          total: schema.orders.total,
          expectedReadyAt: schema.orders.expectedReadyAt,
          createdAt: schema.orders.createdAt,
        })
        .from(schema.orders)
        .leftJoin(schema.customers, eq(schema.orders.customerId, schema.customers.id))
        .where(where)
        .orderBy(desc(schema.orders.createdAt))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);

      return { items, total: total?.value ?? 0 };
    });
  }

  // ---------------------------------------------------------------------------

  private async require(tx: Transaction, id: string) {
    const order = await tx.query.orders.findFirst({ where: (t, { eq: e }) => e(t.id, id) });
    if (!order) throw new AppError(ERROR_CODES.NOT_FOUND, `Order ${id} not found`);
    assertBranchInScope(order.branchId);
    return order;
  }

  private async itemsWithStockFlag(tx: Transaction, orderId: string) {
    return tx
      .select({
        variantId: schema.orderItems.variantId,
        quantity: schema.orderItems.quantity,
        fulfilledQuantity: schema.orderItems.fulfilledQuantity,
        isStockTracked: schema.products.isStockTracked,
      })
      .from(schema.orderItems)
      .innerJoin(schema.productVariants, eq(schema.orderItems.variantId, schema.productVariants.id))
      .innerJoin(schema.products, eq(schema.productVariants.productId, schema.products.id))
      .where(eq(schema.orderItems.orderId, orderId));
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
      sql`SELECT next_document_number(${tenantId}::uuid, ${sequenceKey("order", year, branch?.code ?? null)})`,
    );

    return formatDocumentNumber({
      kind: "order",
      year,
      sequence: Number((seq as { next_document_number?: number })?.next_document_number ?? 1),
      ...(branch?.code ? { branchCode: branch.code } : {}),
    });
  }
}
