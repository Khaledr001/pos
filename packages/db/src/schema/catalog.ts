import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import {
  activeFlag,
  money,
  primaryId,
  quantity,
  softDelete,
  timestamps,
  tsvector,
} from "./_shared.js";
import { tenantScope } from "./tenants.js";

/**
 * PRODUCT CATALOGUE
 *
 * Two levels, and the split is load-bearing:
 *
 *   products          the catalogue entry. What you browse, categorise and
 *                     photograph. NOT directly sellable.
 *   product_variants  the sellable unit. Carries the barcode, the stock, and
 *                     the price. `PVC Elbow` is a product; `1"` and `3/4"` are
 *                     variants of it.
 *
 * A product with no real variation still has exactly one variant, named
 * "Default". That uniformity is the point: every sale line, every ledger row
 * and every price references a variant, so nothing downstream needs to ask
 * whether this product happens to have variants.
 *
 * This matters for these verticals specifically — sanitary ware varies by size
 * and finish, paint by colour and can size. Modelling each size as a separate
 * product would fragment the catalogue and make "show me every finish of this
 * tap" impossible.
 */

/** Hierarchical. Depth is capped at 5 by the application. */
export const categories = pgTable(
  "categories",
  {
    id: primaryId(),
    ...tenantScope(),
    parentId: uuid().references((): AnyPgColumn => categories.id, { onDelete: "restrict" }),
    name: varchar({ length: 255 }).notNull(),
    slug: varchar({ length: 255 }).notNull(),
    /**
     * Prefix for auto-generated SKUs, e.g. "PLB" -> PLB-000123.
     * Changing it does not renumber existing products.
     */
    skuPrefix: varchar({ length: 16 }),
    /**
     * Materialised ancestor path, e.g. "plumbing/pvc/elbows".
     * Lets "everything under Plumbing" be a prefix scan instead of a recursive
     * CTE — which matters when the WhatsApp bot must answer inside a message
     * round-trip.
     */
    path: text().notNull().default(""),
    depth: integer().notNull().default(0),
    sortOrder: integer().notNull().default(0),
    imageUrl: varchar({ length: 500 }),
    ...activeFlag(),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    uniqueIndex("uq_categories_tenant_slug").on(t.tenantId, t.slug),
    index("idx_categories_parent").on(t.parentId),
    index("idx_categories_path").on(t.tenantId, t.path),
  ],
);

