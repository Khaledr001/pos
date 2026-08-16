import { DEFAULT_PAGE_SIZE, DOCUMENT_SOURCES, MAX_PAGE_SIZE, PAYMENT_METHODS } from "@devsfleet/shared-types";
import { z } from "zod";

const SaleLineSchema = z.object({
  variantId: z.string().uuid(),
  quantity: z.coerce.number().positive(),
  /** Omit to take the resolved price. Present = an override, floor-checked. */
  unitPrice: z.string().optional(),
  discountPercent: z.coerce.number().min(0).max(100).optional(),
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
