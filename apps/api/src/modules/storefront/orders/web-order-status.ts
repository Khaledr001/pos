import type { DeliveryMethod, WebOrderStatus } from "@devsfleet/shared-types";

/**
 * The web order lifecycle. Forward steps may be skipped (placed -> packed),
 * never reversed.
 *
 *   pending_payment -> placed            only by a payment, never by staff
 *   placed -> confirmed -> packed        both still a `processing` POS order
 *   packed -> shipped -> delivered       courier
 *   packed -> ready_for_pickup -> collected   pickup; `ready` on the POS
 *   delivered / collected                the POS order is fulfilled into a sale
 *   * -> cancelled                       until anything has been handed over
 */
const RANK: Partial<Record<WebOrderStatus, number>> = {
  pending_payment: 0,
  placed: 1,
  confirmed: 2,
  packed: 3,
  shipped: 4,
  ready_for_pickup: 4,
  delivered: 5,
  collected: 5,
};

const COURIER_ONLY: WebOrderStatus[] = ["shipped", "delivered"];
const PICKUP_ONLY: WebOrderStatus[] = ["ready_for_pickup", "collected"];
/** Shipped goods are on a van: cancelling would release stock that is no longer on the shelf. */
const CANCELLABLE: WebOrderStatus[] = ["pending_payment", "placed", "confirmed", "packed", "ready_for_pickup"];

/** The two steps that hand goods over and turn the order into a sale. */
export const HANDOVER: WebOrderStatus[] = ["delivered", "collected"];

export function canTransition(from: WebOrderStatus, to: WebOrderStatus, method: DeliveryMethod): boolean {
  if (from === to) return false;
  if (to === "cancelled") return CANCELLABLE.includes(from);
  // Refunds are their own action (they move money), and payment is the gateway's.
  if (to === "refunded" || to === "pending_payment" || to === "placed") return false;
  if (method === "courier" && PICKUP_ONLY.includes(to)) return false;
  if (method === "pickup" && COURIER_ONLY.includes(to)) return false;
  const a = RANK[from];
  const b = RANK[to];
  // Nothing moves out of pending_payment by hand: an unpaid order is not the warehouse's yet.
  return a !== undefined && b !== undefined && a >= 1 && b > a;
}

/** The statuses a staff member may choose next, for the order desk's buttons. */
export function nextStatuses(from: WebOrderStatus, method: DeliveryMethod): WebOrderStatus[] {
  const candidates: WebOrderStatus[] = ["confirmed", "packed", "shipped", "ready_for_pickup", "delivered", "collected", "cancelled"];
  return candidates.filter((to) => canTransition(from, to, method));
}