export const brands = pgTable(
  "brands",
  {
    id: primaryId(),
    ...tenantScope(),
    name: varchar({ length: 255 }).notNull(),
    slug: varchar({ length: 255 }).notNull(),
    logoUrl: varchar({ length: 500 }),
    ...activeFlag(),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [uniqueIndex("uq_brands_tenant_slug").on(t.tenantId, t.slug)],
);

/** Piece, Box, Roll, Metre, Kg. The base unit a variant is stocked in. */
export const units = pgTable(
  "units",
  {
    id: primaryId(),
    ...tenantScope(),
    name: varchar({ length: 50 }).notNull(),
    abbreviation: varchar({ length: 10 }).notNull(),
    /**
     * false = stock must be whole numbers (you cannot sell half an elbow).
     * true  = decimals allowed (cable by the metre, paint by the litre).
     */
    allowsFractions: boolean().notNull().default(false),
    ...timestamps(),
  },
  (t) => [uniqueIndex("uq_units_tenant_abbr").on(t.tenantId, t.abbreviation)],
);

/**
 * The catalogue entry. Not sellable on its own — see `product_variants`.
 */
export const products = pgTable(
  "products",
  {
    id: primaryId(),
    ...tenantScope(),
    /** Base SKU. Variants derive theirs from it. Unique per tenant. */
    sku: varchar({ length: 50 }).notNull(),
    name: varchar({ length: 500 }).notNull(),

    /**
     * Full-text vector for catalogue browsing. 'english' stems plurals
     * ("elbows" -> "elbow"), which suits most of this catalogue. Fuzzy and
     * non-English input is served by the trigram index on
     * `product_variants.searchKey`, which is what the POS actually queries.
     */
    nameSearch: tsvector()
      .generatedAlwaysAs(sql`to_tsvector('english', coalesce(name, ''))`)
      .notNull(),

    /** Product name in other locales: { ar: "...", ur: "..." }. */
    nameTranslations: jsonb().$type<Record<string, string>>().notNull().default({}),

    categoryId: uuid().references(() => categories.id, { onDelete: "set null" }),
    brandId: uuid().references(() => brands.id, { onDelete: "set null" }),
    unitId: uuid()
      .notNull()
      .references(() => units.id, { onDelete: "restrict" }),

    /**
     * Specs shared by every variant: material, thread, voltage, standard.
     * Anything that DIFFERS between variants belongs on the variant instead.
     */
    attributes: jsonb().$type<Record<string, string | number | boolean>>().notNull().default({}),

    description: text(),
    /** Denormalised from product_images where isPrimary — saves a join in lists. */
    imageUrl: varchar({ length: 500 }),

    /** Overrides the tenant's default VAT rate. NULL = inherit. */
    taxRate: money(),

    /** false = sold but not stock-tracked (labour, delivery charge). */
    isStockTracked: boolean().notNull().default(true),
    /** Capture a serial per unit at sale time. Electronics, power tools. */
    trackSerial: boolean().notNull().default(false),
    /** Capture an expiry date. Adhesives, sealants, paint hardeners. */
    trackExpiry: boolean().notNull().default(false),
    /** Warranty period printed on the receipt. */
    warrantyMonths: integer(),

    /**
     * false = a single sellable form. One "Default" variant still exists, so
     * nothing downstream has to special-case it.
     */
    hasVariants: boolean().notNull().default(false),

    ...activeFlag(),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    uniqueIndex("uq_products_tenant_sku").on(t.tenantId, t.sku),
    // Composite GIN (btree_gin extension) keeps full-text search tenant-scoped.
    index("idx_products_search").using("gin", t.tenantId, t.nameSearch),
    index("idx_products_category").on(t.tenantId, t.categoryId),
    index("idx_products_brand").on(t.tenantId, t.brandId),
    index("idx_products_updated").on(t.tenantId, t.updatedAt),
  ],
);

/**
 * THE SELLABLE UNIT.
 *
 * Every sale line, ledger row, price and stock balance points here — never at
 * `products`. Barcode lives here because that is what a scanner resolves: a
 * specific size of a specific fitting, not the family it belongs to.
 */
export const productVariants = pgTable(
  "product_variants",
  {
    id: primaryId(),
    ...tenantScope(),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),

    /** "Default" for a single-form product; otherwise `1 inch`, `Red / 500ml`. */
    variantName: varchar({ length: 255 }).notNull().default("Default"),

    /**
     * The real stock code — this is what goes on a shelf label and a purchase
     * order. Derived from the product SKU (`PVC-ELB-001-1IN`) but independently
     * editable, because merchants have existing codes they will not renumber.
     */
    sku: varchar({ length: 64 }).notNull(),

    /** One scan resolves to exactly one variant. Unique per tenant when present. */
    barcode: varchar({ length: 64 }),

    /**
     * Normalised search text: lowercase, accents stripped, measurements
     * canonicalised so `3/4"`, `3/4 inch` and `0.75in` collapse to one form.
     * Built from product name + variant name + SKU by searchKey() in
     * @devsfleet/shared-utils. This is the POS search path.
     */
    searchKey: text().notNull().default(""),

    /** What varies: { size: "1in", colour: "red", finish: "chrome" }. */
    attributes: jsonb().$type<Record<string, string | number | boolean>>().notNull().default({}),

    /** Low-stock threshold. Per variant, because a 1" elbow sells faster than a 4". */
    minStock: quantity().notNull().default("0"),
    reorderQuantity: quantity().notNull().default("0"),

    /** Weight in kg, for delivery quoting. */
    weight: quantity(),
    imageUrl: varchar({ length: 500 }),
    sortOrder: integer().notNull().default(0),

    ...activeFlag(),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    uniqueIndex("uq_variants_tenant_sku").on(t.tenantId, t.sku),
    /**
     * A blank barcode must not collide with another blank one, so the
     * uniqueness is partial.
     */
    uniqueIndex("uq_variants_tenant_barcode")
      .on(t.tenantId, t.barcode)
      .where(sql`barcode IS NOT NULL AND deleted_at IS NULL`),
    index("idx_variants_product").on(t.productId, t.sortOrder),
    index("idx_variants_trgm").using("gin", t.searchKey.op("gin_trgm_ops")),
    /** Sync pulls page through this. */
    index("idx_variants_updated").on(t.tenantId, t.updatedAt),
  ],
);

/**
 * Alternate scannable codes for one variant: the outer-box code, the
 * manufacturer's code, a superseded SKU.
 */
