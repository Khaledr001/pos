import { and, asc, count, desc, eq, gte, inArray, lte, schema, sql } from "@devsfleet/db";
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
  SupplierLookupDto,
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

      const variantIds = dto.lines.map((line) => line.variantId);
      const variants = await this.loadVariants(tx, variantIds);
      const packagings = await this.loadPackagings(tx, variantIds);
      const settings = await this.settings(tx);

      /**
       * Resolved once, up front, so the insert below never has to ask again.
       * Quantity and price both stay in the ORDERED unit — pack count times
       * pack price is the invoice line, and `calculateDocument` is
       * dimensionally agnostic. Nothing converts to base units on an order;
       * nothing has moved yet.
       */
      const resolved = dto.lines.map((line) => {
        const variant = variants.get(line.variantId)!;
        return this.resolveFactor(
          packagings,
          line.variantId,
          line.unitId,
          variant.productName,
        );
      });

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
            // The packaging ordered, falling back to the product's base unit.
            unitId: resolved[index]!.unitId ?? variant.unitId,
            unitConversionFactor: resolved[index]!.conversionFactor,
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

      // A line names its variant directly, or via a code that belongs to
      // THIS supplier alone (Stage 5.4) — resolved once, up front, so
      // everything below can keep treating variantId as always present.
      const namedLines = await this.resolveLineVariants(tx, supplierId, dto.lines);

      /**
       * ...and the same for the packaging, so nothing below asks
       * `variant_units` again. Every line now carries the factor that turns
       * its quantity into base units.
       */
      const variantsForLines = await this.loadVariants(
        tx,
        namedLines.map((line) => line.variantId),
      );
      const packagings = await this.loadPackagings(
        tx,
        namedLines.map((line) => line.variantId),
      );
      const resolvedLines = namedLines.map((line) => {
        const label = variantsForLines.get(line.variantId)?.productName ?? line.variantId;
        const { unitId, conversionFactor } = this.resolveFactor(
          packagings,
          line.variantId,
          line.unitId,
          label,
        );
        return { ...line, unitId, conversionFactor };
      });

      // Whole base units, unless the unit itself permits fractions. A pack
      // makes fractional base quantities newly reachable — half a box of
      // three is one and a half pieces — and nothing checked before.
      const fractionalByVariant = await this.loadAllowsFractions(
        tx,
        namedLines.map((line) => line.variantId),
      );

      // Whether each line's product tracks serial numbers — needed on a
      // direct receipt too, where there is no purchase-order line to ask.
      const trackSerialByVariant = await this.loadTrackSerial(
        tx,
        resolvedLines.map((line) => line.variantId),
      );

      /**
       * Every line's invoice value, used both to allocate freight and to bill
       * the supplier. Falls back to the ordered price when the receipt does not
       * restate it — the usual case, where the invoice matches the quote.
       */
      const settings = await this.settings(tx);

      const lineValues = resolvedLines.map((line) => {
        const ordered = line.purchaseOrderItemId
          ? orderItemsById.get(line.purchaseOrderItemId)
          : undefined;

        /**
         * The ordered price is per ORDERED unit; this line is priced per
         * RECEIVED unit, and the two can differ. Ordering by the box and
         * taking delivery of loose pieces would otherwise bill one box's
         * price for one piece — a thousandfold overcharge on the supplier's
         * account. Rescale through base units; a no-op when both factors are 1.
         */
        const orderedPrice = ordered
          ? Money.divideByQuantity(
              Money.multiplyByQuantity(
                Money.toMinor(ordered.unitPrice),
                line.conversionFactor,
              ),
              ordered.unitConversionFactor,
            )
          : null;

        const unitPrice =
          line.unitPrice !== undefined ? Money.toMinor(String(line.unitPrice)) : orderedPrice;

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

      for (const [index, line] of resolvedLines.entries()) {
        const { value, tax } = lineValues[index]!;

        /**
         * Quantities, in base units.
         *
         * `receivedBase` is GROSS — the supplier delivered them and is billed
         * for them. `sellableBase` is net of damage, and only that reaches the
         * shelf. `damagedQuantity` already arrives in base units (a broken
         * screw is 1, not 0.001 of a box), so it is not scaled.
         */
        const receivedBase = Money.multiplyByQuantity(
          Money.toMinor(String(line.quantity)),
          line.conversionFactor,
        );
        const damagedBase = Money.toMinor(String(line.damagedQuantity));
        const sellableBase = Money.subtract(receivedBase, damagedBase);

        if (Money.isNegative(sellableBase)) {
          throw new AppError(
            ERROR_CODES.VALIDATION_FAILED,
            "More units were marked damaged than arrived",
            {
              received: Money.toDecimalString(receivedBase, 4),
              damaged: Money.toDecimalString(damagedBase, 4),
            },
          );
        }

        if (!fractionalByVariant.get(line.variantId)) {
          for (const [label, amount] of [
            ["received", receivedBase],
            ["damaged", damagedBase],
          ] as const) {
            if (amount % 10_000n !== 0n) {
              throw new AppError(
                ERROR_CODES.VALIDATION_FAILED,
                `This product is counted in whole units, but the ${label} quantity works out to ` +
                  `${Money.toDecimalString(amount, 4)}.`,
              );
            }
          }
        }

        /**
         * What this line cost in total: the supplier's charge plus its share
         * of getting it here. Never divided — see the per-unit figure below.
         *
         * VAT is deliberately excluded — it is recoverable, so it is not part
         * of what the stock cost the business.
         */
        const lineTotal = Money.add(value, freight[index] ?? 0n);

        /**
         * Only the sellable portion is capitalised into stock. A damaged unit's
         * share of the cost is billed by the supplier and written off, which is
         * the behaviour this has always had.
         */
        const sellableTotalCost = Money.isPositive(receivedBase)
          ? Money.divideByQuantity(
              Money.multiplyByQuantity(lineTotal, Money.toDecimalString(sellableBase, 4)),
              Money.toDecimalString(receivedBase, 4),
            )
          : 0n;

        /**
         * Landed cost PER BASE UNIT — per piece, never per box. Recorded on
         * the receipt row and the stock ledger; the weighted average is fed
         * the exact total above instead, so this rounding never compounds.
         */
        const landedUnitCost = Money.divideByQuantity(
          lineTotal,
          Money.toDecimalString(receivedBase, 4),
        );

        /**
         * A per-base cost that rounds to nothing.
         *
         * Money holds four decimals, so a bag of 10,000 washers costing AED
         * 0.45 works out to 0.000045 a piece and stores as zero. Left alone,
         * `averageCost` becomes 0.0000 and that variant's stock is worth
         * nothing for good — silently, and unrecoverably without a manual
         * correction. Refuse the receipt instead.
         */
        if (Money.isPositive(lineTotal) && landedUnitCost === 0n) {
          throw new AppError(
            ERROR_CODES.VALIDATION_FAILED,
            `A cost of ${Money.toDecimalString(lineTotal, 4)} across ` +
              `${Money.toDecimalString(receivedBase, 4)} units is less than 0.0001 each, which ` +
              `cannot be recorded. Receive a smaller pack, or split the line.`,
          );
        }

        await tx.insert(schema.goodsReceiptItems).values({
          tenantId,
          goodsReceiptId: receipt.id,
          ...(line.purchaseOrderItemId
            ? { purchaseOrderItemId: line.purchaseOrderItemId }
            : {}),
          variantId: line.variantId,
          ...(line.unitId ? { unitId: line.unitId } : {}),
          unitConversionFactor: line.conversionFactor,
          // As entered, in the received unit. `landedUnitCost` beside it is
          // per BASE unit — see the column comments.
          quantity: String(line.quantity),
          landedUnitCost: Money.toDecimalString(landedUnitCost, 4),
          damagedQuantity: String(line.damagedQuantity),
          ...(line.batchNumber ? { batchNumber: line.batchNumber } : {}),
          ...(line.expiryDate ? { expiryDate: line.expiryDate } : {}),
          ...(line.notes ? { notes: line.notes } : {}),
        });

        // Damaged units are recorded on the receipt but never enter stock:
        // they are not sellable, and counting them makes a shelf look full.
        if (Money.isPositive(sellableBase)) {
          await this.stock.addStock({
            tx,
            variantId: line.variantId,
            branchId,
            // Base units — a box of 1,000 puts 1,000 pieces on the shelf.
            quantity: Money.toDecimalString(sellableBase, 4),
            referenceType: "purchase_receipt",
            referenceId: receipt.id,
            unitCost: Money.toDecimalString(landedUnitCost, 4),
            // The exact figure, so the weighted average never inherits the
            // rounding that per-unit cost above had to take.
            totalCost: Money.toDecimalString(sellableTotalCost, 4),
          });

          if (trackSerialByVariant.get(line.variantId)) {
            /**
             * A serialised product is received one whole unit at a time —
             * "2.5 phones" has no identity to assign the half to.
             *
             * Asserted, not rounded: `toDecimalString(x, 0)` rounds half-up,
             * so 2.4 sellable used to render "2" and pass with two serials.
             */
            if (sellableBase % 10_000n !== 0n) {
              throw new AppError(
                ERROR_CODES.VALIDATION_FAILED,
                `This product tracks serial numbers, so it cannot arrive in fractions — ` +
                  `${Money.toDecimalString(sellableBase, 4)} units were sellable.`,
              );
            }

            const sellableUnits = sellableBase / 10_000n;
            const serials = line.serials ?? [];

            if (BigInt(serials.length) !== sellableUnits) {
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
              /**
               * GROSS and in BASE units. Gross because the supplier delivered
               * them — damage is a claim, not an undelivery. Base because a
               * box today and loose pieces on Thursday have to add up against
               * one order line.
               */
              receivedQuantity: sql`${schema.purchaseOrderItems.receivedQuantity} + ${Money.toDecimalString(receivedBase, 4)}::numeric`,
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
    /**
     * `receivedQuantity` is base units; `quantity` is ordered units. Compare
     * them in base.
     *
     * The epsilon is what stops an order hanging open forever: 100 pieces
     * received as 33.3333 trays of 3 comes back as 99.9999, a ten-thousandth
     * short, with no quantity a clerk could type to close the gap. Below any
     * real materiality, and far below one of anything countable.
     */
    const [progress] = await tx
      .select({
        outstanding: sql<number>`count(*) FILTER (WHERE received_quantity < quantity * unit_conversion_factor - 0.0001)::int`,
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

      /**
       * `unitAbbr` is joined, not derived: both receiving screens print it
       * beside a quantity, and a quantity whose unit is unlabelled is exactly
       * the ambiguity packs introduce. It rendered blank before this join
       * existed, which was harmless only while every line was base units.
       *
       * `remainingBase` / `remaining` save every caller from re-deriving the
       * base-vs-ordered-unit arithmetic — the mistake would be silent and
       * would show "nothing left to receive" on a part-filled order.
       */
      const rawItems = await tx
        .select({
          item: schema.purchaseOrderItems,
          unitAbbr: schema.units.abbreviation,
        })
        .from(schema.purchaseOrderItems)
        .leftJoin(schema.units, eq(schema.purchaseOrderItems.unitId, schema.units.id))
        .where(eq(schema.purchaseOrderItems.purchaseOrderId, id))
        .orderBy(asc(schema.purchaseOrderItems.sortOrder));

      const items = rawItems.map(({ item, unitAbbr }) => {
        const factor = Money.toMinor(item.unitConversionFactor);
        const orderedBase = Money.multiplyByQuantity(
          Money.toMinor(item.quantity),
          item.unitConversionFactor,
        );
        const remainingBase = Money.subtract(
          orderedBase,
          Money.toMinor(item.receivedQuantity),
        );
        const clamped = Money.isNegative(remainingBase) ? 0n : remainingBase;

        return {
          ...item,
          unitAbbr,
          /** Still outstanding, in base units. */
          remainingBase: Money.toDecimalString(clamped, 4),
          /** The same, expressed in the unit the line was ordered in. */
          remaining: Money.toDecimalString(
            factor === 0n
              ? clamped
              : Money.divideByQuantity(clamped, item.unitConversionFactor),
            4,
          ),
        };
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
          /** In the RECEIVED unit; `landedUnitCost` beside it is per BASE unit. */
          quantity: schema.goodsReceiptItems.quantity,
          unitId: schema.goodsReceiptItems.unitId,
          unitConversionFactor: schema.goodsReceiptItems.unitConversionFactor,
          unitAbbr: schema.units.abbreviation,
          /** Base units. */
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
        // Left: a base-unit line has no packaging row and so no abbreviation.
        .leftJoin(schema.units, eq(schema.goodsReceiptItems.unitId, schema.units.id))
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

  /**
   * "What does this scanned code resolve to?" — for the receiving screen to
   * check a code before submitting a whole receipt, rather than discovering
   * a bad one only at the end. Matches either the supplier's SKU or their
   * barcode; a receiving clerk cannot always tell which one is printed on a
   * given label.
   */
  async lookupSupplierCode(query: SupplierLookupDto): Promise<unknown> {
    const link = await this.db.run((tx) =>
      tx.query.productSupplierLinks.findFirst({
        where: (t, { and: a, eq: e, or: o }) =>
          a(e(t.supplierId, query.supplierId), o(e(t.supplierBarcode, query.code), e(t.supplierSku, query.code))),
        with: { variant: { with: { product: true } } },
      }),
    );

    if (!link) {
      throw new AppError(
        ERROR_CODES.NOT_FOUND,
        `No product is linked to this supplier's code "${query.code}"`,
      );
    }
    return link;
  }

  /**
   * A receipt line names its variant directly, or via a code (their SKU or
   * barcode) that belongs to THIS supplier alone — matched against
   * product_supplier_links (Stage 5.4). This is what makes a direct receipt
   * (no purchase order already carrying a resolved variantId) usable
   * straight off a supplier's own delivery note.
   */
  private async resolveLineVariants(
    tx: Transaction,
    supplierId: string,
    lines: ReceiveGoodsDto["lines"],
  ): Promise<Array<ReceiveGoodsDto["lines"][number] & { variantId: string }>> {
    return Promise.all(
      lines.map(async (line) => {
        if (line.variantId) return { ...line, variantId: line.variantId };

        const code = line.supplierBarcode ?? line.supplierSku;
        // The DTO's own refinement already guarantees one of these three is
        // present; this is just narrowing the type back down for TS.
        if (!code) {
          throw new AppError(
            ERROR_CODES.VALIDATION_FAILED,
            "A receipt line needs a variantId, or a supplierSku/supplierBarcode to resolve one",
          );
        }

        const link = await tx.query.productSupplierLinks.findFirst({
          where: (t, { and: a, eq: e, or: o }) =>
            a(e(t.supplierId, supplierId), o(e(t.supplierBarcode, code), e(t.supplierSku, code))),
          columns: { variantId: true },
        });

        if (!link) {
          throw new AppError(
            ERROR_CODES.NOT_FOUND,
            `No product is linked to this supplier's code "${code}"`,
          );
        }
        return { ...line, variantId: link.variantId };
      }),
    );
  }

  /**
   * Whether each variant's BASE unit tolerates decimals.
   *
   * Read here for the first time anywhere in the codebase. It matters on the
   * buy side specifically: receiving in packs is what makes a fractional base
   * quantity reachable at all.
   */
  private async loadAllowsFractions(
    tx: Transaction,
    variantIds: string[],
  ): Promise<Map<string, boolean>> {
    if (variantIds.length === 0) return new Map();

    const rows = await tx
      .select({
        id: schema.productVariants.id,
        allowsFractions: schema.units.allowsFractions,
      })
      .from(schema.productVariants)
      .innerJoin(schema.products, eq(schema.productVariants.productId, schema.products.id))
      .innerJoin(schema.units, eq(schema.products.unitId, schema.units.id))
      .where(inArray(schema.productVariants.id, [...new Set(variantIds)]));

    return new Map(rows.map((row) => [row.id, row.allowsFractions]));
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

  /**
   * Every packaging offered by the variants on this document, keyed
   * `variantId:unitId` — one query, not one per line.
   */
  private async loadPackagings(tx: Transaction, variantIds: string[]) {
    if (variantIds.length === 0) return new Map<string, { conversionFactor: string; isPurchasable: boolean }>();

    const rows = await tx
      .select({
        variantId: schema.variantUnits.variantId,
        unitId: schema.variantUnits.unitId,
        conversionFactor: schema.variantUnits.conversionFactor,
        isPurchasable: schema.variantUnits.isPurchasable,
      })
      .from(schema.variantUnits)
      .where(inArray(schema.variantUnits.variantId, [...new Set(variantIds)]));

    return new Map(
      rows.map((row) => [
        `${row.variantId}:${row.unitId}`,
        { conversionFactor: row.conversionFactor, isPurchasable: row.isPurchasable },
      ]),
    );
  }

  /**
   * How many base units one of `unitId` contains, for this variant.
   *
   * Omitting the unit means the base unit, factor 1 — the overwhelmingly
   * common case and the behaviour every existing caller had.
   *
   * Deliberately does NOT consult `isSellable`. A supplier's outer carton is
   * bought and never sold, and a packaging retired from the till must still be
   * receivable while stock is in transit — see `variant_units.isPurchasable`.
   */
  private resolveFactor(
    packagings: Map<string, { conversionFactor: string; isPurchasable: boolean }>,
    variantId: string,
    unitId: string | undefined,
    variantLabel: string,
  ): { unitId: string | null; conversionFactor: string } {
    if (!unitId) return { unitId: null, conversionFactor: "1" };

    const packaging = packagings.get(`${variantId}:${unitId}`);
    if (!packaging) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        `${variantLabel} has no packaging for that unit.`,
        { variantId, unitId },
      );
    }
    if (!packaging.isPurchasable) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        `${variantLabel} is not bought in that unit.`,
        { variantId, unitId },
      );
    }
    return { unitId, conversionFactor: packaging.conversionFactor };
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
