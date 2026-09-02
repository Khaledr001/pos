import { DEFAULT_PAGE_SIZE, LOCALES, MAX_PAGE_SIZE } from "@devsfleet/shared-types";
import { z } from "zod";
import { zQueryBoolean } from "../../common/pipes/zod-validation.pipe.js";

/**
 * ABAC ceilings, editable per user.
 *
 * Expressed as a reusable block because create and update must accept exactly
 * the same shape — a limit that can be set at creation but not adjusted later
 * is a limit that gets worked around by deleting and recreating the person.
 */
const AbacSchema = z.object({
  /** 0-100. A cashier at 5 cannot discount 6%, regardless of their role. */
  maxDiscountPercent: z.coerce.number().min(0).max(100).optional(),
  /** null = no ceiling. Omit to leave unchanged. */
  maxSaleAmount: z.coerce.number().min(0).nullable().optional(),
  canApproveRefund: z.boolean().optional(),
  /** Gates cost and margin everywhere, server-side. */
  canViewCost: z.boolean().optional(),
  /** Empty array = every branch. */
  allowedBranchIds: z.array(z.string().uuid()).optional(),
});

export const CreateUserSchema = z
  .object({
    name: z.string().trim().min(2).max(255),
    email: z.string().trim().toLowerCase().email().max(255),
    phone: z.string().trim().max(20).optional(),
    roleId: z.string().uuid(),
    /** null = every branch in the tenant. Owners and area managers. */
    branchId: z.string().uuid().nullable().optional(),
    locale: z.enum(LOCALES).default("en"),

    password: z
      .string()
      .min(10, "Use at least 10 characters")
      .max(128)
      .regex(/[a-z]/, "Include a lowercase letter")
      .regex(/[A-Z]/, "Include an uppercase letter")
      .regex(/[0-9]/, "Include a digit"),

    /**
     * Counter PIN. Optional — a back-office user who never stands at a till
     * has no reason to hold one, and every unused PIN is a credential that can
     * be guessed.
     */
    pin: z
      .string()
      .regex(/^\d{4,6}$/, "PIN must be 4 to 6 digits")
      .optional(),
  })
  .merge(AbacSchema);
export type CreateUserDto = z.infer<typeof CreateUserSchema>;

/**
 * Password and PIN are deliberately absent: changing a credential is its own
 * operation with its own audit trail, not a field on a profile edit.
 */
export const UpdateUserSchema = z
  .object({
    name: z.string().trim().min(2).max(255).optional(),
    phone: z.string().trim().max(20).optional(),
    roleId: z.string().uuid().optional(),
    branchId: z.string().uuid().nullable().optional(),
    locale: z.enum(LOCALES).optional(),
    isActive: z.boolean().optional(),
  })
  .merge(AbacSchema);
export type UpdateUserDto = z.infer<typeof UpdateUserSchema>;

export const SetPasswordSchema = z.object({
  password: z
    .string()
    .min(10)
    .max(128)
    .regex(/[a-z]/, "Include a lowercase letter")
    .regex(/[A-Z]/, "Include an uppercase letter")
    .regex(/[0-9]/, "Include a digit"),
});
export type SetPasswordDto = z.infer<typeof SetPasswordSchema>;

export const SetPinSchema = z.object({
  /** null clears it, removing counter access without deactivating the person. */
  pin: z
    .string()
    .regex(/^\d{4,6}$/, "PIN must be 4 to 6 digits")
    .nullable(),
});
export type SetPinDto = z.infer<typeof SetPinSchema>;

export const ListUsersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  q: z.string().trim().max(255).optional(),
  roleId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  includeInactive: zQueryBoolean(false),
});
export type ListUsersDto = z.infer<typeof ListUsersSchema>;
