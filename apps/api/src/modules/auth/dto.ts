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
