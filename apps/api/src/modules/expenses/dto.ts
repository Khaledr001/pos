import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, PAYMENT_METHODS } from "@devsfleet/shared-types";
import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");

export const CreateExpenseSchema = z.object({
  branchId: z.string().uuid().optional(),
  title: z.string().trim().min(1, "Give the expense a title").max(200),
  amount: z.coerce.number().positive("An expense must be more than zero"),
  /**
   * Free text, normalised for grouping. Trades invent their own categories —
   * "chai", "diesel", "municipality fine" — and a fixed enum is a list people
   * work around by putting everything in "other".
   */
  category: z.string().trim().max(80).optional(),
  expenseDate: isoDate.optional(),
  /** Cash comes out of the drawer; a bank transfer does not. */
  paymentMethod: z.enum(PAYMENT_METHODS).default("cash"),
  notes: z.string().trim().max(1000).optional(),
});
export type CreateExpenseDto = z.infer<typeof CreateExpenseSchema>;

export const UpdateExpenseSchema = CreateExpenseSchema.partial().omit({ branchId: true });
export type UpdateExpenseDto = z.infer<typeof UpdateExpenseSchema>;

export const ListExpensesSchema = z.object({
  branchId: z.string().uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  category: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type ListExpensesDto = z.infer<typeof ListExpensesSchema>;
