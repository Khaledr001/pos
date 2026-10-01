import { z } from "zod";

export const PRODUCT_SORTS = ["relevance", "newest", "price_asc", "price_desc", "name"] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

const csv = z
  .union([z.string(), z.array(z.string())])
  .transform((value) =>
    (Array.isArray(value) ? value : value.split(","))
      .map((v) => v.trim())
      .filter(Boolean),
  );

/**
 * `GET /storefront/catalog/products`.
 *
 * Attribute filters arrive as `attr[size]=1in,2in`, which Express's query
 * parser turns into `{ attr: { size: "1in,2in" } }`.
 */
export const ListProductsSchema = z.object({
  category: z.string().trim().max(255).optional(),
  brand: csv.optional(),
  q: z.string().trim().max(120).optional(),
  /** VAT-inclusive, in major units, as typed into a price filter. */
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  inStock: z
    .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
    .transform((v) => v === true || v === "true" || v === "1")
    .optional(),
  attr: z.record(z.string().max(100), z.string().max(500)).optional(),
  sort: z.enum(PRODUCT_SORTS).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(24),
});
export type ListProductsDto = z.infer<typeof ListProductsSchema>;

export const PricesQuerySchema = z.object({
  skus: csv.pipe(z.array(z.string().max(64)).max(100)).default([]),
});
export type PricesQueryDto = z.infer<typeof PricesQuerySchema>;

export const SuggestQuerySchema = z.object({
  q: z.string().trim().max(120).default(""),
});
export type SuggestQueryDto = z.infer<typeof SuggestQuerySchema>;
