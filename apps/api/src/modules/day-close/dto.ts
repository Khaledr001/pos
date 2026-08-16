import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@devsfleet/shared-types";
import { z } from "zod";

/** ISO calendar date. The day is the unit of reconciliation, not a timestamp. */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");

export const OpenDaySchema = z.object({
  branchId: z.string().uuid().optional(),
  /** Defaults to today at the branch. */
  date: isoDate.optional(),
  /** Cash physically in the drawer at open. */
  openingFloat: z.coerce.number().min(0),
  notes: z.string().trim().max(1000).optional(),
});
export type OpenDayDto = z.infer<typeof OpenDaySchema>;

export const CloseDaySchema = z.object({
  /** What was physically counted. The expected figure is revealed after. */
  countedCash: z.coerce.number().min(0),
  notes: z.string().trim().max(1000).optional(),
});
export type CloseDayDto = z.infer<typeof CloseDaySchema>;

export const PreviewDaySchema = z.object({
  branchId: z.string().uuid().optional(),
  date: isoDate.optional(),
});
export type PreviewDayDto = z.infer<typeof PreviewDaySchema>;

export const ListDaysSchema = z.object({
  branchId: z.string().uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type ListDaysDto = z.infer<typeof ListDaysSchema>;
