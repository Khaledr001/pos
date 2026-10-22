import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, SERIAL_NUMBER_STATUSES } from "@devsfleet/shared-types";
import { z } from "zod";
import { sortSchema } from "../../common/db/list-query.js";

export const SearchSerialsSchema = z.object({
  q: z.string().trim().min(1, "Enter a serial number").max(120),
});
export type SearchSerialsDto = z.infer<typeof SearchSerialsSchema>;

export const MarkDamagedSchema = z.object({
  reason: z.string().trim().min(3, "Explain what happened to it").max(500),
});
export type MarkDamagedDto = z.infer<typeof MarkDamagedSchema>;

export const ListSerialsSchema = z.object({
  variantId: z.string().uuid().optional(),
  /** Every variant of one product — "all the drills of this model". */
  productId: z.string().uuid().optional(),
  status: z.enum(SERIAL_NUMBER_STATUSES).optional(),
  branchId: z.string().uuid().optional(),
  /** Serial, SKU or product name. */
  q: z.string().trim().max(120).optional(),
  ...sortSchema(["createdAt", "serial", "status", "expiryDate"], { sortBy: "createdAt", sortOrder: "desc" }),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type ListSerialsDto = z.infer<typeof ListSerialsSchema>;
