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
import { SerialsService } from "../serials/serials.service.js";
import type {
  CreatePurchaseOrderDto,
  ListPurchaseOrdersDto,
  ReceiveGoodsDto,
  UpdatePurchaseOrderDto,
} from "./dto.js";

type Transaction = Parameters<Parameters<TenantDatabase["run"]>[0]>[0];

/**
 * Purchase order → goods receipt → stock in.
 *
 * The receipt is a separate document because deliveries arrive short, split
 * across days, or partly broken. Stock moves on RECEIPT and never on order: a
 * PO sent to a supplier who never ships would otherwise inflate on-hand
 * quantities and, worse, make them look sellable.
 */
@Injectable()
export class PurchasesService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly stock: StockService,
    private readonly serials: SerialsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Purchase orders
  // ---------------------------------------------------------------------------

  async createOrder(dto: CreatePurchaseOrderDto): Promise<unknown> {
    const tenantId = RequestContext.requireTenantId();
    const user = RequestContext.requireUser();
    const branchId = requireBranchId(dto.branchId);

    return this.db.run(async (tx) => {
      const supplier = await tx.query.suppliers.findFirst({
        where: (t, { and: a, eq: e, isNull: n }) => a(e(t.id, dto.supplierId), n(t.deletedAt)),
      });
      if (!supplier) throw new AppError(ERROR_CODES.NOT_FOUND, "That supplier does not exist");

      const variants = await this.loadVariants(
        tx,
        dto.lines.map((line) => line.variantId),
      );
      const settings = await this.settings(tx);

      const totals = calculateDocument({
        lines: dto.lines.map((line) => ({
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          ...(line.discountPercent ? { discountPercent: line.discountPercent } : {}),
          taxPercent: line.taxPercent ?? settings.tax.defaultRate,
        })),
        // A supplier invoice states prices net and adds VAT, whatever the
        // tenant sells at. Taking the sales tax mode here would misread the
        // supplier's own document.
        taxMode: "exclusive",
        decimals: settings.currency.decimals,
      });

      const poNumber = await this.nextNumber(tx, "purchase_order", branchId);

      const [order] = await tx
        .insert(schema.purchaseOrders)
        .values({
          tenantId,
          branchId,
          poNumber,
          supplierId: dto.supplierId,
          currency: settings.currency.base,
          taxMode: "exclusive",
          subtotal: Money.toDecimalString(totals.subtotal, 4),
          discountAmount: Money.toDecimalString(totals.discountAmount, 4),
          taxAmount: Money.toDecimalString(totals.taxAmount, 4),
          shippingAmount: String(dto.shippingAmount),
          total: Money.toDecimalString(
            Money.add(totals.total, Money.toMinor(String(dto.shippingAmount))),
            4,
          ),
          ...(dto.expectedDate ? { expectedDate: dto.expectedDate } : {}),
          ...(dto.supplierReference ? { supplierReference: dto.supplierReference } : {}),
          ...(dto.notes ? { notes: dto.notes } : {}),
          createdBy: user.id,
        })
        .returning();

      if (!order) throw new AppError(ERROR_CODES.INTERNAL_ERROR, "Could not create the order");

      await tx.insert(schema.purchaseOrderItems).values(
        dto.lines.map((line, index) => {
          const variant = variants.get(line.variantId)!;
          const computed = totals.lines[index]!;

          return {
            tenantId,
            purchaseOrderId: order.id,
            variantId: line.variantId,
            // Snapshotted: renaming a product must not rewrite an order the
            // supplier already has a copy of.
            productName: variant.productName,
            variantName: variant.variantName ?? "Default",
            productSku: variant.sku,
            unitId: variant.unitId,
            quantity: String(line.quantity),
            unitPrice: String(line.unitPrice),
            discountPercent: String(line.discountPercent ?? 0),
            taxPercent: String(line.taxPercent ?? settings.tax.defaultRate),
            taxAmount: Money.toDecimalString(computed.tax, 4),
            lineSubtotal: Money.toDecimalString(computed.net, 4),
            total: Money.toDecimalString(computed.total, 4),
            sortOrder: index,
            ...(line.notes ? { notes: line.notes } : {}),
          };
        }),
      );

      return this.findById(order.id, tx);
    });
  }

  /** Draft only. An order the supplier has already seen is not ours to rewrite. */
  async updateOrder(id: string, dto: UpdatePurchaseOrderDto): Promise<unknown> {
    return this.db.run(async (tx) => {
      const order = await this.requireOrder(tx, id);

      if (order.status !== "draft") {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          `This order has been ${order.status}. Cancel it and raise a new one.`,
        );
      }

      await tx
        .update(schema.purchaseOrders)
        .set({
          ...(dto.expectedDate !== undefined ? { expectedDate: dto.expectedDate } : {}),
          ...(dto.supplierReference !== undefined
            ? { supplierReference: dto.supplierReference }
            : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          ...(dto.shippingAmount !== undefined
            ? { shippingAmount: String(dto.shippingAmount) }
            : {}),
        })
        .where(eq(schema.purchaseOrders.id, id));

      return this.findById(id, tx);
    });
  }

  /** Mark it sent. Records when, which is what chasing a late delivery needs. */
  async sendOrder(id: string): Promise<unknown> {
    const user = RequestContext.requireUser();

    return this.db.run(async (tx) => {
      const order = await this.requireOrder(tx, id);
      if (order.status !== "draft") {
        throw new AppError(ERROR_CODES.CONFLICT, `This order is already ${order.status}`);
      }

      await tx
        .update(schema.purchaseOrders)
        .set({ status: "sent", sentAt: new Date(), approvedBy: user.id })
        .where(eq(schema.purchaseOrders.id, id));

      return this.findById(id, tx);
    });
  }

  async cancelOrder(id: string): Promise<unknown> {
    return this.db.run(async (tx) => {
      const order = await this.requireOrder(tx, id);

      // Cancelling after a partial delivery would leave received stock
      // attributed to a document that claims nothing was ordered.
      if (order.status === "partial" || order.status === "received") {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          "Goods have already been received against this order. It cannot be cancelled.",
        );
      }

      await tx
        .update(schema.purchaseOrders)
        .set({ status: "cancelled" })
        .where(eq(schema.purchaseOrders.id, id));

      return this.findById(id, tx);
    });
  }

  // ---------------------------------------------------------------------------
  // Goods receipt
  // ---------------------------------------------------------------------------

  /**
   * Receive a delivery.
   *
   * This is where stock actually moves, where the weighted average cost moves
   * with it, and where the supplier's balance goes up. All in one transaction —
   * stock that arrived without a payable is a gift, and a payable without stock
   * is a dispute.
   */
  async receive(dto: ReceiveGoodsDto): Promise<unknown> {
    const tenantId = RequestContext.requireTenantId();
    const user = RequestContext.requireUser();

    return this.db.run(async (tx) => {
      const order = dto.purchaseOrderId
        ? await this.requireOrder(tx, dto.purchaseOrderId)
        : null;

      const branchId = requireBranchId(dto.branchId ?? order?.branchId);
      const supplierId = order?.supplierId ?? dto.supplierId;

      if (!supplierId) {
        throw new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          "A direct receipt must name the supplier it came from",
        );
      }

      if (order && (order.status === "cancelled" || order.status === "received")) {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          `This order is ${order.status}. Nothing more can be received against it.`,
        );
      }

      const orderItems = order
        ? await tx.query.purchaseOrderItems.findMany({
            where: (t, { eq: e }) => e(t.purchaseOrderId, order.id),
          })
        : [];
      const orderItemsById = new Map(orderItems.map((item) => [item.id, item]));

      // Whether each line's product tracks serial numbers — needed on a
      // direct receipt too, where there is no purchase-order line to ask.
      const trackSerialByVariant = await this.loadTrackSerial(
        tx,
        dto.lines.map((line) => line.variantId),
      );

      /**
       * Every line's invoice value, used both to allocate freight and to bill
       * the supplier. Falls back to the ordered price when the receipt does not
       * restate it — the usual case, where the invoice matches the quote.
       */
      const settings = await this.settings(tx);

      const lineValues = dto.lines.map((line) => {
        const ordered = line.purchaseOrderItemId
          ? orderItemsById.get(line.purchaseOrderItemId)
          : undefined;

        const unitPrice =
          line.unitPrice !== undefined
            ? Money.toMinor(String(line.unitPrice))
            : ordered
              ? Money.toMinor(ordered.unitPrice)
              : null;

        if (unitPrice === null) {
          throw new AppError(
            ERROR_CODES.VALIDATION_FAILED,
            "A receipt line with no purchase order line must state its unit price",
          );
        }

        const value = Money.multiplyByQuantity(unitPrice, line.quantity);

        // The rate the order was raised at, so a VAT change between ordering
        // and delivery does not restate an invoice the supplier already sent.
        const taxPercent = ordered?.taxPercent ?? String(settings.tax.defaultRate);

        return { unitPrice, value, tax: Money.percentOf(value, taxPercent) };
      });

      /**
       * Freight, spread across lines BY VALUE.
       *
       * Not per line and not per unit: a pallet of tiles and a box of screws on
       * one delivery did not cost the same to ship, and splitting evenly would
       * make the screws look ruinous and the tiles look free.
       *
       * `allocateByWeight` gives the last line the rounding remainder, so the
       * allocated shares always sum back to exactly the freight charged.
       */
      const shipping = Money.toMinor(
        String(dto.shippingAmount ?? (order && orderItems.length ? order.shippingAmount : 0)),
      );
      const freight = Money.allocateByWeight(
        shipping,
        lineValues.map((line) => line.value),
      );

      const grnNumber = await this.nextNumber(tx, "goods_receipt", branchId);

      const [receipt] = await tx
        .insert(schema.goodsReceipts)
        .values({
          tenantId,
          branchId,
          supplierId,
          ...(order ? { purchaseOrderId: order.id } : {}),
          grnNumber,
          ...(dto.supplierInvoiceNumber
            ? { supplierInvoiceNumber: dto.supplierInvoiceNumber }
            : {}),
          ...(dto.supplierInvoiceDate
            ? { supplierInvoiceDate: dto.supplierInvoiceDate }
            : {}),
          receivedBy: user.id,
          ...(dto.notes ? { notes: dto.notes } : {}),
        })
        .returning();

      if (!receipt) throw new AppError(ERROR_CODES.INTERNAL_ERROR, "Could not create the receipt");

      let payable = 0n;

      for (const [index, line] of dto.lines.entries()) {
        const { value, tax } = lineValues[index]!;
        const damaged = Money.toMinor(String(line.damagedQuantity));
        const sellable = Money.subtract(
          Money.toMinor(String(line.quantity)),
          damaged,
        );

        if (Money.isNegative(sellable)) {
          throw new AppError(
            ERROR_CODES.VALIDATION_FAILED,
            "More units were marked damaged than arrived",
          );
        }

        /**
         * Landed cost, per unit: what the supplier charged plus this line's
         * share of getting it here. Using the invoice price alone systematically
         * understates cost and overstates margin on everything imported.
         *
         * VAT is deliberately excluded — it is recoverable, so it is not part of
         * what the stock cost the business.
         */
        const landedUnitCost = Money.divideByQuantity(
          Money.add(value, freight[index] ?? 0n),
          line.quantity,
        );

        await tx.insert(schema.goodsReceiptItems).values({
          tenantId,
          goodsReceiptId: receipt.id,
          ...(line.purchaseOrderItemId
            ? { purchaseOrderItemId: line.purchaseOrderItemId }
            : {}),
          variantId: line.variantId,
          quantity: String(line.quantity),
          landedUnitCost: Money.toDecimalString(landedUnitCost, 4),
          damagedQuantity: String(line.damagedQuantity),
          ...(line.batchNumber ? { batchNumber: line.batchNumber } : {}),
          ...(line.expiryDate ? { expiryDate: line.expiryDate } : {}),
          ...(line.notes ? { notes: line.notes } : {}),
        });

        // Damaged units are recorded on the receipt but never enter stock:
        // they are not sellable, and counting them makes a shelf look full.
        if (Money.isPositive(sellable)) {
          await this.stock.addStock({
            tx,
            variantId: line.variantId,
            branchId,
            quantity: Money.toDecimalString(sellable, 4),
            referenceType: "purchase_receipt",
            referenceId: receipt.id,
            unitCost: Money.toDecimalString(landedUnitCost, 4),
          });

          if (trackSerialByVariant.get(line.variantId)) {
            // A serialised product is sold and received one whole unit at a
            // time — "2.5 phones" has no identity to assign the half to.
            const sellableUnits = Money.toDecimalString(sellable, 0);
            const serials = line.serials ?? [];

            if (serials.length !== Number(sellableUnits)) {
              throw new AppError(
                ERROR_CODES.VALIDATION_FAILED,
                `This product tracks serial numbers — ${sellableUnits} arrived sellable, so exactly that ` +
                  `many serials must be listed. Got ${serials.length}.`,
              );
            }

            await this.serials.checkIn(tx, { branchId, variantId: line.variantId, serials });
          }
        }

        /**
         * The supplier is owed the INVOICE figure: goods plus VAT, damaged
         * units included. VAT is recoverable, which is why it is excluded from
         * stock cost — but it is still money that leaves the bank, so it
         * belongs in the payable. Damage is a claim to raise with them, not a
         * deduction to make unilaterally.
         */
        payable = Money.add(payable, value, tax);

        if (line.purchaseOrderItemId) {
          await tx
            .update(schema.purchaseOrderItems)
            .set({
              receivedQuantity: sql`${schema.purchaseOrderItems.receivedQuantity} + ${String(line.quantity)}::numeric`,
            })
            .where(eq(schema.purchaseOrderItems.id, line.purchaseOrderItemId));
        }
      }

      // Freight is on the same invoice in this model, so it is owed too.
      const invoiceTotal = Money.add(payable, shipping);

      await tx
        .update(schema.suppliers)
        .set({
          outstandingBalance: sql`${schema.suppliers.outstandingBalance} + ${Money.toDecimalString(invoiceTotal, 4)}::numeric`,
        })
        .where(eq(schema.suppliers.id, supplierId));

      if (order) await this.refreshOrderStatus(tx, order.id);

      return this.findReceipt(receipt.id, tx);
    });
  }

  /**
   * Fully received, or partly?
   *
   * Recomputed from the lines rather than inferred from this delivery, because
   * a second delivery completing the order has no way of knowing what the first
   * one left outstanding.
   */
  private async refreshOrderStatus(tx: Transaction, orderId: string): Promise<void> {
    const [progress] = await tx
      .select({
        outstanding: sql<number>`count(*) FILTER (WHERE received_quantity < quantity)::int`,
        received: sql<number>`count(*) FILTER (WHERE received_quantity > 0)::int`,
      })
      .from(schema.purchaseOrderItems)
      .where(eq(schema.purchaseOrderItems.purchaseOrderId, orderId));

    const status =
      (progress?.outstanding ?? 0) === 0
        ? "received"
        : (progress?.received ?? 0) > 0
          ? "partial"
          : "sent";

    await tx
      .update(schema.purchaseOrders)
      .set({ status })
      .where(eq(schema.purchaseOrders.id, orderId));
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async findById(id: string, existing?: Transaction): Promise<unknown> {
    const read = async (tx: Transaction) => {
      const order = await tx.query.purchaseOrders.findFirst({
        where: (t, { eq: e }) => e(t.id, id),
      });
      if (!order) throw new AppError(ERROR_CODES.NOT_FOUND, `Purchase order ${id} not found`);
      assertBranchInScope(order.branchId);

      const items = await tx.query.purchaseOrderItems.findMany({
        where: (t, { eq: e }) => e(t.purchaseOrderId, id),
        orderBy: (t, { asc: a }) => a(t.sortOrder),
      });

      const supplier = await tx.query.suppliers.findFirst({
        where: (t, { eq: e }) => e(t.id, order.supplierId),
        columns: { id: true, name: true, company: true, phone: true, trn: true },
      });

      const receipts = await tx
        .select({
          id: schema.goodsReceipts.id,
          grnNumber: schema.goodsReceipts.grnNumber,
          receivedAt: schema.goodsReceipts.receivedAt,
          supplierInvoiceNumber: schema.goodsReceipts.supplierInvoiceNumber,
        })
        .from(schema.goodsReceipts)
        .where(eq(schema.goodsReceipts.purchaseOrderId, id))
        .orderBy(desc(schema.goodsReceipts.receivedAt));

      return { ...order, supplier, items, receipts };
    };

    return existing ? read(existing) : this.db.run(read);
  }

  async findReceipt(id: string, existing?: Transaction): Promise<unknown> {
    const read = async (tx: Transaction) => {
      const receipt = await tx.query.goodsReceipts.findFirst({
        where: (t, { eq: e }) => e(t.id, id),
      });
      if (!receipt) throw new AppError(ERROR_CODES.NOT_FOUND, `Receipt ${id} not found`);
      assertBranchInScope(receipt.branchId);

      const items = await tx
        .select({
          id: schema.goodsReceiptItems.id,
          variantId: schema.goodsReceiptItems.variantId,
          sku: schema.productVariants.sku,
          productName: schema.products.name,
          quantity: schema.goodsReceiptItems.quantity,
          damagedQuantity: schema.goodsReceiptItems.damagedQuantity,
          landedUnitCost: schema.goodsReceiptItems.landedUnitCost,
          batchNumber: schema.goodsReceiptItems.batchNumber,
          expiryDate: schema.goodsReceiptItems.expiryDate,
        })
        .from(schema.goodsReceiptItems)
        .innerJoin(
          schema.productVariants,
          eq(schema.goodsReceiptItems.variantId, schema.productVariants.id),
        )
        .innerJoin(
          schema.products,
          eq(schema.productVariants.productId, schema.products.id),
        )
        .where(eq(schema.goodsReceiptItems.goodsReceiptId, id));

      return { ...receipt, items };
    };

    return existing ? read(existing) : this.db.run(read);
  }

  async list(query: ListPurchaseOrdersDto): Promise<{ items: unknown[]; total: number }> {
    if (query.branchId) assertBranchInScope(query.branchId);

    return this.db.run(async (tx) => {
      const where = and(
        query.branchId ? eq(schema.purchaseOrders.branchId, query.branchId) : undefined,
        query.supplierId ? eq(schema.purchaseOrders.supplierId, query.supplierId) : undefined,
        query.status ? eq(schema.purchaseOrders.status, query.status) : undefined,
        query.from
          ? gte(schema.purchaseOrders.createdAt, new Date(`${query.from}T00:00:00Z`))
          : undefined,
        query.to
          ? lte(schema.purchaseOrders.createdAt, new Date(`${query.to}T23:59:59.999Z`))
          : undefined,
      );

      const [total] = await tx
        .select({ value: count() })
        .from(schema.purchaseOrders)
        .where(where);

      const items = await tx
        .select({
          id: schema.purchaseOrders.id,
          poNumber: schema.purchaseOrders.poNumber,
          status: schema.purchaseOrders.status,
          supplierName: schema.suppliers.name,
          total: schema.purchaseOrders.total,
          expectedDate: schema.purchaseOrders.expectedDate,
          createdAt: schema.purchaseOrders.createdAt,
        })
        .from(schema.purchaseOrders)
        .innerJoin(schema.suppliers, eq(schema.purchaseOrders.supplierId, schema.suppliers.id))
        .where(where)
        .orderBy(desc(schema.purchaseOrders.createdAt))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);

      return { items, total: total?.value ?? 0 };
    });
  }

  // ---------------------------------------------------------------------------

  private async requireOrder(tx: Transaction, id: string) {
    const order = await tx.query.purchaseOrders.findFirst({
      where: (t, { eq: e }) => e(t.id, id),
    });
    if (!order) throw new AppError(ERROR_CODES.NOT_FOUND, `Purchase order ${id} not found`);
    assertBranchInScope(order.branchId);
    return order;
  }

  private async loadTrackSerial(
    tx: Transaction,
    variantIds: string[],
  ): Promise<Map<string, boolean>> {
    const rows = await tx
      .select({ id: schema.productVariants.id, trackSerial: schema.products.trackSerial })
      .from(schema.productVariants)
      .innerJoin(schema.products, eq(schema.productVariants.productId, schema.products.id))
      .where(inArray(schema.productVariants.id, [...new Set(variantIds)]));

    return new Map(rows.map((row) => [row.id, row.trackSerial]));
  }

  private async loadVariants(tx: Transaction, variantIds: string[]) {
    const rows = await tx
      .select({
        id: schema.productVariants.id,
        sku: schema.productVariants.sku,
        variantName: schema.productVariants.variantName,
        productName: schema.products.name,
        unitId: schema.products.unitId,
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

  private async nextNumber(
    tx: Transaction,
    kind: "purchase_order" | "goods_receipt",
    branchId: string,
  ): Promise<string> {
    const tenantId = RequestContext.requireTenantId();
    const year = new Date().getFullYear();

    const branch = await tx.query.branches.findFirst({
      where: (t, { eq: e }) => e(t.id, branchId),
      columns: { code: true },
    });

    const [seq] = await tx.execute<{ next_document_number: number }>(
      sql`SELECT next_document_number(${tenantId}::uuid, ${sequenceKey(kind, year, branch?.code ?? null)})`,
    );

    return formatDocumentNumber({
      kind,
      year,
      sequence: Number(
        (seq as { next_document_number?: number })?.next_document_number ?? 1,
      ),
      ...(branch?.code ? { branchCode: branch.code } : {}),
    });
  }
}
