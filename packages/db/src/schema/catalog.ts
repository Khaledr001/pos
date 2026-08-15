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
import { activeFlag, money, primaryId, quantity, softDelete, timestamps, tsvector } from "./_shared.js";
import { tenantScope } from "./tenants.js";

/**
 * PRODUCT CATALOGUE
 *
 * Structural skeleton per the implementation plan. The exact attribute keys and
 * category tree get finalised against the real 5,000-SKU price list; until then
 * `attributes` (JSONB) absorbs whatever columns that file turns out to have,
 * without a migration per column.
 */

/** Hierarchical. Depth is unbounded but the UI assumes ~3 levels. */
export const categories = pgTable(
  "categories",
  {
    id: primaryId(),
    ...tenantScope(),
    parentId: uuid().references((): AnyPgColumn => categories.id, { onDelete: "restrict" }),
    name: varchar({ length: 255 }).notNull(),
    slug: varchar({ length: 255 }).notNull(),
    /**
     * Materialised ancestor path, e.g. "plumbing/pvc/elbows".
     * Maintained by the application on insert/move. Lets "everything under
     * Plumbing" be a prefix scan instead of a recursive CTE — which matters
     * when the WhatsApp bot has to answer inside a message round-trip.
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

/** Piece, Box, Roll, Metre, Kg. The *base* unit a product is stocked in. */
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

export const products = pgTable(
  "products",
  {
    id: primaryId(),
    ...tenantScope(),
    sku: varchar({ length: 50 }).notNull(),
    /** Primary scannable code. Alternates (box, pack) live in product_barcodes. */
    barcode: varchar({ length: 50 }),
    name: varchar({ length: 500 }).notNull(),

    /**
     * Full-text vector over the product name, for the AI's catalogue search.
     * 'english' stems plurals ("elbows" -> "elbow"), which is what most of this
     * catalogue is written in. Non-English and fuzzy/misspelled input is served
     * by the pg_trgm index on `searchKey` below, not by this column.
     */
    nameSearch: tsvector()
      .generatedAlwaysAs(sql`to_tsvector('english', coalesce(name, ''))`)
      .notNull(),

    /**
     * Normalised search string: lowercase, accents stripped, measurements
     * canonicalised so `3/4"`, `3/4 inch` and `0.75in` collapse to one form.
     * Written by the application via searchKey() in @devsfleet/shared-utils.
     */
    searchKey: text().notNull().default(""),

    /** Product name in other languages, keyed by locale: { ar: "...", ur: "..." }. */
    nameTranslations: jsonb().$type<Record<string, string>>().notNull().default({}),

    categoryId: uuid().references(() => categories.id, { onDelete: "set null" }),
    brandId: uuid().references(() => brands.id, { onDelete: "set null" }),
    unitId: uuid()
      .notNull()
      .references(() => units.id, { onDelete: "restrict" }),

    /**
     * Free-form specs: size, colour, material, thread, voltage, finish.
     * Deliberately schemaless — this catalogue spans electrical, sanitary and
     * paint, and no fixed column set covers all three. Promote a key to a real
     * column only once it needs to be filtered or sorted at scale.
     */
    attributes: jsonb().$type<Record<string, string | number | boolean>>().notNull().default({}),

    description: text(),
    /** Denormalised from product_images where isPrimary — saves a join in list views. */
    imageUrl: varchar({ length: 500 }),

    /** Snapshot for reorder maths; the authoritative per-branch value is on `inventory`. */
    defaultReorderLevel: quantity(),
    /** Weight in kg, for delivery quoting. */
    weight: quantity(),

    /** false = sold but not stock-tracked (labour, delivery charge). */
    isStockTracked: boolean().notNull().default(true),
    /** Overrides the tenant's default VAT rate for this product. NULL = inherit. */
    taxRate: money(),

    ...activeFlag(),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    uniqueIndex("uq_products_tenant_sku").on(t.tenantId, t.sku),
    // Composite GIN (btree_gin extension) so full-text search stays tenant-scoped.
    index("idx_products_search").using("gin", t.tenantId, t.nameSearch),
    index("idx_products_trgm").using("gin", t.searchKey.op("gin_trgm_ops")),
    index("idx_products_barcode")
      .on(t.tenantId, t.barcode)
      .where(sql`barcode IS NOT NULL`),
    index("idx_products_category").on(t.tenantId, t.categoryId),
    index("idx_products_brand").on(t.tenantId, t.brandId),
    // Sync pulls page through this.
    index("idx_products_updated").on(t.tenantId, t.updatedAt),
  ],
);

/** Alternate scannable codes: the box barcode, the manufacturer's code, an old SKU. */
export const productBarcodes = pgTable(
  "product_barcodes",
  {
    id: primaryId(),
    ...tenantScope(),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    barcode: varchar({ length: 50 }).notNull(),
    /** Which packaging this code identifies. NULL = the base unit. */
    unitId: uuid().references(() => units.id, { onDelete: "set null" }),
    label: varchar({ length: 100 }),
    ...timestamps(),
  },
  (t) => [
    // Globally unique per tenant: one scan must resolve to exactly one product.
    uniqueIndex("uq_product_barcodes_tenant_code").on(t.tenantId, t.barcode),
    index("idx_product_barcodes_product").on(t.productId),
  ],
);

/**
 * Packaging conversions: 1 Box = 100 Pieces.
 *
 * Stock is always held in the product's base unit. Selling a box deducts
 * `conversionFactor` base units, which is the only way a POS sale and a
 * warehouse count can ever agree.
 */
export const productUnits = pgTable(
  "product_units",
  {
    id: primaryId(),
    ...tenantScope(),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    unitId: uuid()
      .notNull()
      .references(() => units.id, { onDelete: "restrict" }),
    /** How many base units this packaging contains. Box of 100 -> 100. */
    conversionFactor: quantity().notNull(),
    barcode: varchar({ length: 50 }),
    /** Optional flat price for the pack. NULL = base price x conversionFactor. */
    priceOverride: money(),
    /** Offer this packaging in the POS unit picker. */
    isSellable: boolean().notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("uq_product_units").on(t.productId, t.unitId),
    index("idx_product_units_product").on(t.productId),
  ],
);

/**
 * Product images.
 *
 * `checksum` is the SHA-256 of the uploaded bytes and is unique per tenant, so
 * the same photo cannot be stored twice under two SKUs — the requirement was
 * explicitly "no duplicate image is published". On collision the API links the
 * existing object instead of uploading again, which also keeps MinIO small
 * across a 5,000-product catalogue where variants share photography.
 */
export const productImages = pgTable(
  "product_images",
  {
    id: primaryId(),
    ...tenantScope(),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
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
  barcodes: many(productBarcodes),
  packagings: many(productUnits),
  images: many(productImages),
}));

export const productBarcodesRelations = relations(productBarcodes, ({ one }) => ({
  product: one(products, { fields: [productBarcodes.productId], references: [products.id] }),
}));

export const productUnitsRelations = relations(productUnits, ({ one }) => ({
  product: one(products, { fields: [productUnits.productId], references: [products.id] }),
  unit: one(units, { fields: [productUnits.unitId], references: [units.id] }),
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
export type ProductBarcode = typeof productBarcodes.$inferSelect;
export type ProductUnit = typeof productUnits.$inferSelect;
export type ProductImage = typeof productImages.$inferSelect;
export type NewProductImage = typeof productImages.$inferInsert;
