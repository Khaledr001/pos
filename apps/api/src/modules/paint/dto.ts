import { z } from "zod";

const FormulaComponentSchema = z.object({
  componentName: z.string().trim().min(1, "Name the tint, e.g. \"B1\"").max(80),
  quantityMl: z.coerce.number().positive(),
});

export const CreateFormulaSchema = z.object({
  colorCode: z.string().trim().min(1, "Give the colour a manufacturer code").max(40),
  colorName: z.string().trim().min(1, "Give the colour a name").max(120),
  baseVariantId: z.string().uuid(),
  sizeMl: z.coerce.number().int().positive(),
  notes: z.string().trim().max(2000).optional(),
  /** Dispensing order is the array order — no separate sortOrder input. */
  components: z.array(FormulaComponentSchema).default([]),
});
export type CreateFormulaDto = z.infer<typeof CreateFormulaSchema>;

export const UpdateFormulaSchema = CreateFormulaSchema.partial().extend({
  // Replacing the whole component list on edit — a formula is small and a
  // partial patch of dosages invites a machine mixing half an old recipe.
  components: z.array(FormulaComponentSchema).optional(),
});
export type UpdateFormulaDto = z.infer<typeof UpdateFormulaSchema>;

export const SearchFormulasSchema = z.object({
  /** Matches colour code OR name — customers usually know only one, approximately. */
  q: z.string().trim().max(100).optional(),
});
export type SearchFormulasDto = z.infer<typeof SearchFormulasSchema>;

export const CreatePaintOrderSchema = z
  .object({
    branchId: z.string().uuid().optional(),
    /** Omit for a fully custom mix that matches no saved formula. */
    formulaId: z.string().uuid().optional(),
    saleId: z.string().uuid().optional(),
    customNotes: z.string().trim().max(2000).optional(),
  })
  .refine(
    (dto) => dto.formulaId || dto.customNotes,
    "Name a saved formula or describe the custom mix — a paint order needs one or the other",
  );
export type CreatePaintOrderDto = z.infer<typeof CreatePaintOrderSchema>;

export const ListPaintOrdersSchema = z.object({
  branchId: z.string().uuid().optional(),
});
export type ListPaintOrdersDto = z.infer<typeof ListPaintOrdersSchema>;
