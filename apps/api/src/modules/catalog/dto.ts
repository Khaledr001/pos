import { ATTRIBUTE_TYPES } from "@devsfleet/shared-types";
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

/**
 * A typed attribute a category's variants can carry — "size" on Plumbing,
 * "sheen" on Paint. Scoped to one category on purpose: this catalogue's
 * categories do not share a vocabulary, so there is no single global list of
 * attributes that would mean the same thing everywhere.
 */
const AttributeDefinitionShape = z.object({
  categoryId: z.string().uuid(),
  /** Machine key, matched against product_variants.attributes' own keys — e.g. "size". */
  name: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(100)
    .regex(/^[a-z][a-z0-9_]*$/, "Lowercase letters, digits and underscores, starting with a letter"),
  label: z.string().trim().min(1).max(255),
  type: z.enum(ATTRIBUTE_TYPES),
  /** Display suffix for a `number` attribute — "mm", "L". */
  unit: z.string().trim().max(20).optional(),
  /** Required for, and only meaningful for, type "select". */
  allowedValues: z.array(z.string().trim().min(1).max(255)).optional(),
  sortOrder: z.coerce.number().int().min(0).default(0),
});

const selectNeedsAllowedValues = (v: { type?: string; allowedValues?: string[] }) =>
  v.type !== "select" || (v.allowedValues?.length ?? 0) > 0;
const SELECT_REFINEMENT = {
  message: "A select attribute needs at least one allowed value",
  path: ["allowedValues"],
};

export const CreateAttributeDefinitionSchema = AttributeDefinitionShape.refine(
  selectNeedsAllowedValues,
  SELECT_REFINEMENT,
);
export type CreateAttributeDefinitionDto = z.infer<typeof CreateAttributeDefinitionSchema>;

/**
 * `categoryId` is absent — moving a definition to a different category would
 * orphan every value already recorded against it under the old one's
 * assumptions. Retire it and create a fresh one instead.
 */
export const UpdateAttributeDefinitionSchema = AttributeDefinitionShape.omit({ categoryId: true })
  .partial()
  .refine(selectNeedsAllowedValues, SELECT_REFINEMENT);
export type UpdateAttributeDefinitionDto = z.infer<typeof UpdateAttributeDefinitionSchema>;
