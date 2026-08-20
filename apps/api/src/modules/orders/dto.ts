import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, ORDER_STATUSES, PAYMENT_METHODS } from "@devsfleet/shared-types";
import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");

const OrderLineSchema = z.object({
  variantId: z.string().uuid(),
  quantity: z.coerce.number().positive(),
  /** Omit to take the resolved price. Present = a negotiated figure. */
  unitPrice: z.string().optional(),
  discountPercent: z.coerce.number().min(0).max(100).optional(),
});

export const CreateOrderSchema = z.object({
  branchId: z.string().uuid().optional(),
  customerId: z.string().uuid().nullable().optional(),
  /** Set when this order came from an accepted quotation. */
  quotationId: z.string().uuid().optional(),
  lines: z.array(OrderLineSchema).min(1, "An order needs at least one line"),
  documentDiscountPercent: z.coerce.number().min(0).max(100).optional(),
  expectedReadyAt: z.string().datetime().optional(),
  notes: z.string().trim().max(1000).optional(),
  localId: z.string().uuid().optional(),
  occurredAt: z.string().datetime().optional(),
});
export type CreateOrderDto = z.infer<typeof CreateOrderSchema>;

export const ListOrdersSchema = z.object({
  branchId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type ListOrdersDto = z.infer<typeof ListOrdersSchema>;

export const CancelOrderSchema = z.object({
  reason: z.string().trim().min(1, "A cancellation needs a reason"),
});
export type CancelOrderDto = z.infer<typeof CancelOrderSchema>;

/**
 * Hand over some or all of an order's remaining lines. Each fulfilment is its
 * own invoice — a customer collecting a large order across several visits
 * pays for what they take each time, not for the whole order up front.
 */
export const FulfillOrderSchema = z.object({
  lines: z
    .array(
      z.object({
        orderItemId: z.string().uuid(),
        quantity: z.coerce.number().positive(),
      }),
    )
    .min(1, "Fulfilling an order needs at least one line"),
  cashSessionId: z.string().uuid().nullable().optional(),
  payments: z
    .array(
      z.object({
        method: z.enum(PAYMENT_METHODS),
        amount: z.coerce.number().positive(),
        reference: z.string().trim().max(100).optional(),
      }),
    )
    .default([]),
});
export type FulfillOrderDto = z.infer<typeof FulfillOrderSchema>;
