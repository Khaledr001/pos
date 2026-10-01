import { and, count, desc, eq, ilike, or, schema, type Transaction } from "@devsfleet/db";
import type { WebOrderStatus } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES, Money } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { RequestContext } from "../../../common/context/request-context.js";
import { TenantDatabase } from "../../../database/tenant-database.service.js";
import { OrdersService } from "../../orders/orders.service.js";
import { StorefrontResolver } from "../context/storefront-resolver.service.js";
import { canTransition, HANDOVER, nextStatuses } from "../orders/web-order-status.js";
import { WebOrdersService } from "../orders/web-orders.service.js";
import { StripeClient } from "../payments/stripe.client.js";
import { toWire } from "../wire.js";
import type { ListWebOrdersDto, ShipmentDto, TransitionDto } from "./dto.js";

/**
 * The online order desk: staff moving web orders through packing, dispatch
 * and hand-over.
 *
 * Hand-over (delivered / collected) is where a web order stops being an
 * order and becomes a sale. It goes through OrdersService.fulfill and
 * therefore SalesService — the same stock movement, invoice numbering and
 * permission checks as an order collected at the counter, under the staff
 * member who handed it over. There is no web-only way to invoice.
 */
@Injectable()
export class OrderDeskService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly orders: OrdersService,
    private readonly webOrders: WebOrdersService,
    private readonly resolver: StorefrontResolver,
  ) {}

  async list(dto: ListWebOrdersDto) {
    return this.withStorefront(() =>
      this.db.run(async (tx) => {
        const search = dto.q ? `%${dto.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
        const where = and(
          dto.status ? eq(schema.webOrders.status, dto.status) : undefined,
          search
            ? or(
                ilike(schema.orders.orderNumber, search),
                ilike(schema.webOrders.contactName, search),
                ilike(schema.webOrders.contactEmail, search),
                ilike(schema.webOrders.contactPhone, search),
              )
            : undefined,
        );
        const [total] = await tx
          .select({ value: count() })
          .from(schema.webOrders)
          .innerJoin(schema.orders, eq(schema.webOrders.orderId, schema.orders.id))
          .where(where);
        const rows = await tx
          .select({
            id: schema.orders.id,
            orderNumber: schema.orders.orderNumber,
            status: schema.webOrders.status,
            paymentStatus: schema.webOrders.paymentStatus,
            paymentMethod: schema.webOrders.paymentMethod,
            deliveryMethod: schema.webOrders.deliveryMethod,
            contactName: schema.webOrders.contactName,
            contactPhone: schema.webOrders.contactPhone,
            total: schema.orders.total,
            branchName: schema.branches.name,
            placedAt: schema.webOrders.placedAt,
            createdAt: schema.webOrders.createdAt,
          })
          .from(schema.webOrders)
          .innerJoin(schema.orders, eq(schema.webOrders.orderId, schema.orders.id))
          .innerJoin(schema.branches, eq(schema.orders.branchId, schema.branches.id))
          .where(where)
          .orderBy(desc(schema.webOrders.createdAt))
          .limit(dto.pageSize)
          .offset((dto.page - 1) * dto.pageSize);

        const counts = await tx
          .select({ status: schema.webOrders.status, value: count() })
          .from(schema.webOrders)
          .groupBy(schema.webOrders.status);

        return {
          items: rows.map((r) => ({ ...r, status: toWire(r.status), paymentStatus: toWire(r.paymentStatus), paymentMethod: toWire(r.paymentMethod), deliveryMethod: toWire(r.deliveryMethod) })),
          total: total?.value ?? 0,
          page: dto.page,
          pageSize: dto.pageSize,
          countsByStatus: Object.fromEntries(counts.map((c) => [toWire(c.status), c.value])),
        };
      }),
    );
  }

  async detail(id: string) {
    return this.withStorefront(() =>
      this.db.run(async (tx) => {
        const view = await this.webOrders.view(tx, id);
        const web = await this.requireWeb(tx, id);
        const order = await tx.query.orders.findFirst({ where: (t, { eq: e }) => e(t.id, id) });
        const payments = await tx.query.webPayments.findMany({
          where: (t, { eq: e }) => e(t.orderId, id),
          orderBy: (t, { desc: d }) => d(t.createdAt),
        });
        return {
          ...view,
          posStatus: order?.status ?? null,
          branchId: order?.branchId ?? null,
          customerId: order?.customerId ?? null,
          payments: payments.map((p) => ({
            id: p.id,
            provider: p.provider,
            providerRef: p.providerRef,
            method: toWire(p.method),
            amount: p.amount,
            status: toWire(p.status),
            createdAt: p.createdAt,
          })),
          nextStatuses: nextStatuses(web.status, web.deliveryMethod).map(toWire),
          canRefund: web.status === "cancelled" && web.paymentStatus === "paid" && payments.some((p) => p.status === "paid" && p.provider !== "cod"),
        };
      }),
    );
  }

  async transition(id: string, dto: TransitionDto) {
    const user = RequestContext.requireUser();
    const to = dto.status as WebOrderStatus;

    const web = await this.withStorefront(() => this.db.run((tx) => this.requireWeb(tx, id)));
    if (!canTransition(web.status, to, web.deliveryMethod)) {
      throw new AppError(
        ERROR_CODES.CONFLICT,
        `A ${web.deliveryMethod} order that is ${web.status.replace(/_/g, " ")} cannot become ${to.replace(/_/g, " ")}.`,
      );
    }

    if (HANDOVER.includes(to)) {
      await this.handOver(id, web, dto);
    } else {
      await this.withStorefront(() =>
        this.db.run(async (tx) => {
          if (to === "cancelled") {
            await this.orders.cancelInTransaction(tx, id, dto.note ?? "Cancelled from the online order desk.");
          } else if (to === "ready_for_pickup") {
            await this.orders.markReadyInTransaction(tx, id);
          }
          await tx.update(schema.webOrders).set({ status: to }).where(eq(schema.webOrders.orderId, id));
          const refundNote = to === "cancelled" && web.paymentStatus === "paid" ? " Paid online — refund it from this order." : "";
          await this.webOrders.recordEvent(tx, id, to, `${dto.note ?? ""}${refundNote}`.trim() || null, user.id);
        }),
      );
    }
    return this.detail(id);
  }

  async addShipment(id: string, dto: ShipmentDto) {
    return this.withStorefront(async () => {
      await this.db.run(async (tx) => {
        const web = await this.requireWeb(tx, id);
        if (web.deliveryMethod !== "courier") {
          throw new AppError(ERROR_CODES.VALIDATION_FAILED, "Only a courier order has a shipment.");
        }
        await tx.insert(schema.webShipments).values({
          tenantId: RequestContext.requireTenantId(),
          orderId: id,
          courier: dto.courier,
          trackingNumber: dto.trackingNumber ?? null,
          trackingUrl: dto.trackingUrl ?? null,
        });
      });
      return this.detail(id);
    });
  }

  /**
   * Return an online payment for a cancelled order, through the gateway it
   * was taken on. Cash on delivery has nothing to return — it was never
   * collected.
   */
  async refund(id: string) {
    const user = RequestContext.requireUser();
    return this.withStorefront(async () => {
      const { web, payment, account } = await this.db.run(async (tx) => {
        const web = await this.requireWeb(tx, id);
        const payment = await tx.query.webPayments.findFirst({
          where: (t, { and: a, eq: e }) => a(e(t.orderId, id), e(t.status, "paid")),
        });
        const account = await tx.query.storefrontPaymentAccounts.findFirst({
          where: (t, { and: a, eq: e }) => a(e(t.provider, "stripe"), e(t.isActive, true)),
        });
        return { web, payment, account };
      });
      if (web.status !== "cancelled") throw new AppError(ERROR_CODES.CONFLICT, "Cancel the order before refunding it.");
      if (!payment || payment.provider === "cod") throw new AppError(ERROR_CODES.CONFLICT, "This order has no online payment to refund.");

      const amountMinor = Number(Money.roundTo(Money.toMinor(payment.amount), 2) / 100n);
      if (payment.provider === "stripe") {
        if (!account) throw new AppError(ERROR_CODES.PAYMENT_FAILED, "The Stripe account this was paid on is no longer connected. Refund it from Stripe.");
        await new StripeClient(account.secretKey).refund(payment.providerRef!, amountMinor);
      }
      // devpay: nothing moved, nothing to send back.

      await this.db.run(async (tx) => {
        await tx.update(schema.webPayments).set({ status: "refunded" }).where(eq(schema.webPayments.id, payment.id));
        await tx.update(schema.webOrders).set({ status: "refunded", paymentStatus: "refunded" }).where(eq(schema.webOrders.orderId, id));
        await this.webOrders.recordEvent(tx, id, "refunded", `Refunded ${payment.amount} to the original payment.`, user.id);
      });
      return this.detail(id);
    });
  }

  // ---------------------------------------------------------------------------

  /**
   * Goods handed over: fulfil the POS order into a sale. Outside a shared
   * transaction because fulfil and SalesService open their own; the web row
   * moves only after the sale exists, so a refused sale changes nothing.
   */
  private async handOver(id: string, web: typeof schema.webOrders.$inferSelect, dto: TransitionDto) {
    const user = RequestContext.requireUser();
    const { items, total, providerRef } = await this.withStorefront(() =>
      this.db.run(async (tx) => {
        const order = await tx.query.orders.findFirst({ where: (t, { eq: e }) => e(t.id, id) });
        const items = await tx.query.orderItems.findMany({ where: (t, { eq: e }) => e(t.orderId, id) });
        const paid = await tx.query.webPayments.findFirst({
          where: (t, { and: a, eq: e }) => a(e(t.orderId, id), e(t.status, "paid")),
        });
        return { items, total: order!.total, providerRef: paid?.providerRef ?? null };
      }),
    );

    const prepaid = web.paymentStatus === "paid";
    if (!prepaid && !dto.payment) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, "Record how this cash-on-delivery order was paid.");
    }
    const payment = prepaid
      ? { method: "card" as const, amount: Number(total), reference: providerRef ?? `web:${web.trackingToken}` }
      : { method: dto.payment!.method, amount: Number(total), ...(dto.payment!.reference ? { reference: dto.payment!.reference } : {}) };

    await this.withStorefront(() =>
      this.orders.fulfill(id, {
        lines: items
          .map((item) => ({
            orderItemId: item.id,
            quantity: Number(Money.toDecimalString(Money.subtract(Money.toMinor(item.quantity), Money.toMinor(item.fulfilledQuantity)), 4)),
          }))
          .filter((line) => line.quantity > 0),
        cashSessionId: dto.payment?.cashSessionId ?? null,
        payments: [payment],
      }),
    );

    await this.withStorefront(() =>
      this.db.run(async (tx) => {
        await tx
          .update(schema.webOrders)
          .set({ status: dto.status as WebOrderStatus, paymentStatus: "paid" })
          .where(eq(schema.webOrders.orderId, id));
        if (!prepaid) {
          await tx
            .update(schema.webPayments)
            .set({ status: "paid" })
            .where(and(eq(schema.webPayments.orderId, id), eq(schema.webPayments.provider, "cod")));
        }
        await this.webOrders.recordEvent(tx, id, dto.status as WebOrderStatus, dto.note ?? null, user.id);
      }),
    );
  }

  private async requireWeb(tx: Transaction, id: string) {
    const web = await tx.query.webOrders.findFirst({ where: (t, { eq: e }) => e(t.orderId, id) });
    if (!web) throw new AppError(ERROR_CODES.NOT_FOUND, "That online order does not exist.");
    return web;
  }

  /**
   * Staff routes have a tenant but no storefront scope. The order views
   * format money with the storefront's currency settings, so the scope is
   * attached here — resolved from the staff member's own tenant, never from
   * anything in the request.
   */
  private async withStorefront<T>(fn: () => Promise<T>): Promise<T> {
    if (!RequestContext.get()?.storefront) {
      const tenantId = RequestContext.requireTenantId();
      const storefront = await this.resolver.forTenant(tenantId, { evenIfDark: true });
      if (!storefront) throw new AppError(ERROR_CODES.STOREFRONT_NOT_FOUND, "Set up the online store first.");
      const store = RequestContext.get()!;
      const userTenant = store.tenantId;
      RequestContext.setStorefront(storefront);
      // setStorefront also sets the tenant; it is the same one, by construction.
      if (store.tenantId !== userTenant) throw new Error("Storefront scope changed the request's tenant");
    }
    return fn();
  }
}
