import { z } from "zod";

export const AddCartItemSchema = z.object({
  variantId: z.string().uuid(),
  /** The unit's abbreviation, as the product page lists it. Omit for the base unit. */
  uom: z.string().trim().max(20).optional(),
  quantity: z.coerce.number().positive().max(100_000),
});
export type AddCartItemDto = z.infer<typeof AddCartItemSchema>;

/** 0 removes the line. */
export const UpdateCartItemSchema = z.object({
  quantity: z.coerce.number().min(0).max(100_000),
});
export type UpdateCartItemDto = z.infer<typeof UpdateCartItemSchema>;

export const ApplyCouponSchema = z.object({
  code: z.string().trim().min(1).max(40),
});
export type ApplyCouponDto = z.infer<typeof ApplyCouponSchema>;
