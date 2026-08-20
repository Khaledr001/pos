import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, QUOTATION_STATUSES } from "@devsfleet/shared-types";
import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");

const QuotationLineSchema = z.object({
  variantId: z.string().uuid(),
  quantity: z.coerce.number().positive(),
  /** Omit to quote the resolved price. Present = a negotiated figure. */
  unitPrice: z.string().optional(),
  discountPercent: z.coerce.number().min(0).max(100).optional(),
});

export const CreateQuotationSchema = z.object({
  branchId: z.string().uuid().optional(),
  customerId: z.string().uuid().nullable().optional(),
  lines: z.array(QuotationLineSchema).min(1, "A quotation needs at least one line"),
  documentDiscountPercent: z.coerce.number().min(0).max(100).optional(),

  /**
   * A quote with no expiry is a price promise with no end.
   * Defaults to the tenant's configured validity when omitted.
   */
  validUntil: isoDate.optional(),
  notes: z.string().trim().max(1000).optional(),
  localId: z.string().uuid().optional(),
  occurredAt: z.string().datetime().optional(),
});
export type CreateQuotationDto = z.infer<typeof CreateQuotationSchema>;

export const ListQuotationsSchema = z.object({
  branchId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  status: z.enum(QUOTATION_STATUSES).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type ListQuotationsDto = z.infer<typeof ListQuotationsSchema>;

export const ConvertQuotationSchema = z.object({
  /** Where it is being rung up, which need not be where it was quoted. */
  branchId: z.string().uuid().optional(),
  cashSessionId: z.string().uuid().nullable().optional(),
  payments: z
    .array(
      z.object({
        method: z.string(),
        amount: z.coerce.number().positive(),
        reference: z.string().trim().max(100).optional(),
      }),
    )
    .default([]),
});
export type ConvertQuotationDto = z.infer<typeof ConvertQuotationSchema>;

export const ConvertQuotationToOrderSchema = z.object({
  /** Where it will be picked up, which need not be where it was quoted. */
  branchId: z.string().uuid().optional(),
  expectedReadyAt: z.string().datetime().optional(),
});
export type ConvertQuotationToOrderDto = z.infer<typeof ConvertQuotationToOrderSchema>;
