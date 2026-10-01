import { z } from "zod";
import { AddressSchema, uaePhone, uaeTrn } from "../wire.js";

const email = z.string().trim().toLowerCase().pipe(z.email().max(255));

export const RegisterSchema = z.object({
  email,
  password: z.string().min(8, "Use at least 8 characters").max(200),
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  phone: uaePhone.optional(),
});
export type RegisterDto = z.infer<typeof RegisterSchema>;

export const LoginSchema = z.object({
  email,
  password: z.string().min(1).max(200),
});
export type LoginDto = z.infer<typeof LoginSchema>;

export const UpdateProfileSchema = z.object({
  firstName: z.string().trim().min(1).max(60).optional(),
  lastName: z.string().trim().min(1).max(60).optional(),
  phone: uaePhone.optional(),
  companyName: z.string().trim().max(200).optional(),
  trn: uaeTrn.optional(),
});
export type UpdateProfileDto = z.infer<typeof UpdateProfileSchema>;

export const SaveAddressSchema = AddressSchema.extend({ isDefault: z.boolean().optional() });
export type SaveAddressDto = z.infer<typeof SaveAddressSchema>;

export const UpdateAddressSchema = SaveAddressSchema.partial();
export type UpdateAddressDto = z.infer<typeof UpdateAddressSchema>;

export const TradeApplicationSchema = z.object({
  companyName: z.string().trim().min(2).max(200),
  trn: uaeTrn,
  message: z.string().trim().max(1000).optional(),
});
export type TradeApplicationDto = z.infer<typeof TradeApplicationSchema>;

export const ListNameSchema = z.object({ name: z.string().trim().min(1).max(80) });
export type ListNameDto = z.infer<typeof ListNameSchema>;

export const ListItemSchema = z.object({
  variantId: z.string().uuid(),
  /** The unit's abbreviation as the product page shows it. Omit for the base unit. */
  uom: z.string().trim().max(20).optional(),
  quantity: z.coerce.number().positive().max(100_000).optional(),
});
export type ListItemDto = z.infer<typeof ListItemSchema>;

export const PageQuerySchema = z.object({ page: z.coerce.number().int().min(1).max(1000).default(1) });
