import { PRICE_LIST_TYPES, CURRENCIES } from "@devsfleet/shared-types";
import { z } from "zod";

const DATE_STRING = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const CreatePriceListSchema = z.object({
  name: z.string().trim().min(1).max(255),
  type: z.enum(PRICE_LIST_TYPES),
  currency: z.enum(CURRENCIES).default("AED"),
  isDefault: z.boolean().default(false),
});
export type CreatePriceListDto = z.infer<typeof CreatePriceListSchema>;

export const UpdatePriceListSchema = CreatePriceListSchema.partial().extend({
  isActive: z.boolean().optional(),
});
export type UpdatePriceListDto = z.infer<typeof UpdatePriceListSchema>;

export const ListPriceListsSchema = z.object({
  includeInactive: z.coerce.boolean().default(false),
});
export type ListPriceListsDto = z.infer<typeof ListPriceListsSchema>;

/**
 * One variant's price on one list. `effectiveFrom` defaults to today — the
 * common case is "this is the price from now on", not a scheduled future
 * change. Backdating (a date before the current row's own start) is refused
 * by the service: correcting history is what `reason` and price_history are
 * for, not silently rewriting when a price "started".
 */
export const SetProductPriceSchema = z.object({
  variantId: z.string().uuid(),
  priceListId: z.string().uuid(),
  sellingPrice: z.coerce.number().positive("A selling price is required"),
  purchasePrice: z.coerce.number().min(0).optional(),
  minSellingPrice: z.coerce.number().min(0).optional(),
  /**
   * Quantity break: 1 (the default) is the ordinary, untiered price. A
   * second row at e.g. 10 applies once the sold quantity reaches 10 —
   * each threshold has its own independent effective-dating timeline.
   */
  minQuantity: z.coerce.number().positive().default(1),
  effectiveFrom: DATE_STRING.optional(),
  /** Shown against the price_history row this write produces. */
  reason: z.string().trim().max(500).optional(),
});
export type SetProductPriceDto = z.infer<typeof SetProductPriceSchema>;

/**
 * Capped well above any realistic single request — this runs inside one
 * transaction, and an unbounded array is an unbounded lock duration.
 */
export const BulkSetProductPricesSchema = z.object({
  items: z.array(SetProductPriceSchema).min(1).max(1000),
});
export type BulkSetProductPricesDto = z.infer<typeof BulkSetProductPricesSchema>;

export const SetCustomerPriceSchema = z.object({
  customerId: z.string().uuid(),
  variantId: z.string().uuid(),
  specialPrice: z.coerce.number().positive("A price is required"),
  notes: z.string().trim().max(1000).optional(),
  effectiveFrom: DATE_STRING.optional(),
});
export type SetCustomerPriceDto = z.infer<typeof SetCustomerPriceSchema>;

export const ListPriceHistorySchema = z.object({
  variantId: z.string().uuid(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListPriceHistoryDto = z.infer<typeof ListPriceHistorySchema>;
