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
  subscriptionEndsAt: z.string().datetime().optional().nullable(),
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

export const CreateTenantSchema = z.object({
  businessName: z.string().trim().min(2).max(255),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .regex(
      /^[a-z0-9-]+$/,
      "Slug must only contain lowercase letters, numbers, and hyphens",
    ),
  ownerName: z.string().trim().min(2).max(255),
  ownerEmail: z.string().trim().email().max(255),
  password: z.string().min(8).max(100),
  planId: z.enum(PLAN_IDS).default("trial"),
  trialDays: z.coerce.number().int().min(0).max(365).default(14),
  branchName: z.string().trim().min(2).max(255).default("Main Branch"),
  branchCode: z.string().trim().min(1).max(20).default("MAIN"),
});
export type CreateTenantDto = z.infer<typeof CreateTenantSchema>;

export const UpdateTenantSchema = z.object({
  name: z.string().trim().min(2).max(255).optional(),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .regex(
      /^[a-z0-9-]+$/,
      "Slug must only contain lowercase letters, numbers, and hyphens",
    )
    .optional(),
  planId: z.enum(PLAN_IDS).optional(),
  trialEndsAt: z.string().datetime().optional().nullable(),
  subscriptionEndsAt: z.string().datetime().optional().nullable(),
  settings: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateTenantDto = z.infer<typeof UpdateTenantSchema>;

export const ListAuditLogsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  entityType: z.string().trim().max(50).optional(),
  action: z.string().trim().max(30).optional(),
  tenantId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type ListAuditLogsDto = z.infer<typeof ListAuditLogsSchema>;
