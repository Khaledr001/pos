import { PERMISSIONS } from "@devsfleet/shared-types";
import { z } from "zod";

/**
 * Request schemas for the auth module.
 *
 * The Zod object is the single definition: it validates at the boundary and
 * `z.infer` produces the TypeScript type, so a DTO can never drift from the
 * validation that guards it. Follow this shape in every module — see
 * docs/PATTERNS.md.
 */

export const LoginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(128),
  /** Optional: disambiguates a person who works for more than one tenant. */
  tenantSlug: z.string().min(1).max(100).optional(),
});
export type LoginDto = z.infer<typeof LoginSchema>;

export const PinLoginSchema = z.object({
  pin: z
    .string()
    .regex(/^\d{4,6}$/, "PIN must be 4 to 6 digits"),
  /** Must match a registered, active device row. */
  deviceId: z.string().uuid(),
  branchId: z.string().uuid(),
});
export type PinLoginDto = z.infer<typeof PinLoginSchema>;

export const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshDto = z.infer<typeof RefreshSchema>;

/**
 * A supervisor authorising one action at a till they are not signed in to.
 *
 * Deliberately carries no device or branch: the terminal is already
 * authenticated and those come from its token. A body that named them would
 * let a caller choose which branch's staff PINs it gets to test.
 */
export const ManagerOverrideSchema = z.object({
  pin: z.string().regex(/^\d{4,6}$/, "PIN must be 4 to 6 digits"),
  /**
   * The permission the cashier lacked, e.g. "price:override_floor".
   *
   * Constrained to the real list rather than left a free string: an approver
   * with `*` satisfies anything, so a typo'd or invented permission would
   * otherwise be "approved" by the owner and read as authorisation for
   * something no role can actually grant.
   */
  permission: z.enum(PERMISSIONS),
  /** Printed on the audit row. Optional, because a queue is forming. */
  reason: z.string().max(500).optional(),
});
export type ManagerOverrideDto = z.infer<typeof ManagerOverrideSchema>;
