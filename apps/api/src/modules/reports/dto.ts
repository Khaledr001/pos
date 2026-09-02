import { z } from "zod";
import { zQueryBoolean } from "../../common/pipes/zod-validation.pipe.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");

/**
 * Every report takes the same window.
 *
 * `from` and `to` are inclusive CALENDAR dates at the branch, not timestamps.
 * A manager asking for "this month" means the days, and a half-open range in
 * UTC silently drops the last evening's trading in the Gulf.
 */
export const ReportRangeSchema = z.object({
  branchId: z.string().uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
export type ReportRangeDto = z.infer<typeof ReportRangeSchema>;

export const TopProductsSchema = ReportRangeSchema.extend({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  /** Revenue answers "what earns", quantity answers "what moves". */
  by: z.enum(["revenue", "quantity", "margin"]).default("revenue"),
});
export type TopProductsDto = z.infer<typeof TopProductsSchema>;

export const InventoryReportSchema = z.object({
  branchId: z.string().uuid().optional(),
  /** Only what needs attention: at or below the variant's minimum. */
  lowStockOnly: zQueryBoolean(false),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type InventoryReportDto = z.infer<typeof InventoryReportSchema>;
