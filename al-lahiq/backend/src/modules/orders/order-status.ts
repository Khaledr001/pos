import type { DeliveryMethod, OrderStatus } from '../../generated/prisma/enums.js';

/** Order lifecycle. Forward steps may be skipped (e.g. PLACED → PACKED). */
const RANK: Partial<Record<OrderStatus, number>> = {
  PENDING_PAYMENT: 0,
  PLACED: 1,
  CONFIRMED: 2,
  PACKED: 3,
  SHIPPED: 4,
  READY_FOR_PICKUP: 4,
  DELIVERED: 5,
  COLLECTED: 5,
};

const COURIER_ONLY: OrderStatus[] = ['SHIPPED', 'DELIVERED'];
const PICKUP_ONLY: OrderStatus[] = ['READY_FOR_PICKUP', 'COLLECTED'];
const CANCELLABLE: OrderStatus[] = ['PENDING_PAYMENT', 'PLACED', 'CONFIRMED', 'PACKED', 'READY_FOR_PICKUP'];

export function canTransition(
  from: OrderStatus,
  to: OrderStatus,
  method: DeliveryMethod,
  paid: boolean,
): boolean {
  if (from === to) return false;
  if (to === 'CANCELLED') return CANCELLABLE.includes(from);
  if (to === 'REFUNDED') return paid && ['CANCELLED', 'DELIVERED', 'COLLECTED'].includes(from);
  if (to === 'PENDING_PAYMENT') return false;
  if (method === 'COURIER' && PICKUP_ONLY.includes(to)) return false;
  if (method === 'PICKUP' && COURIER_ONLY.includes(to)) return false;
  // PLACED only comes from payment/COD confirmation, never from a staff action.
  if (to === 'PLACED') return from === 'PENDING_PAYMENT';
  const a = RANK[from];
  const b = RANK[to];
  return a !== undefined && b !== undefined && a >= 1 && b > a;
}

/** Next statuses a staff member can choose in the admin panel. */
export function nextStatuses(from: OrderStatus, method: DeliveryMethod, paid: boolean): OrderStatus[] {
  const all: OrderStatus[] = [
    'CONFIRMED', 'PACKED', 'SHIPPED', 'READY_FOR_PICKUP', 'DELIVERED', 'COLLECTED', 'CANCELLED',
  ];
  return all.filter((to) => canTransition(from, to, method, paid));
}

export const NOTIFY_ON: Partial<Record<OrderStatus, string>> = {
  CONFIRMED: 'order_confirmed',
  SHIPPED: 'order_shipped',
  READY_FOR_PICKUP: 'order_ready_for_pickup',
  DELIVERED: 'order_delivered',
  COLLECTED: 'order_collected',
  CANCELLED: 'order_cancelled',
};
