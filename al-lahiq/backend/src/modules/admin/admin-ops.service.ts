import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { ApiError } from '../../common/api-error.js';
import { money } from '../../common/money.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { Emirate } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { toCustomerDto, toStaffDto } from '../auth/auth.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { toAdminOrderView } from '../orders/order.mapper.js';
import { OrdersService } from '../orders/orders.service.js';
import { RevalidationService } from '../revalidation/revalidation.service.js';
import {
  AdminCustomerQueryDto,
  AdminOrderQueryDto,
  BannerDto,
  BranchDto,
  ChangeOrderStatusDto,
  CouponDto,
  PageDto,
  ShippingRateDto,
  StaffDto,
  UpdateBannerDto,
  UpdateBranchDto,
  UpdateCouponDto,
  UpdatePageDto,
  UpdateStaffDto,
} from './admin.dto.js';

const tags = RevalidationService.tags;

async function unique<T>(fn: () => Promise<T>, what: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw ApiError.conflict('DUPLICATE', `A ${what} with this code or slug already exists`);
    }
    throw err;
  }
}

const date = (v?: string | null) => (v === undefined ? undefined : v === null ? null : new Date(v));

/** Orders, customers, content, settings and reports for the admin panel. */
@Injectable()
export class AdminOpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly notifications: NotificationsService,
    private readonly revalidation: RevalidationService,
  ) {}

  // ── orders ──

  async listOrders(q: AdminOrderQueryDto) {
    const where: Prisma.OrderWhereInput = {
      ...(q.status ? { status: q.status } : { status: { not: 'PENDING_PAYMENT' } }),
      ...(q.deliveryMethod ? { deliveryMethod: q.deliveryMethod } : {}),
      ...(q.from || q.to
        ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } }
        : {}),
      ...(q.q
        ? {
            OR: [
              { orderNumber: { contains: q.q, mode: 'insensitive' } },
              { email: { contains: q.q, mode: 'insensitive' } },
              { phone: { contains: q.q } },
              { fullName: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, rows, counts] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { pickupBranch: { select: { name: true } }, _count: { select: { lines: true } } },
      }),
      this.prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      statusCounts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
      items: rows.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        createdAt: o.createdAt,
        placedAt: o.placedAt,
        fullName: o.fullName,
        phone: o.phone,
        status: o.status,
        paymentStatus: o.paymentStatus,
        paymentMethod: o.paymentMethod,
        deliveryMethod: o.deliveryMethod,
        emirate: (o.shippingAddress as { emirate?: Emirate } | null)?.emirate ?? null,
        pickupBranch: o.pickupBranch?.name ?? null,
        pickupSlotStart: o.pickupSlotStart,
        itemCount: o._count.lines,
        total: money(o.totalFils),
      })),
    };
  }

  async order(id: string) {
    return toAdminOrderView(await this.orders.getView({ id }));
  }

  async changeStatus(id: string, dto: ChangeOrderStatusDto, actor: string) {
    if (dto.status === 'SHIPPED' && !dto.trackingNumber) {
      throw ApiError.badRequest('TRACKING_REQUIRED', 'Enter the courier tracking number');
    }
    const order = await this.orders.transition(id, dto.status, {
      actor,
      note: dto.note,
      shipment: dto.trackingNumber
        ? { courier: dto.courier ?? 'manual', trackingNumber: dto.trackingNumber, trackingUrl: dto.trackingUrl }
        : undefined,
    });
    return toAdminOrderView(order);
  }

  // ── customers ──

  async listCustomers(q: AdminCustomerQueryDto) {
    const where: Prisma.CustomerWhereInput = {
      ...(q.tradeStatus ? { tradeStatus: q.tradeStatus } : {}),
      ...(q.q
        ? {
            OR: [
              { email: { contains: q.q, mode: 'insensitive' } },
              { firstName: { contains: q.q, mode: 'insensitive' } },
              { lastName: { contains: q.q, mode: 'insensitive' } },
              { companyName: { contains: q.q, mode: 'insensitive' } },
              { phone: { contains: q.q } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { _count: { select: { orders: true } } },
      }),
    ]);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((c) => ({ ...toCustomerDto(c), createdAt: c.createdAt, orderCount: c._count.orders })),
    };
  }

  async customer(id: string) {
    const c = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        priceLists: { include: { priceList: { select: { code: true, name: true, type: true } } } },
        addresses: true,
        orders: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!c) throw ApiError.notFound('Customer');
    const spent = await this.prisma.order.aggregate({
      where: { customerId: id, status: { notIn: ['CANCELLED', 'PENDING_PAYMENT', 'REFUNDED'] } },
      _sum: { totalFils: true },
    });
    return {
      ...toCustomerDto(c),
      posCustomerCode: c.posCustomerCode,
      createdAt: c.createdAt,
      priceLists: c.priceLists.map((p) => p.priceList),
      addresses: c.addresses,
      totalSpent: money(spent._sum.totalFils ?? 0),
      orders: c.orders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        createdAt: o.createdAt,
        total: money(o.totalFils),
      })),
    };
  }

  /** Price tiers are assigned in the POS; approval just unlocks the trade account. */
  async tradeDecision(id: string, decision: 'approve' | 'reject') {
    const c = await this.prisma.customer.update({
      where: { id },
      data:
        decision === 'approve'
          ? { tradeStatus: 'APPROVED', type: 'TRADE' }
          : { tradeStatus: 'REJECTED', type: 'RETAIL' },
    });
    await this.notifications.customer(decision === 'approve' ? 'trade_approved' : 'trade_rejected', id);
    return toCustomerDto(c);
  }

  // ── content ──

  pages(kind?: string) {
    return this.prisma.page.findMany({
      where: kind ? { kind } : {},
      orderBy: { updatedAt: 'desc' },
      select: { id: true, slug: true, title: true, kind: true, published: true, publishedAt: true, updatedAt: true },
    });
  }

  async page(id: string) {
    const p = await this.prisma.page.findUnique({ where: { id } });
    if (!p) throw ApiError.notFound('Page');
    return p;
  }

  async createPage(dto: PageDto) {
    const p = await unique(
      () => this.prisma.page.create({ data: { ...dto, publishedAt: dto.published ? new Date() : null } }),
      'page',
    );
    this.revalidation.revalidate(tags.page(p.slug), tags.content);
    return p;
  }

  async updatePage(id: string, dto: UpdatePageDto) {
    const before = await this.page(id);
    const p = await unique(
      () =>
        this.prisma.page.update({
          where: { id },
          data: { ...dto, ...(dto.published && !before.publishedAt ? { publishedAt: new Date() } : {}) },
        }),
      'page',
    );
    this.revalidation.revalidate(tags.page(before.slug), tags.page(p.slug), tags.content);
    return p;
  }

  async deletePage(id: string) {
    const p = await this.prisma.page.delete({ where: { id } });
    this.revalidation.revalidate(tags.page(p.slug), tags.content);
  }

  banners() {
    return this.prisma.banner.findMany({ orderBy: [{ placement: 'asc' }, { sortOrder: 'asc' }] });
  }

  async createBanner(dto: BannerDto) {
    const b = await this.prisma.banner.create({
      data: { ...dto, startsAt: date(dto.startsAt), endsAt: date(dto.endsAt) },
    });
    this.revalidation.revalidate(tags.home);
    return b;
  }

  async updateBanner(id: string, dto: UpdateBannerDto) {
    const b = await this.prisma.banner.update({
      where: { id },
      data: { ...dto, startsAt: date(dto.startsAt), endsAt: date(dto.endsAt) },
    });
    this.revalidation.revalidate(tags.home);
    return b;
  }

  async deleteBanner(id: string) {
    await this.prisma.banner.delete({ where: { id } });
    this.revalidation.revalidate(tags.home);
  }

  // ── promotions & delivery ──

  coupons() {
    return this.prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } });
  }

  createCoupon(dto: CouponDto) {
    return unique(
      () =>
        this.prisma.coupon.create({ data: { ...dto, validFrom: date(dto.validFrom), validTo: date(dto.validTo) } }),
      'coupon',
    );
  }

  updateCoupon(id: string, dto: UpdateCouponDto) {
    return unique(
      () =>
        this.prisma.coupon.update({
          where: { id },
          data: { ...dto, validFrom: date(dto.validFrom), validTo: date(dto.validTo) },
        }),
      'coupon',
    );
  }

  async deleteCoupon(id: string) {
    await this.prisma.coupon.delete({ where: { id } });
  }

  shippingRates() {
    return this.prisma.shippingRate.findMany({ orderBy: { emirate: 'asc' } });
  }

  upsertShippingRate(emirate: Emirate, dto: ShippingRateDto) {
    return this.prisma.shippingRate.upsert({ where: { emirate }, create: { emirate, ...dto }, update: dto });
  }

  branches() {
    return this.prisma.branch.findMany({ orderBy: { name: 'asc' } });
  }

  async createBranch(dto: BranchDto) {
    const b = await unique(() => this.prisma.branch.create({ data: dto }), 'branch');
    this.revalidation.revalidate(tags.content);
    return b;
  }

  async updateBranch(id: string, dto: UpdateBranchDto) {
    const b = await unique(() => this.prisma.branch.update({ where: { id }, data: dto }), 'branch');
    this.revalidation.revalidate(tags.content, tags.catalog);
    return b;
  }

  // ── staff ──

  async staff() {
    return (await this.prisma.staffUser.findMany({ orderBy: { name: 'asc' } })).map(toStaffDto);
  }

  async createStaff(dto: StaffDto) {
    const { password, ...rest } = dto;
    const passwordHash = await argon2.hash(password);
    const s = await unique(
      () => this.prisma.staffUser.create({ data: { ...rest, passwordHash } }),
      'staff member',
    );
    return toStaffDto(s);
  }

  async updateStaff(id: string, dto: UpdateStaffDto, actorId: string) {
    if (id === actorId && (dto.active === false || (dto.role && dto.role !== 'OWNER'))) {
      throw ApiError.badRequest('SELF_LOCKOUT', 'You cannot deactivate or demote yourself');
    }
    const { password, ...rest } = dto;
    const s = await this.prisma.staffUser.update({
      where: { id },
      data: { ...rest, ...(password ? { passwordHash: await argon2.hash(password) } : {}) },
    });
    if (dto.active === false || password) {
      await this.prisma.refreshToken.updateMany({
        where: { subjectType: 'staff', subjectId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return toStaffDto(s);
  }

  // ── reports ──

  async dashboard(days: number) {
    const since = new Date(Date.now() - days * 86_400_000);
    const live: Prisma.OrderWhereInput = {
      placedAt: { gte: since },
      status: { notIn: ['CANCELLED', 'PENDING_PAYMENT', 'REFUNDED'] },
    };

    const [daily, totals, topProducts, abandoned, failedSearches, byStatus, pendingTrade] = await Promise.all([
      this.prisma.$queryRaw<{ day: Date; orders: bigint; total: bigint }[]>`
        SELECT date_trunc('day', "placedAt" AT TIME ZONE 'Asia/Dubai') AS day,
               COUNT(*) AS orders, COALESCE(SUM("totalFils"), 0) AS total
        FROM orders
        WHERE "placedAt" >= ${since} AND status NOT IN ('CANCELLED', 'PENDING_PAYMENT', 'REFUNDED')
        GROUP BY 1 ORDER BY 1`,
      this.prisma.order.aggregate({
        where: live,
        _count: { _all: true },
        _sum: { totalFils: true, vatFils: true },
      }),
      this.prisma.$queryRaw<{ sku: string; name: string; qty: number; revenue: bigint }[]>`
        SELECT ol.sku, MAX(ol.name) AS name, SUM(ol.quantity)::float AS qty, SUM(ol."lineTotalFils") AS revenue
        FROM order_lines ol JOIN orders o ON o.id = ol."orderId"
        WHERE o."placedAt" >= ${since} AND o.status NOT IN ('CANCELLED', 'PENDING_PAYMENT', 'REFUNDED')
        GROUP BY ol.sku ORDER BY revenue DESC LIMIT 10`,
      this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(DISTINCT c.id) AS count FROM carts c JOIN cart_items ci ON ci."cartId" = c.id
        WHERE c.status = 'ACTIVE' AND c."updatedAt" < now() - interval '24 hours' AND c."updatedAt" >= ${since}`,
      this.prisma.$queryRaw<{ term: string; count: bigint }[]>`
        SELECT term, COUNT(*) AS count FROM search_logs
        WHERE results = 0 AND "createdAt" >= ${since}
        GROUP BY term ORDER BY count DESC LIMIT 15`,
      this.prisma.order.groupBy({ by: ['status'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
      this.prisma.customer.count({ where: { tradeStatus: 'PENDING' } }),
    ]);

    const orders = totals._count._all;
    const revenue = totals._sum.totalFils ?? 0;
    return {
      days,
      totals: {
        orders,
        revenue: money(revenue),
        vat: money(totals._sum.vatFils ?? 0),
        averageOrder: money(orders ? Math.round(revenue / orders) : 0),
      },
      daily: daily.map((d) => ({ day: d.day, orders: Number(d.orders), revenue: money(Number(d.total)) })),
      topProducts: topProducts.map((p) => ({ sku: p.sku, name: p.name, quantity: p.qty, revenue: money(Number(p.revenue)) })),
      abandonedCarts: Number(abandoned[0]?.count ?? 0),
      failedSearches: failedSearches.map((f) => ({ term: f.term, count: Number(f.count) })),
      ordersByStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
      pendingTradeApplications: pendingTrade,
    };
  }

  // ── sync monitor ──

  async syncStatus() {
    const day = new Date(Date.now() - 86_400_000);
    const [lastRuns, outbox, inbound, recentFailures] = await Promise.all([
      this.prisma.syncRun.findMany({ orderBy: { startedAt: 'desc' }, take: 5 }),
      this.prisma.outboxEvent.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.inboundEvent.groupBy({ by: ['status'], where: { receivedAt: { gte: day } }, _count: { _all: true } }),
      this.prisma.inboundEvent.findMany({
        where: { status: 'FAILED' },
        orderBy: { receivedAt: 'desc' },
        take: 10,
        select: { id: true, eventId: true, type: true, error: true, attempts: true, receivedAt: true },
      }),
    ]);
    const lastInbound = await this.prisma.inboundEvent.findFirst({ orderBy: { receivedAt: 'desc' }, select: { receivedAt: true } });
    return {
      lastEventAt: lastInbound?.receivedAt ?? null,
      reconciliation: lastRuns,
      outbox: Object.fromEntries(outbox.map((o) => [o.status, o._count._all])),
      inboundLast24h: Object.fromEntries(inbound.map((o) => [o.status, o._count._all])),
      recentInboundFailures: recentFailures,
    };
  }

  outboxEvents(status?: string) {
    return this.prisma.outboxEvent.findMany({
      where: status ? { status: status as never } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  inboundEvents(status?: string) {
    return this.prisma.inboundEvent.findMany({
      where: status ? { status: status as never } : {},
      orderBy: { receivedAt: 'desc' },
      take: 100,
    });
  }
}
