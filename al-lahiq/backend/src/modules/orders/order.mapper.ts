import { money } from '../../common/money.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { nextStatuses } from './order-status.js';

export const orderViewInclude = {
  lines: {
    include: {
      variant: {
        select: {
          product: {
            select: { slug: true, images: { orderBy: { sortOrder: 'asc' }, take: 1, select: { url: true } } },
          },
        },
      },
    },
  },
  statusHistory: { orderBy: { createdAt: 'asc' } },
  shipments: { orderBy: { createdAt: 'desc' } },
  pickupBranch: true,
  invoice: true,
} satisfies Prisma.OrderInclude;

export type OrderViewRow = Prisma.OrderGetPayload<{ include: typeof orderViewInclude }>;

export function toOrderView(o: OrderViewRow) {
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    trackingToken: o.trackingToken,
    status: o.status,
    paymentStatus: o.paymentStatus,
    paymentMethod: o.paymentMethod,
    deliveryMethod: o.deliveryMethod,
    placedAt: o.placedAt,
    createdAt: o.createdAt,
    contact: { fullName: o.fullName, email: o.email, phone: o.phone },
    companyName: o.companyName,
    trn: o.trn,
    shippingAddress: o.shippingAddress as Record<string, string> | null,
    pickup: o.pickupBranch
      ? {
          branch: { name: o.pickupBranch.name, address: o.pickupBranch.address, phone: o.pickupBranch.phone },
          slotStart: o.pickupSlotStart,
          slotEnd: o.pickupSlotEnd,
        }
      : null,
    lines: o.lines.map((l) => ({
      id: l.id,
      variantId: l.variantId,
      sku: l.sku,
      name: l.name,
      uom: l.uom,
      quantity: Number(l.quantity),
      unitPrice: money(l.unitNetFils + Math.round((l.unitNetFils * l.vatRateBps) / 10_000)),
      unitNet: money(l.unitNetFils),
      lineTotal: money(l.lineTotalFils),
      productSlug: l.variant?.product.slug ?? null,
      imageUrl: l.variant?.product.images[0]?.url ?? null,
    })),
    totals: {
      subtotalNet: money(o.subtotalNetFils),
      discountNet: money(o.discountNetFils),
      shippingNet: money(o.shippingNetFils),
      vat: money(o.vatFils),
      total: money(o.totalFils),
    },
    couponCode: o.couponCode,
    notes: o.notes,
    shipments: o.shipments.map((s) => ({
      courier: s.courier,
      trackingNumber: s.trackingNumber,
      trackingUrl: s.trackingUrl,
      status: s.status,
      createdAt: s.createdAt,
    })),
    timeline: o.statusHistory.map((h) => ({ status: h.status, note: h.note, at: h.createdAt })),
    invoice: o.invoice ? { number: o.invoice.invoiceNumber, issuedAt: o.invoice.issuedAt } : null,
  };
}

export function toAdminOrderView(o: OrderViewRow) {
  return {
    ...toOrderView(o),
    timeline: o.statusHistory.map((h) => ({ status: h.status, note: h.note, actor: h.actor, at: h.createdAt })),
    lines: o.lines.map((l) => ({
      ...toOrderView({ ...o, lines: [l] }).lines[0],
      priceListCode: l.priceListCode,
      priceVersion: l.priceVersion,
      retailUnitNet: money(l.unitRetailNetFils),
    })),
    nextStatuses: nextStatuses(o.status, o.deliveryMethod, o.paymentStatus === 'PAID'),
  };
}
