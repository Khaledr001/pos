import { DEFAULT_PAGE_SIZE, DOCUMENT_SOURCES, MAX_PAGE_SIZE, PAYMENT_METHODS } from "@devsfleet/shared-types";
import { z } from "zod";

const SaleLineSchema = z.object({
  variantId: z.string().uuid(),
  quantity: z.coerce.number().positive(),
  /** Omit to take the resolved price. Present = an override, floor-checked. */
  unitPrice: z.string().optional(),
  discountPercent: z.coerce.number().min(0).max(100).optional(),
  /**
   * Required, one per unit, when the product tracks serial numbers. Each is
   * claimed and marked sold at the branch this sale is rung up at — a serial
   * checked in at a different branch is refused, the same as selling stock a
   * branch does not physically hold.
   */
  serials: z.array(z.string().trim().min(1)).optional(),
});

const PaymentSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  amount: z.coerce.number().positive(),
  reference: z.string().trim().max(100).optional(),
});

export const CreateSaleSchema = z.object({
  branchId: z.string().uuid(),
  customerId: z.string().uuid().nullable().optional(),
  cashSessionId: z.string().uuid().nullable().optional(),
  source: z.enum(DOCUMENT_SOURCES).default("pos"),

  lines: z.array(SaleLineSchema).min(1, "A sale needs at least one line"),
  payments: z.array(PaymentSchema).default([]),
  documentDiscountPercent: z.coerce.number().min(0).max(100).optional(),
  notes: z.string().trim().max(1000).optional(),

  /**
   * Loyalty points the customer wants to spend against this sale, funding it
   * the same way a payment does. Capped server-side at the sale total — see
   * the service for why an overshoot is refused rather than partially honoured.
   */
  redeemPoints: z.coerce.number().int().positive().optional(),

  /**
   * Minted on the terminal. The idempotency key — the server upserts on it, so
   * a push retried after a timeout cannot create a second invoice.
   */
  clientId: z.string().uuid().optional(),
  /** The terminal's clock at the moment of sale. Hours before createdAt offline. */
  occurredAt: z.string().datetime().optional(),
});
export type CreateSaleDto = z.infer<typeof CreateSaleSchema>;

export const ListSalesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  branchId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});
export type ListSalesDto = z.infer<typeof ListSalesSchema>;
