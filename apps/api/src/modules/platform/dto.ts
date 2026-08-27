import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, PLAN_IDS, PLANS } from "@devsfleet/shared-types";
import { z } from "zod";
import { UpdateTenantSettingsSchema } from "../tenants/dto.js";

export const ListTenantsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  q: z.string().trim().max(255).optional(),
  planId: z.enum(PLAN_IDS).optional(),
  status: z.enum(["active", "suspended"]).optional(),
});
export type ListTenantsDto = z.infer<typeof ListTenantsSchema>;

export const ChangePlanSchema = z
  .object({
    planId: z.enum(PLAN_IDS),
    /** Extends the paid period. Omit to leave it unchanged. */
    subscriptionEndsAt: z.string().datetime().optional().nullable(),
  })
  /**
   * A paid plan needs an end date.
   *
   * Moving a tenant to a paid plan clears `trialEndsAt` unconditionally. With
   * no `subscriptionEndsAt` supplied, that left a tenant on `pro` with no
   * trial expiry AND no subscription expiry — entitled permanently, for free,
   * from a single request that looked entirely routine. Free plans have
   * nothing to expire, so they are exempt.
   */
  .refine(
    (dto) => {
      const paid = (PLANS[dto.planId].monthlyPrice ?? 0) > 0;
      return !paid || Boolean(dto.subscriptionEndsAt);
    },
    {
      path: ["subscriptionEndsAt"],
      message: "A paid plan needs a subscription end date, or it never expires",
    },
  );
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

export const ImpersonateSchema = z.object({
  /**
   * Mandatory, for the same reason suspension's is: assuming another
   * company's administrator identity is the most invasive thing this system
   * permits, and "why" belongs in the audit row next to "who" and "when".
   */
  reason: z.string().trim().min(3).max(500),
});
export type ImpersonateDto = z.infer<typeof ImpersonateSchema>;

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
  /**
   * The same bar as every other account-creation path.
   *
   * This was `min(8)` with no complexity while `users/dto.ts` and public
   * self-registration both required ten characters plus three character
   * classes — so the one account an operator provisions by hand, which owns a
   * brand-new business outright, was the weakest credential the system would
   * accept. Self-signup refused passwords this route allowed.
   */
  password: z
    .string()
    .min(10, "Use at least 10 characters")
    .max(128)
    .regex(/[a-z]/, "Include a lowercase letter")
    .regex(/[A-Z]/, "Include an uppercase letter")
    .regex(/[0-9]/, "Include a digit"),
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
  /**
   * The same validated shape the tenant's own settings route uses.
   *
   * This was `z.record(z.string(), z.unknown())` — arbitrary JSON, shallow-
   * merged straight into live configuration. `{"currency": "AED"}` replaced
   * the currency OBJECT with a string, and `{"tax":{"defaultRate":9999}}` was
   * accepted outright. An operator could silently corrupt a business's VAT
   * setup through a route with no schema behind it.
   */
  settings: UpdateTenantSettingsSchema.optional(),
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
