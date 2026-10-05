import { and, count, desc, eq, inArray, ne, schema, sql, type Transaction } from "@devsfleet/db";
import type { WebOrderStatus } from "@devsfleet/shared-types";
import { AppError, calculateLine, ERROR_CODES, Money } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { RequestContext } from "../../../common/context/request-context.js";
import { TenantDatabase } from "../../../database/tenant-database.service.js";
import { SalesService } from "../../sales/sales.service.js";
import { moneyView } from "../pricing/money-view.js";
import { toWire } from "../wire.js";

/** Marks the order line a courier fee is invoiced on. */
export const DELIVERY_LINE_NOTE = "storefront:delivery";

const PAGE_SIZE = 20;

/**
 * The shopper's view of an order: the POS order's own lines and totals, with
 * the web-side details (contact, delivery, payment, timeline) beside them.
 * Nothing here recomputes a total — they are the order's, as stored.
 */
@Injectable()
export class WebOrdersService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly sales: SalesService,
  ) {}

  /** A guest's order, by the unguessable token in their confirmation email. */
  async track(token: string) {
    return this.db.run(async (tx) => {
      const web = await tx.query.webOrders.findFirst({ where: (t, { eq: e }) => e(t.trackingToken, token) });
      if (!web) throw new AppError(ERROR_CODES.NOT_FOUND, "We could not find that order.");
      return this.view(tx, web.orderId);
    });
  }

  async forAccount(accountId: string, orderId: string) {
    return this.db.run(async (tx) => {
      const web = await tx.query.webOrders.findFirst({
        where: (t, { and: a, eq: e }) => a(e(t.orderId, orderId), e(t.accountId, accountId)),
        columns: { orderId: true },
      });
      // The same answer for "not yours" as for "does not exist".
      if (!web) throw new AppError(ERROR_CODES.NOT_FOUND, "We could not find that order.");
      return this.view(tx, web.orderId);
    });
  }

  /** The tax invoice behind a guest's tracking link. */
  async trackedInvoicePdf(token: string) {
    const web = await this.db.run((tx) =>
      tx.query.webOrders.findFirst({ where: (t, { eq: e }) => e(t.trackingToken, token), columns: { orderId: true } }),
    );
    if (!web) throw new AppError(ERROR_CODES.NOT_FOUND, "We could not find that order.");
    return this.invoicePdf(web.orderId);
  }

  async accountInvoicePdf(accountId: string, orderId: string) {
    const web = await this.db.run((tx) =>
      tx.query.webOrders.findFirst({
        where: (t, { and: a, eq: e }) => a(e(t.orderId, orderId), e(t.accountId, accountId)),
        columns: { orderId: true },
      }),
    );
    if (!web) throw new AppError(ERROR_CODES.NOT_FOUND, "We could not find that order.");
    return this.invoicePdf(web.orderId);
  }

  /**
   * The same document the counter prints, rendered by `SalesService` — the
   * sale is the tax invoice, so there is no second layout to drift from it.
   * Picks the sale `view` reports as the invoice, so the number on the page
   * and the file downloaded are always the same one.
   */
  private async invoicePdf(orderId: string) {
    const sale = await this.db.run((tx) => this.invoiceSale(tx, orderId));
    if (!sale) throw new AppError(ERROR_CODES.NOT_FOUND, "This order has no tax invoice yet.");
    return this.sales.invoicePdf(sale.id);
  }

  private invoiceSale(tx: Transaction, orderId: string) {
    return tx.query.sales.findFirst({
      where: (t, { eq: e }) => e(t.orderId, orderId),
      columns: { id: true, saleNumber: true, createdAt: true },
      orderBy: (t, { asc }) => asc(t.createdAt),
    });
  }

  async listForAccount(accountId: string, page: number) {
    return this.db.run(async (tx) => {
      // An unpaid card order is an abandoned checkout, not an order the shopper placed.
      const where = and(eq(schema.webOrders.accountId, accountId), ne(schema.webOrders.status, "pending_payment"));
      const [total] = await tx.select({ value: count() }).from(schema.webOrders).where(where);
      const rows = await tx
        .select({
          id: schema.orders.id,
          orderNumber: schema.orders.orderNumber,
          status: schema.webOrders.status,
          paymentStatus: schema.webOrders.paymentStatus,
          deliveryMethod: schema.webOrders.deliveryMethod,
          placedAt: schema.webOrders.placedAt,
          total: schema.orders.total,
        })
        .from(schema.webOrders)
        .innerJoin(schema.orders, eq(schema.webOrders.orderId, schema.orders.id))
        .where(where)
        .orderBy(desc(schema.webOrders.createdAt))
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE);

      const counts = rows.length
        ? await tx
            .select({ orderId: schema.orderItems.orderId, value: count() })
            .from(schema.orderItems)
            .where(and(inArray(schema.orderItems.orderId, rows.map((r) => r.id)), neDeliveryLine()))
            .groupBy(schema.orderItems.orderId)
        : [];
      const countBy = new Map(counts.map((c) => [c.orderId, c.value]));
      const money = this.money();

      return {
        total: total?.value ?? 0,
        page,
        pageSize: PAGE_SIZE,
        items: rows.map((r) => ({
          id: r.id,
          orderNumber: r.orderNumber,
          status: toWire(r.status),
          paymentStatus: toWire(r.paymentStatus),
          deliveryMethod: toWire(r.deliveryMethod),
          placedAt: r.placedAt,
          itemCount: countBy.get(r.id) ?? 0,
          total: money(Money.toMinor(r.total)),
        })),
      };
    });
  }

  /** Append to the tracking timeline. Every status change writes one. */
  async recordEvent(
    tx: Transaction,
    orderId: string,
    status: WebOrderStatus,
    note: string | null = null,
    actorId: string | null = null,
  ): Promise<void> {
    await tx.insert(schema.webOrderEvents).values({
      tenantId: RequestContext.requireTenantId(),
      orderId,
      status,
      note,
      actorId,
    });
  }

  async view(tx: Transaction, orderId: string) {
    const order = await tx.query.orders.findFirst({ where: (t, { eq: e }) => e(t.id, orderId) });
    const web = await tx.query.webOrders.findFirst({
      where: (t, { eq: e }) => e(t.orderId, orderId),
      with: {
        events: { orderBy: (t, { asc }) => asc(t.createdAt) },
        shipments: { orderBy: (t, { desc: d }) => d(t.createdAt) },
      },
    });
    if (!order || !web) throw new AppError(ERROR_CODES.NOT_FOUND, "We could not find that order.");

    const [items, pickupBranch, invoice] = await Promise.all([
      tx
        .select({
          id: schema.orderItems.id,
          variantId: schema.orderItems.variantId,
          sku: schema.orderItems.productSku,
          productName: schema.orderItems.productName,
          variantName: schema.orderItems.variantName,
          unitId: schema.orderItems.unitId,
          quantity: schema.orderItems.quantity,
          unitPrice: schema.orderItems.unitPrice,
          taxPercent: schema.orderItems.taxPercent,
          lineSubtotal: schema.orderItems.lineSubtotal,
          total: schema.orderItems.total,
          notes: schema.orderItems.notes,
          unit: schema.units.abbreviation,
          slug: schema.productListings.slug,
          image: schema.products.imageUrl,
        })
        .from(schema.orderItems)
        .innerJoin(schema.productVariants, eq(schema.orderItems.variantId, schema.productVariants.id))
        .innerJoin(schema.products, eq(schema.productVariants.productId, schema.products.id))
        .innerJoin(schema.units, eq(schema.units.id, schema.products.unitId))
        .leftJoin(schema.productListings, eq(schema.productListings.productId, schema.products.id))
        .where(eq(schema.orderItems.orderId, orderId))
        .orderBy(schema.orderItems.sortOrder),
      web.pickupBranchId
        ? tx.query.branches.findFirst({
            where: (t, { eq: e }) => e(t.id, web.pickupBranchId!),
            columns: { name: true, address: true, phone: true },
          })
        : null,
      this.invoiceSale(tx, orderId),
    ]);

    const packagingUnitIds = [...new Set(items.map((i) => i.unitId).filter((id): id is string => !!id))];
    const packagingUnits = packagingUnitIds.length
      ? await tx.select({ id: schema.units.id, abbreviation: schema.units.abbreviation }).from(schema.units).where(inArray(schema.units.id, packagingUnitIds))
      : [];
    const unitBy = new Map(packagingUnits.map((u) => [u.id, u.abbreviation]));

    const money = this.money();
    const { tenantSettings } = RequestContext.requireStorefront();
    const delivery = items.find((i) => i.notes === DELIVERY_LINE_NOTE);
    const goods = items.filter((i) => i !== delivery);
    const deliveryNet = delivery ? Money.toMinor(delivery.lineSubtotal) : 0n;

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      trackingToken: web.trackingToken,
      status: toWire(web.status),
      paymentStatus: toWire(web.paymentStatus),
      paymentMethod: toWire(web.paymentMethod),
      deliveryMethod: toWire(web.deliveryMethod),
      placedAt: web.placedAt,
      createdAt: web.createdAt,
      contact: { fullName: web.contactName, email: web.contactEmail, phone: web.contactPhone },
      companyName: web.companyName,
      trn: web.trn,
      shippingAddress: web.shippingAddress,
      pickup: pickupBranch
        ? {
            branch: { name: pickupBranch.name, address: pickupBranch.address ?? "", phone: pickupBranch.phone },
            slotStart: web.pickupSlotStart,
            slotEnd: web.pickupSlotEnd,
          }
        : null,
      lines: goods.map((item) => {
        const unit = calculateLine(
          { quantity: "1", unitPrice: item.unitPrice, taxPercent: item.taxPercent },
          order.taxMode,
          tenantSettings.currency.decimals,
        );
        return {
          id: item.id,
          variantId: item.variantId,
          sku: item.sku,
          name: item.variantName && item.variantName !== "Default" ? `${item.productName} — ${item.variantName}` : item.productName,
          uom: item.unitId ? (unitBy.get(item.unitId) ?? item.unit) : item.unit,
          quantity: Number(item.quantity),
          unitPrice: money(unit.total),
          unitNet: money(unit.net),
          lineTotal: money(Money.toMinor(item.total)),
          productSlug: item.slug,
          imageUrl: item.image,
        };
      }),
      totals: {
        subtotalNet: money(Money.toMinor(order.subtotal) + Money.toMinor(order.discountAmount) - deliveryNet),
        discountNet: money(Money.toMinor(order.discountAmount)),
        shippingNet: money(deliveryNet),
        vat: money(Money.toMinor(order.taxAmount)),
        total: money(Money.toMinor(order.total)),
      },
      couponCode: web.couponCode,
      notes: order.notes,
      shipments: web.shipments.map((s) => ({
        courier: s.courier,
        trackingNumber: s.trackingNumber,
        trackingUrl: s.trackingUrl,
        status: s.status,
        createdAt: s.createdAt,
      })),
      timeline: web.events.map((e) => ({ status: toWire(e.status), note: e.note, at: e.createdAt })),
      invoice: invoice ? { number: invoice.saleNumber, issuedAt: invoice.createdAt } : null,
    };
  }

  private money() {
    const { tenantSettings } = RequestContext.requireStorefront();
    return (minor: bigint) => moneyView(minor, tenantSettings.currency.base, tenantSettings.currency.decimals);
  }
}

function neDeliveryLine() {
  // `IS DISTINCT FROM`: goods lines carry no note at all, and `<>` against NULL is NULL.
  return sql`${schema.orderItems.notes} IS DISTINCT FROM ${DELIVERY_LINE_NOTE}`;
}
