import { z } from "zod";

export const SearchSerialsSchema = z.object({
  q: z.string().trim().min(1, "Enter a serial number").max(120),
});
export type SearchSerialsDto = z.infer<typeof SearchSerialsSchema>;

export const MarkDamagedSchema = z.object({
  reason: z.string().trim().min(3, "Explain what happened to it").max(500),
});
export type MarkDamagedDto = z.infer<typeof MarkDamagedSchema>;

export const ListSerialsSchema = z.object({
  variantId: z.string().uuid().optional(),
  status: z.enum(["available", "sold", "returned", "damaged"]).optional(),
  branchId: z.string().uuid().optional(),
});
export type ListSerialsDto = z.infer<typeof ListSerialsSchema>;
