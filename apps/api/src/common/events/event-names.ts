/**
 * Names of every domain event a service may record.
 *
 * One entry today. The point of naming them here rather than inlining a
 * string at each `DomainEvents.record()` call site is the same reason
 * ERROR_CODES exists: a listener subscribes with `@OnEvent(DOMAIN_EVENTS.X)`,
 * and a typo in a string literal would silently produce a listener that never
 * fires rather than a compile error.
 */
export const DOMAIN_EVENTS = {
  LOW_STOCK_THRESHOLD_CROSSED: "inventory.low_stock_threshold_crossed",
} as const;

export type DomainEventName = (typeof DOMAIN_EVENTS)[keyof typeof DOMAIN_EVENTS];

/**
 * A stock movement dropped a variant's available quantity (on hand minus
 * reserved) to or below its minStock, having been above it a moment ago.
 *
 * Deliberately carries only ids and the two figures that produced the
 * crossing — not product/branch names. Resolving those is one more read, and
 * this event fires from inside StockService.post(), the one path every stock
 * movement in the system goes through. Listeners run off the request's
 * response path and can afford the join; the write path cannot.
 */
export interface LowStockThresholdCrossedPayload {
  variantId: string;
  branchId: string;
  /** Decimal string: on hand minus reserved, at the moment the crossing was detected. */
  available: string;
  /** Decimal string, snapshotted so the notification still makes sense if the threshold later changes. */
  minStock: string;
}
