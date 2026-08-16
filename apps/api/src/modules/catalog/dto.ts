import { z } from "zod";

export const CreateCategorySchema = z.object({
  name: z.string().trim().min(1).max(255),
  parentId: z.string().uuid().nullable().optional(),
  /**
   * Seeds auto-generated SKUs: "PLB" -> PLB-000123. Uppercase so the codes it
   * produces are consistent regardless of how it was typed.
   */
  skuPrefix: z
    .string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(16)
    .regex(/^[A-Z0-9]+$/, "Letters and digits only")
    .optional(),
  sortOrder: z.coerce.number().int().min(0).optional(),
});
export type CreateCategoryDto = z.infer<typeof CreateCategorySchema>;

export const UpdateCategorySchema = CreateCategorySchema.partial().extend({
  isActive: z.boolean().optional(),
});
export type UpdateCategoryDto = z.infer<typeof UpdateCategorySchema>;

export const CreateBrandSchema = z.object({
  name: z.string().trim().min(1).max(255),
  logoUrl: z.string().url().max(500).optional(),
});
export type CreateBrandDto = z.infer<typeof CreateBrandSchema>;

export const UpdateBrandSchema = CreateBrandSchema.partial().extend({
  isActive: z.boolean().optional(),
});
export type UpdateBrandDto = z.infer<typeof UpdateBrandSchema>;

export const CreateUnitSchema = z.object({
  name: z.string().trim().min(1).max(50),
  abbreviation: z.string().trim().min(1).max(10),
  /** true for cable by the metre or paint by the litre; false for countable goods. */
  allowsFractions: z.boolean().default(false),
});
export type CreateUnitDto = z.infer<typeof CreateUnitSchema>;

/** `allowsFractions` is absent on purpose — see LookupsService.updateUnit. */
export const UpdateUnitSchema = CreateUnitSchema.omit({ allowsFractions: true }).partial();
export type UpdateUnitDto = z.infer<typeof UpdateUnitSchema>;
