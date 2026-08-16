import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@devsfleet/shared-types";
import { z } from "zod";

export const CreateStockCountSchema = z.object({
  branchId: z.string().uuid().optional(),
  /**
   * Omit for a full count. Naming a category is how a shop counts the paint
   * aisle on a Tuesday without shutting for a day.
   */
  categoryId: z.string().uuid().nullable().optional(),
  notes: z.string().trim().max(1000).optional(),
});
export type CreateStockCountDto = z.infer<typeof CreateStockCountSchema>;

export const EnterCountSchema = z.object({
  /** What was physically on the shelf. Zero is a legitimate answer. */
  countedQuantity: z.coerce.number().min(0),
  notes: z.string().trim().max(500).optional(),
});
export type EnterCountDto = z.infer<typeof EnterCountSchema>;

export const ApproveCountSchema = z.object({
  /** Written onto every variance posted, so the ledger explains itself. */
  reason: z.string().trim().min(3, "Explain what the count found").max(500),
});
export type ApproveCountDto = z.infer<typeof ApproveCountSchema>;

export const ListStockCountsSchema = z.object({
  branchId: z.string().uuid().optional(),
  status: z.enum(["draft", "counting", "pending_approval", "approved", "cancelled"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type ListStockCountsDto = z.infer<typeof ListStockCountsSchema>;
