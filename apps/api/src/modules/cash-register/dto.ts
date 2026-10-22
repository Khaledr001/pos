import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@devsfleet/shared-types";
import { z } from "zod";
import { sortSchema } from "../../common/db/list-query.js";
import { zMoney } from "../../common/validation/money.js";

export const OpenSessionSchema = z.object({
  branchId: z.string().uuid(),
  deviceId: z.string().uuid().optional(),
  openingAmount: zMoney(),
  notes: z.string().trim().max(500).optional(),
  /**
   * Minted by the terminal when the drawer was opened offline. The server
   * upserts on it, so a push retried after a timeout reopens nothing.
   */
  localId: z.string().uuid().optional(),
  /** The terminal's clock at the moment the drawer opened. */
  openedAt: z.string().datetime().optional(),
});
export type OpenSessionDto = z.infer<typeof OpenSessionSchema>;

export const CloseSessionSchema = z.object({
  /** What was physically counted. The expected figure is revealed after. */
  countedAmount: zMoney(),
  /** Required when the drawer is short — enforced in the service. */
  notes: z.string().trim().max(500).optional(),
});
export type CloseSessionDto = z.infer<typeof CloseSessionSchema>;

export const CashMovementSchema = z.object({
  type: z.enum(["cash_in", "cash_out"]),
  amount: zMoney({ positive: true }),
  /** Mandatory — an unexplained drawer movement is what shrinkage hides behind. */
  reason: z.string().trim().min(3, "Explain the movement").max(500),
});
export type CashMovementDto = z.infer<typeof CashMovementSchema>;

/** Back-office drawer list. Read-only; the till's own endpoints are above. */
export const ListSessionsSchema = z.object({
  branchId: z.string().uuid().optional(),
  status: z.enum(["open", "closed"]).optional(),
  /** The cashier who opened the drawer. */
  userId: z.string().uuid().optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  /** Session number. */
  q: z.string().trim().max(50).optional(),
  ...sortSchema(["openedAt", "difference"], { sortBy: "openedAt", sortOrder: "desc" }),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type ListSessionsDto = z.infer<typeof ListSessionsSchema>;
