import { PLAN_IDS } from "@devsfleet/shared-types";
import { z } from "zod";

/**
 * Slugs that must never become a tenant.
 *
 * Reserved now, before the first signup, because these become subdomains in
 * phase 2 (`{slug}.pos.devsfleet.com`). Letting someone register `api` or
 * `admin` today is a routing collision you cannot fix later without taking a
 * paying customer's URL away from them.
 */
export const RESERVED_SLUGS = new Set([
  "api", "app", "admin", "www", "mail", "smtp", "ftp", "cdn", "static",
  "assets", "docs", "help", "support", "status", "blog", "shop", "store",
  "pos", "billing", "account", "accounts", "login", "signup", "register",
  "dashboard", "console", "platform", "system", "internal", "test", "staging",
  "dev", "demo", "devsfleet",
]);

export const RegisterTenantSchema = z.object({
  businessName: z.string().trim().min(2).max(200),

  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(60)
    .regex(
      /^[a-z0-9]+(-[a-z0-9]+)*$/,
      "Use lowercase letters, numbers and single hyphens between them",
    )
    .refine((value) => !RESERVED_SLUGS.has(value), {
      message: "That name is reserved. Try another.",
    }),

  ownerName: z.string().trim().min(2).max(200),
  ownerEmail: z.string().trim().toLowerCase().email().max(255),

  /**
   * Complexity is enforced here rather than left to a length rule alone: this
   * password protects a business's entire sales and stock history, and it is
   * the one credential that cannot be rotated by an administrator above them.
   */
  password: z
    .string()
    .min(10, "Use at least 10 characters")
    .max(128)
    .regex(/[a-z]/, "Include a lowercase letter")
    .regex(/[A-Z]/, "Include an uppercase letter")
    .regex(/[0-9]/, "Include a digit")
    .regex(/[^A-Za-z0-9]/, "Include a symbol"),
});
export type RegisterTenantDto = z.infer<typeof RegisterTenantSchema>;

export const UpdateTenantSettingsSchema = z.object({
  legalName: z.string().trim().max(255).optional(),
  trn: z.string().trim().max(20).optional(),
  phone: z.string().trim().max(20).optional(),
  email: z.string().trim().email().max(255).optional(),
  addressLines: z.array(z.string().max(255)).max(6).optional(),
  logoUrl: z.string().url().max(500).optional(),

  tax: z
    .object({
      enabled: z.boolean().optional(),
      label: z.string().trim().min(1).max(40).optional(),
      defaultRate: z.number().min(0).max(100).optional(),
      mode: z.enum(["exclusive", "inclusive"]).optional(),
      showBreakdown: z.boolean().optional(),
    })
    .optional(),

  sales: z
    .object({
      enforceCreditLimit: z.boolean().optional(),
      enforceFloorPrice: z.boolean().optional(),
      allowNegativeStock: z.boolean().optional(),
      maxDiscountPercent: z.number().min(0).max(100).optional(),
      quotationValidityDays: z.number().int().min(1).max(365).optional(),
    })
    .optional(),

  printing: z
    .object({
      defaultReceiptFormat: z.enum(["thermal_58", "thermal_80", "a4"]).optional(),
      receiptFooter: z.string().max(500).optional(),
      duplicateOnCredit: z.boolean().optional(),
    })
    .optional(),
});
export type UpdateTenantSettingsDto = z.infer<typeof UpdateTenantSettingsSchema>;

/** Operator-only. Moving a tenant between plans takes effect immediately. */
export const ChangePlanSchema = z.object({
  planId: z.enum(PLAN_IDS),
  /** Extends the paid period. Omit to leave it unchanged. */
  subscriptionEndsAt: z.string().datetime().optional(),
});
export type ChangePlanDto = z.infer<typeof ChangePlanSchema>;

export const SuspendTenantSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
export type SuspendTenantDto = z.infer<typeof SuspendTenantSchema>;
