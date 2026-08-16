import { z } from "zod";

export const OpenSessionSchema = z.object({
  branchId: z.string().uuid(),
  deviceId: z.string().uuid().optional(),
  openingAmount: z.coerce.number().min(0),
  notes: z.string().trim().max(500).optional(),
});
export type OpenSessionDto = z.infer<typeof OpenSessionSchema>;

export const CloseSessionSchema = z.object({
  /** What was physically counted. The expected figure is revealed after. */
  countedAmount: z.coerce.number().min(0),
  /** Required when the drawer is short — enforced in the service. */
  notes: z.string().trim().max(500).optional(),
});
export type CloseSessionDto = z.infer<typeof CloseSessionSchema>;

export const CashMovementSchema = z.object({
  type: z.enum(["cash_in", "cash_out"]),
  amount: z.coerce.number().positive(),
  /** Mandatory — an unexplained drawer movement is what shrinkage hides behind. */
  reason: z.string().trim().min(3, "Explain the movement").max(500),
});
export type CashMovementDto = z.infer<typeof CashMovementSchema>;
