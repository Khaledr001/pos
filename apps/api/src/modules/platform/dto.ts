import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, PLAN_IDS } from "@devsfleet/shared-types";
import { z } from "zod";

export const ListTenantsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  q: z.string().trim().max(255).optional(),
  planId: z.enum(PLAN_IDS).optional(),
  status: z.enum(["active", "suspended"]).optional(),
});
export type ListTenantsDto = z.infer<typeof ListTenantsSchema>;

export const ChangePlanSchema = z.object({
  planId: z.enum(PLAN_IDS),
  /** Extends the paid period. Omit to leave it unchanged. */
  subscriptionEndsAt: z.string().datetime().optional(),
});
export type ChangePlanDto = z.infer<typeof ChangePlanSchema>;

export const SuspendTenantSchema = z.object({
  /**
   * Mandatory, and shown to the tenant's users at login. A suspension nobody
   * can explain generates a support ticket that takes longer than writing the
   * reason would have.
   */
  reason: z.string().trim().min(3).max(500),
});
export type SuspendTenantDto = z.infer<typeof SuspendTenantSchema>;