export const variantBarcodes = pgTable(
  "variant_barcodes",
  {
    id: primaryId(),
    ...tenantScope(),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    barcode: varchar({ length: 64 }).notNull(),
    /** Which packaging this code identifies. NULL = the base unit. */
    unitId: uuid().references(() => units.id, { onDelete: "set null" }),
    label: varchar({ length: 100 }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("uq_variant_barcodes_tenant_code").on(t.tenantId, t.barcode),
    index("idx_variant_barcodes_variant").on(t.variantId),
  ],
);

/**
 * Packaging conversions: 1 Box = 100 Pieces.
 *
 * Stock is always held in the variant's base unit. Selling a box deducts
 * `conversionFactor` base units, which is the only way a POS sale and a
 * warehouse count can agree.
 */
export const variantUnits = pgTable(
  "variant_units",
  {
    id: primaryId(),
    ...tenantScope(),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    unitId: uuid()
      .notNull()
      .references(() => units.id, { onDelete: "restrict" }),
    /** How many base units this packaging contains. Box of 100 -> 100. */
    conversionFactor: quantity().notNull(),
    barcode: varchar({ length: 64 }),
    /** Flat price for the pack. NULL = base price x conversionFactor. */
    priceOverride: money(),
    /** Offer this packaging in the POS unit picker. */
    isSellable: boolean().notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("uq_variant_units").on(t.variantId, t.unitId),
    index("idx_variant_units_variant").on(t.variantId),
  ],
);

/**
 * Product images.
 *
 * `checksum` is the SHA-256 of the uploaded bytes and is unique per tenant, so
 * the same photo cannot be stored twice under two products. On collision the
 * API links the existing object instead of uploading again — which also keeps
 * storage small across a catalogue where variants share photography.
 */
export const productImages = pgTable(
  "product_images",
  {
    id: primaryId(),
    ...tenantScope(),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** Set when the image shows one specific variant rather than the family. */
    variantId: uuid().references(() => productVariants.id, { onDelete: "cascade" }),
    url: varchar({ length: 500 }).notNull(),
    thumbnailUrl: varchar({ length: 500 }),
    /** SHA-256 hex of the original bytes. The dedup key. */
    checksum: varchar({ length: 64 }).notNull(),
    sizeBytes: integer(),
    width: integer(),
    height: integer(),
    mimeType: varchar({ length: 50 }),
    altText: varchar({ length: 255 }),
    sortOrder: integer().notNull().default(0),
    isPrimary: boolean().notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    /** One stored object per distinct image per tenant. */
    uniqueIndex("uq_product_images_tenant_checksum").on(t.tenantId, t.checksum),
    index("idx_product_images_product").on(t.productId, t.sortOrder),
    /** At most one primary image per product. */
    uniqueIndex("uq_product_images_primary")
      .on(t.productId)
      .where(sql`is_primary = true`),
  ],
);

/**
 * Serial numbers, for variants whose product sets `trackSerial`.
 *
 * Transitions: Available -> Sold -> Returned -> Available; any state ->
 * Damaged, which is terminal.
 */
export const serialNumbers = pgTable(
  "serial_numbers",
  {
    id: primaryId(),
    ...tenantScope(),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    serial: varchar({ length: 120 }).notNull(),
    /** available | sold | returned | damaged */
    status: varchar({ length: 20 }).notNull().default("available"),
    /** Current location while unsold. */
    branchId: uuid(),
    /** Set when sold. */
    saleItemId: uuid(),
    expiryDate: varchar({ length: 10 }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("uq_serials_tenant_serial").on(t.tenantId, t.serial),
    index("idx_serials_variant_status").on(t.variantId, t.status),
  ],
);

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: "category_parent",
  }),
  children: many(categories, { relationName: "category_parent" }),
  products: many(products),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
  brand: one(brands, { fields: [products.brandId], references: [brands.id] }),
  unit: one(units, { fields: [products.unitId], references: [units.id] }),
  variants: many(productVariants),
  images: many(productImages),
}));

export const productVariantsRelations = relations(productVariants, ({ one, many }) => ({
  product: one(products, { fields: [productVariants.productId], references: [products.id] }),
  barcodes: many(variantBarcodes),
  packagings: many(variantUnits),
}));

export const variantBarcodesRelations = relations(variantBarcodes, ({ one }) => ({
  variant: one(productVariants, {
    fields: [variantBarcodes.variantId],
    references: [productVariants.id],
  }),
}));

export const variantUnitsRelations = relations(variantUnits, ({ one }) => ({
  variant: one(productVariants, {
    fields: [variantUnits.variantId],
    references: [productVariants.id],
  }),
  unit: one(units, { fields: [variantUnits.unitId], references: [units.id] }),
}));

export const productImagesRelations = relations(productImages, ({ one }) => ({
  product: one(products, { fields: [productImages.productId], references: [products.id] }),
}));

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type Brand = typeof brands.$inferSelect;
export type NewBrand = typeof brands.$inferInsert;
export type Unit = typeof units.$inferSelect;
export type NewUnit = typeof units.$inferInsert;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type ProductVariant = typeof productVariants.$inferSelect;
export type NewProductVariant = typeof productVariants.$inferInsert;
export type VariantBarcode = typeof variantBarcodes.$inferSelect;
export type VariantUnit = typeof variantUnits.$inferSelect;
export type ProductImage = typeof productImages.$inferSelect;
export type NewProductImage = typeof productImages.$inferInsert;
export type SerialNumber = typeof serialNumbers.$inferSelect;
