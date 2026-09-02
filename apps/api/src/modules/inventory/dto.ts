import { DEFAULT_PAGE_SIZE, INVENTORY_TX_TYPES, MAX_PAGE_SIZE } from "@devsfleet/shared-types";
import { z } from "zod";
import { zQueryBoolean } from "../../common/pipes/zod-validation.pipe.js";

export const ListStockSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  q: z.string().trim().max(255).optional(),
  branchId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  lowStockOnly: zQueryBoolean(false),
});
export type ListStockDto = z.infer<typeof ListStockSchema>;

export const ListTransactionsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  variantId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  type: z.enum(INVENTORY_TX_TYPES).optional(),
  /** ISO dates, inclusive. */
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});
export type ListTransactionsDto = z.infer<typeof ListTransactionsSchema>;

export const AdjustStockSchema = z.object({
  variantId: z.string().uuid(),
  branchId: z.string().uuid(),
  /**
   * The ABSOLUTE new quantity, not a delta — a stock count says "there are 47
   * on the shelf". The service works out the movement.
   *
   * Negative is permitted: a count can legitimately reveal that the books were
   * already wrong, and forcing zero would hide it.
   */
  newQuantity: z.coerce.number(),
  /** Mandatory. An unexplained adjustment is what shrinkage hides behind. */
  reason: z.string().trim().min(3, "Explain the adjustment").max(500),
});
export type AdjustStockDto = z.infer<typeof AdjustStockSchema>;

export const TransferStockSchema = z
  .object({
    variantId: z.string().uuid(),
    fromBranchId: z.string().uuid(),
    toBranchId: z.string().uuid(),
    quantity: z.coerce.number().positive("Transfer a positive quantity"),
    notes: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.fromBranchId !== v.toBranchId, {
    message: "Source and destination must differ",
    path: ["toBranchId"],
  });
export type TransferStockDto = z.infer<typeof TransferStockSchema>;
