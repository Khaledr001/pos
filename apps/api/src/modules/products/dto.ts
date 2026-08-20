import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@devsfleet/shared-types";
import { z } from "zod";

/**
 * A variant is the sellable unit, so its price lives here rather than on the
 * product. Prices are written to `product_prices` against the tenant's default
 * list — the pricing engine owns them, this is just the intake shape.
 */
const VariantInputSchema = z.object({
  /** Existing variant id when editing; absent when creating a new one. */
  id: z.string().uuid().optional(),
  variantName: z.string().trim().min(1).max(255).default("Default"),
  /** Auto-derived from the product SKU when omitted. */
  sku: z.string().trim().min(1).max(64).optional(),
  barcode: z.string().trim().max(64).nullable().optional(),
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),

  sellingPrice: z.coerce.number().positive("A selling price is required"),
  purchasePrice: z.coerce.number().min(0).default(0),
  wholesalePrice: z.coerce.number().min(0).optional(),
  /** Floor. Staff cannot sell below it without `price:override_floor`. */
  minSellingPrice: z.coerce.number().min(0).optional(),

  minStock: z.coerce.number().min(0).default(0),
  reorderQuantity: z.coerce.number().min(0).default(0),
  weight: z.coerce.number().min(0).optional(),

  /**
   * Opening stock, posted as an `opening_balance` ledger row through the stock
   * service like any other movement. Never written straight to the balance.
   */
  openingStock: z.coerce.number().min(0).optional(),
  openingStockBranchId: z.string().uuid().optional(),

  isActive: z.boolean().default(true),
});

export const CreateProductSchema = z.object({
  name: z.string().trim().min(1).max(500),
  /** Auto-generated from the category prefix when omitted. */
  sku: z.string().trim().min(1).max(50).optional(),
  description: z.string().max(5000).optional(),
  categoryId: z.string().uuid().nullable().optional(),
  brandId: z.string().uuid().nullable().optional(),
  unitId: z.string().uuid(),

  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  nameTranslations: z.record(z.string(), z.string()).default({}),

  /** Overrides the tenant VAT rate. Omit to inherit. */
  taxRate: z.coerce.number().min(0).max(100).optional(),
  isStockTracked: z.boolean().default(true),
  trackSerial: z.boolean().default(false),
  trackExpiry: z.boolean().default(false),
  warrantyMonths: z.coerce.number().int().min(0).optional(),

  /**
   * At least one. A product with no variant is unsellable, and the rest of the
   * system assumes every product has one — enforcing it here keeps that true.
   */
  variants: z.array(VariantInputSchema).min(1, "A product needs at least one variant"),
});
export type CreateProductDto = z.infer<typeof CreateProductSchema>;

export const UpdateProductSchema = CreateProductSchema.omit({
  variants: true,
  unitId: true,
})
  .partial()
  .extend({
    isActive: z.boolean().optional(),
    /** Omit to leave variants untouched; supply to upsert the listed ones. */
    variants: z.array(VariantInputSchema).optional(),
  });
export type UpdateProductDto = z.infer<typeof UpdateProductSchema>;

export const ListProductsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  q: z.string().trim().max(255).optional(),
  categoryId: z.string().uuid().optional(),
  brandId: z.string().uuid().optional(),
  includeInactive: z.coerce.boolean().default(false),
  /** Include per-branch stock. Costs a join, so it is opt-in. */
  branchId: z.string().uuid().optional(),
  /**
   * Typed attribute filter (Stage 5.3) — `?attributes[size]=1in` finds every
   * product with a variant carrying that value, via the indexed
   * `variant_attribute_values` table rather than a scan of the JSONB bag.
   * Matched by the attribute's machine name, not its display label.
   */
  attributes: z.record(z.string(), z.string()).optional(),
  sortBy: z.enum(["name", "sku", "createdAt"]).default("name"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});
export type ListProductsDto = z.infer<typeof ListProductsSchema>;

/**
 * The POS search. Returns VARIANTS, not products — a cashier sells a size, not
 * a family, and the terminal needs the sellable row directly.
 */
export const SearchVariantsSchema = z.object({
  q: z.string().trim().max(255).default(""),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  branchId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
});
export type SearchVariantsDto = z.infer<typeof SearchVariantsSchema>;

/**
 * A packaging a variant can be sold in — a box, a carton (Stage 3.4). Pure
 * live configuration, not a document: the SALE snapshots its own
 * conversionFactor at the moment of sale (sale_items.unitConversionFactor),
 * so editing or removing a packaging here never rewrites history.
 */
export const CreateVariantUnitSchema = z.object({
  unitId: z.string().uuid(),
  /** Base units per pack. Box of 20 -> 20. */
  conversionFactor: z.coerce.number().positive(),
  barcode: z.string().trim().max(64).optional(),
  /** Flat price for the pack. Omit to use base price x conversionFactor. */
  priceOverride: z.coerce.number().positive().optional(),
  isSellable: z.boolean().default(true),
});
export type CreateVariantUnitDto = z.infer<typeof CreateVariantUnitSchema>;

export const UpdateVariantUnitSchema = CreateVariantUnitSchema.omit({ unitId: true })
  .partial()
  .extend({
    /** Explicit null clears an existing flat price back to the computed default. */
    priceOverride: z.coerce.number().positive().nullable().optional(),
  });
export type UpdateVariantUnitDto = z.infer<typeof UpdateVariantUnitSchema>;
