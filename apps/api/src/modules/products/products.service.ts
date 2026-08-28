import { and, asc, count, desc, eq, ilike, isNull, or, schema, sql } from "@devsfleet/db";
import type { AttributeDefinition } from "@devsfleet/db";
import type { Paginated } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES, searchKey, normalizeBarcode } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { RequestContext } from "../../common/context/request-context.js";
import { PlanLimitService } from "../../common/guards/plan-limit.service.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import { StockService } from "../inventory/stock.service.js";
import { PriceResolverService } from "../pricing/price-resolver.service.js";
import { StorageService } from "../storage/storage.service.js";
import type {
  CreateProductDto,
  CreateProductSupplierLinkDto,
  CreateVariantUnitDto,
  ListProductsDto,
  SearchVariantsDto,
  UpdateProductDto,
  UpdateProductImageDto,
  UpdateProductSupplierLinkDto,
  UpdateVariantUnitDto,
  UploadProductImageDto,
} from "./dto.js";

const ALLOWED_IMAGE_MIME_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * The catalogue.
 *
 * A product is what you browse; a VARIANT is what you sell. Every write here
 * maintains that invariant — creating a product always creates at least one
 * variant, so nothing downstream has to handle a product that cannot be sold.
 *
 * Cost prices are filtered SERVER-SIDE by `canViewCost`. Hiding them in the UI
 * only would still ship them to a cashier's browser, where anyone can read the
 * network tab.
 */
@Injectable()
export class ProductsService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly planLimits: PlanLimitService,
    private readonly stock: StockService,
    private readonly prices: PriceResolverService,
    private readonly storage: StorageService,
  ) {}

  async list(query: ListProductsDto): Promise<Paginated<unknown>> {
    const { page, limit, q, categoryId, brandId, includeInactive, sortBy, sortOrder, attributes } = query;
    const offset = (page - 1) * limit;

    const where = and(
      isNull(schema.products.deletedAt),
      includeInactive ? undefined : eq(schema.products.isActive, true),
      categoryId ? eq(schema.products.categoryId, categoryId) : undefined,
      brandId ? eq(schema.products.brandId, brandId) : undefined,
      q
        ? or(
            ilike(schema.products.name, `%${q}%`),
            ilike(schema.products.sku, `%${q}%`),
            // Match a scanned code against any variant of the product.
            sql`EXISTS (
              SELECT 1 FROM product_variants v
              WHERE v.product_id = products.id
                AND (v.sku ILIKE ${`%${q}%`} OR v.barcode = ${q})
            )`,
          )
        : undefined,
      // "All 1-inch elbows" (Stage 5.3) — matches a product with ONE variant
      // carrying every requested attribute value (not different values
      // scattered across different variants), each condition hitting
      // idx_variant_attribute_values_lookup rather than scanning the JSONB bag.
      Object.entries(attributes ?? {}).length > 0
        ? sql`EXISTS (
            SELECT 1 FROM product_variants v
            WHERE v.product_id = products.id AND v.deleted_at IS NULL
              AND ${sql.join(
                Object.entries(attributes ?? {}).map(
                  ([name, value]) => sql`EXISTS (
                    SELECT 1 FROM variant_attribute_values vav
                    JOIN attribute_definitions ad ON ad.id = vav.attribute_definition_id
                    WHERE vav.variant_id = v.id AND ad.name = ${name} AND vav.value = ${value}
                  )`,
                ),
                sql` AND `,
              )}
          )`
        : undefined,
    );

    const column = {
      name: schema.products.name,
      sku: schema.products.sku,
      createdAt: schema.products.createdAt,
    }[sortBy];

    return this.db.run(async (tx) => {
      const [items, [totals]] = await Promise.all([
        tx
          .select({
            id: schema.products.id,
            sku: schema.products.sku,
            name: schema.products.name,
            categoryId: schema.products.categoryId,
            categoryName: schema.categories.name,
            brandName: schema.brands.name,
            unitAbbr: schema.units.abbreviation,
            imageUrl: schema.products.imageUrl,
            hasVariants: schema.products.hasVariants,
            isActive: schema.products.isActive,
            // Counted rather than joined: joining variants would multiply the
            // product rows and break the page size.
            variantCount: sql<number>`(
              SELECT count(*)::int FROM product_variants v
              WHERE v.product_id = products.id AND v.deleted_at IS NULL
            )`,
            minPrice: sql<string | null>`(
              SELECT min(pp.selling_price)::text
              FROM product_variants v
              JOIN product_prices pp ON pp.variant_id = v.id
              WHERE v.product_id = products.id AND v.deleted_at IS NULL
            )`,
            maxPrice: sql<string | null>`(
              SELECT max(pp.selling_price)::text
              FROM product_variants v
              JOIN product_prices pp ON pp.variant_id = v.id
              WHERE v.product_id = products.id AND v.deleted_at IS NULL
            )`,
          })
          .from(schema.products)
          .leftJoin(schema.categories, eq(schema.products.categoryId, schema.categories.id))
          .leftJoin(schema.brands, eq(schema.products.brandId, schema.brands.id))
          .innerJoin(schema.units, eq(schema.products.unitId, schema.units.id))
          .where(where)
          .orderBy(sortOrder === "asc" ? asc(column) : desc(column))
          .limit(limit)
          .offset(offset),
        tx.select({ value: count() }).from(schema.products).where(where),
      ]);

      const total = totals?.value ?? 0;
      const totalPages = Math.max(1, Math.ceil(total / limit));

      return {
        items,
        meta: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      };
    });
  }

  async findById(id: string, branchId?: string): Promise<unknown> {
    const canViewCost = RequestContext.get()?.user?.abac.canViewCost ?? false;

    return this.db.run(async (tx) => {
      const product = await tx.query.products.findFirst({
        where: (t, { and: a, eq: e, isNull: n }) => a(e(t.id, id), n(t.deletedAt)),
      });
      if (!product) throw new AppError(ERROR_CODES.PRODUCT_NOT_FOUND, `Product ${id} not found`);

      const variants = await tx
        .select({
          id: schema.productVariants.id,
          variantName: schema.productVariants.variantName,
          sku: schema.productVariants.sku,
          barcode: schema.productVariants.barcode,
          attributes: schema.productVariants.attributes,
          minStock: schema.productVariants.minStock,
          isActive: schema.productVariants.isActive,
          /**
           * `product_variants.id` is written out in full rather than
           * interpolated.
           *
           * Drizzle omits the table qualifier when a query has no joins, so
           * `${schema.productVariants.id}` renders as a bare "id" — which, inside
           * this correlated subquery, binds to `inventory`.`id` instead of the
           * outer variant. The comparison silently becomes `i.variant_id = i.id`,
           * matches nothing, and every product reports zero stock with no error.
           */
          stock: branchId
            ? sql<string>`coalesce((
                SELECT i.quantity FROM inventory i
                WHERE i.variant_id = product_variants.id
                  AND i.branch_id = ${branchId}
              ), '0')`
            : sql<string>`coalesce((
                SELECT sum(i.quantity)::text FROM inventory i
                WHERE i.variant_id = product_variants.id
              ), '0')`,
        })
        .from(schema.productVariants)
        .where(
          and(
            eq(schema.productVariants.productId, id),
            isNull(schema.productVariants.deletedAt),
          ),
        )
        .orderBy(asc(schema.productVariants.sortOrder));

      const priced = await this.prices.resolveMany(tx, {
        variantIds: variants.map((v) => v.id),
        includeCost: canViewCost,
      });
      const priceBy = new Map(priced.map((p) => [p.variantId, p]));

      const images = await tx
        .select()
        .from(schema.productImages)
        .where(eq(schema.productImages.productId, id))
        .orderBy(asc(schema.productImages.sortOrder));

      return {
        ...product,
        variants: variants.map((v) => {
          const price = priceBy.get(v.id);
          return {
            ...v,
            sellingPrice: price?.unitPrice ?? null,
            minSellingPrice: price?.minSellingPrice ?? null,
            // Absent, not zeroed, without the permission.
            ...(canViewCost ? { purchasePrice: price?.purchasePrice ?? null } : {}),
          };
        }),
        images,
      };
    });
  }

  /**
   * Create a product and its variants in one transaction.
   *
   * Opening stock goes through the stock service so it lands in the ledger like
   * every other movement — writing the balance directly would produce stock
   * whose origin the stock card cannot explain.
   */
  async create(dto: CreateProductDto): Promise<unknown> {
    this.planLimits.assertTrialActive();
    await this.planLimits.assertCanCreate("products");

    const tenantId = RequestContext.requireTenantId();

    const productId = await this.db.run(async (tx) => {
      const sku = dto.sku ?? (await this.nextSku(tx, dto.categoryId ?? null));

      const [product] = await tx
        .insert(schema.products)
        .values({
          tenantId,
          sku,
          name: dto.name,
          description: dto.description,
          categoryId: dto.categoryId ?? null,
          brandId: dto.brandId ?? null,
          unitId: dto.unitId,
          attributes: dto.attributes,
          nameTranslations: dto.nameTranslations,
          ...(dto.taxRate !== undefined ? { taxRate: String(dto.taxRate) } : {}),
          isStockTracked: dto.isStockTracked,
          trackSerial: dto.trackSerial,
          trackExpiry: dto.trackExpiry,
          ...(dto.warrantyMonths !== undefined ? { warrantyMonths: dto.warrantyMonths } : {}),
          hasVariants: dto.variants.length > 1,
        })
        .returning({ id: schema.products.id });

      if (!product) throw new AppError(ERROR_CODES.INTERNAL_ERROR, "Could not create the product");

      const defaultList = await tx.query.priceLists.findFirst({
        where: (t, { and: a, eq: e }) => a(e(t.isDefault, true), e(t.isActive, true)),
        columns: { id: true },
      });
      if (!defaultList) {
        throw new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          "No default price list exists. Create one before adding products.",
        );
      }

      /**
       * Typed attributes this category has defined (Stage 5.3) — keyed by
       * their machine name so each variant's free-form `attributes` object
       * can be cross-referenced against them below. A category with none
       * defined (the common case, until an admin bothers to set one up)
       * means every variant's attributes stay JSONB-only, exactly as before.
       */
      const attributeDefsByName: Map<string, AttributeDefinition> = dto.categoryId
        ? new Map(
            (
              await tx.query.attributeDefinitions.findMany({
                where: (t, { eq: e }) => e(t.categoryId, dto.categoryId!),
              })
            ).map((d) => [d.name, d]),
          )
        : new Map();

      for (const [index, v] of dto.variants.entries()) {
        const variantSku = v.sku ?? (dto.variants.length === 1 ? sku : `${sku}-${index + 1}`);

        const [variant] = await tx
          .insert(schema.productVariants)
          .values({
            tenantId,
            productId: product.id,
            variantName: v.variantName,
            sku: variantSku,
            barcode: v.barcode ? normalizeBarcode(v.barcode) : null,
            searchKey: searchKey(dto.name, v.variantName, variantSku),
            attributes: v.attributes,
            minStock: String(v.minStock),
            reorderQuantity: String(v.reorderQuantity),
            ...(v.weight !== undefined ? { weight: String(v.weight) } : {}),
            sortOrder: index,
            isActive: v.isActive,
          })
          .returning({ id: schema.productVariants.id });

        if (!variant) continue;

        await tx.insert(schema.productPrices).values({
          tenantId,
          variantId: variant.id,
          priceListId: defaultList.id,
          sellingPrice: String(v.sellingPrice),
          purchasePrice: String(v.purchasePrice),
          ...(v.minSellingPrice !== undefined
            ? { minSellingPrice: String(v.minSellingPrice) }
            : {}),
        });

        if (attributeDefsByName.size > 0) {
          await this.writeAttributeValues(tx, tenantId, variant.id, v.attributes, attributeDefsByName);
        }

        if (v.openingStock && v.openingStock > 0) {
          const branchId =
            v.openingStockBranchId ?? RequestContext.get()?.branchId ?? null;
          if (!branchId) {
            throw new AppError(
              ERROR_CODES.VALIDATION_FAILED,
              "Opening stock needs a branch. Supply openingStockBranchId.",
            );
          }

          await this.stock.addStock({
            tx,
            variantId: variant.id,
            branchId,
            quantity: String(v.openingStock),
            referenceType: "opening_stock",
            referenceId: product.id,
            notes: "Opening stock at product creation",
            unitCost: String(v.purchasePrice),
          });
        }
      }

      return product.id;
    });

    return this.findById(productId);
  }

  async update(id: string, dto: UpdateProductDto): Promise<unknown> {
    await this.db.run(async (tx) => {
      const existing = await tx.query.products.findFirst({
        where: (t, { and: a, eq: e, isNull: n }) => a(e(t.id, id), n(t.deletedAt)),
      });
      if (!existing) throw new AppError(ERROR_CODES.PRODUCT_NOT_FOUND, `Product ${id} not found`);

      const [updated] = await tx
        .update(schema.products)
        .set({
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
          ...(dto.brandId !== undefined ? { brandId: dto.brandId } : {}),
          ...(dto.attributes !== undefined ? { attributes: dto.attributes } : {}),
          ...(dto.taxRate !== undefined ? { taxRate: String(dto.taxRate) } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        })
        .where(eq(schema.products.id, id))
        .returning({ id: schema.products.id, name: schema.products.name });

      if (!updated) throw new AppError(ERROR_CODES.PRODUCT_NOT_FOUND, `Product ${id} not found`);

      // Renaming the product changes what the POS matches on, so every
      // variant's search key has to be rebuilt.
      if (dto.name !== undefined) {
        await tx.execute(sql`
          UPDATE product_variants
          SET search_key = lower(${updated.name} || ' ' || variant_name || ' ' || sku)
          WHERE product_id = ${id}
        `);
      }
    });

    return this.findById(id);
  }

  /**
   * Soft delete.
   *
   * A product referenced by a sale is never removed — the invoice must still
   * render the name it was sold under years later.
   */
  async remove(id: string): Promise<void> {
    await this.db.run(async (tx) => {
      const [sold] = await tx
        .select({ value: count() })
        .from(schema.saleItems)
        .innerJoin(
          schema.productVariants,
          eq(schema.saleItems.variantId, schema.productVariants.id),
        )
        .where(eq(schema.productVariants.productId, id));

      if ((sold?.value ?? 0) > 0) {
        // Deactivating is the right move: it disappears from the POS while the
        // history keeps working.
        await tx
          .update(schema.products)
          .set({ isActive: false })
          .where(eq(schema.products.id, id));
        return;
      }

      const now = new Date();
      await tx
        .update(schema.productVariants)
        .set({ deletedAt: now, isActive: false })
        .where(eq(schema.productVariants.productId, id));
      await tx
        .update(schema.products)
        .set({ deletedAt: now, isActive: false })
        .where(eq(schema.products.id, id));
    });
  }

  /**
   * Packagings offered for one variant — a box, a carton.
   *
   * Pure configuration, not a document: a sale snapshots its own
   * `unitConversionFactor` at the moment it happens
   * (`sale_items.unitConversionFactor`), so editing or removing one of these
   * rows later never rewrites a past invoice. That is also why this table
   * carries no `deletedAt` and these are real deletes, not soft ones.
   */
  async listVariantUnits(variantId: string): Promise<unknown[]> {
    return this.db.run(async (tx) =>
      tx
        .select({
          id: schema.variantUnits.id,
          unitId: schema.variantUnits.unitId,
          unitName: schema.units.name,
          unitAbbr: schema.units.abbreviation,
          conversionFactor: schema.variantUnits.conversionFactor,
          barcode: schema.variantUnits.barcode,
          priceOverride: schema.variantUnits.priceOverride,
          isSellable: schema.variantUnits.isSellable,
          isPurchasable: schema.variantUnits.isPurchasable,
        })
        .from(schema.variantUnits)
        .innerJoin(schema.units, eq(schema.variantUnits.unitId, schema.units.id))
        .where(eq(schema.variantUnits.variantId, variantId))
        .orderBy(schema.variantUnits.conversionFactor),
    );
  }

  async createVariantUnit(
    variantId: string,
    dto: CreateVariantUnitDto,
  ): Promise<unknown> {
    const tenantId = RequestContext.requireTenantId();

    return this.db.run(async (tx) => {
      const variant = await tx.query.productVariants.findFirst({
        where: (t, { eq: e }) => e(t.id, variantId),
        columns: { id: true },
      });
      if (!variant) {
        throw new AppError(ERROR_CODES.PRODUCT_NOT_FOUND, `Variant ${variantId} not found`);
      }

      const existing = await tx.query.variantUnits.findFirst({
        where: (t, { and: a, eq: e }) => a(e(t.variantId, variantId), e(t.unitId, dto.unitId)),
        columns: { id: true },
      });
      if (existing) {
        throw new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          "This variant already has a packaging for that unit.",
        );
      }

      const [row] = await tx
        .insert(schema.variantUnits)
        .values({
          tenantId,
          variantId,
          unitId: dto.unitId,
          conversionFactor: String(dto.conversionFactor),
          ...(dto.barcode ? { barcode: dto.barcode } : {}),
          ...(dto.priceOverride !== undefined
            ? { priceOverride: String(dto.priceOverride) }
            : {}),
          isSellable: dto.isSellable,
          isPurchasable: dto.isPurchasable,
        })
        .returning();

      return row;
    });
  }

  async updateVariantUnit(id: string, dto: UpdateVariantUnitDto): Promise<unknown> {
    return this.db.run(async (tx) => {
      const existing = await tx.query.variantUnits.findFirst({
        where: (t, { eq: e }) => e(t.id, id),
        columns: { id: true },
      });
      if (!existing) {
        throw new AppError(ERROR_CODES.NOT_FOUND, `Packaging ${id} not found`);
      }

      const [row] = await tx
        .update(schema.variantUnits)
        .set({
          ...(dto.conversionFactor !== undefined
            ? { conversionFactor: String(dto.conversionFactor) }
            : {}),
          ...(dto.barcode !== undefined ? { barcode: dto.barcode } : {}),
          ...(dto.priceOverride !== undefined
            ? { priceOverride: dto.priceOverride === null ? null : String(dto.priceOverride) }
            : {}),
          ...(dto.isSellable !== undefined ? { isSellable: dto.isSellable } : {}),
          ...(dto.isPurchasable !== undefined ? { isPurchasable: dto.isPurchasable } : {}),
        })
        .where(eq(schema.variantUnits.id, id))
        .returning();

      return row;
    });
  }

  async deleteVariantUnit(id: string): Promise<void> {
    await this.db.run(async (tx) => {
      await tx.delete(schema.variantUnits).where(eq(schema.variantUnits.id, id));
    });
  }

  /**
   * Suppliers linked to one variant (Stage 5.4) — their own SKU/barcode, so
   * receiving can match a delivery note that never mentions this
   * catalogue's own codes. Pure configuration, like a packaging: a real
   * delete, no soft-delete column, nothing downstream snapshots from it.
   */
  async listSupplierLinks(variantId: string): Promise<unknown[]> {
    return this.db.run((tx) =>
      tx
        .select({
          id: schema.productSupplierLinks.id,
          supplierId: schema.productSupplierLinks.supplierId,
          supplierName: schema.suppliers.name,
          supplierSku: schema.productSupplierLinks.supplierSku,
          supplierBarcode: schema.productSupplierLinks.supplierBarcode,
          leadTimeDays: schema.productSupplierLinks.leadTimeDays,
          lastCost: schema.productSupplierLinks.lastCost,
          notes: schema.productSupplierLinks.notes,
        })
        .from(schema.productSupplierLinks)
        .innerJoin(schema.suppliers, eq(schema.productSupplierLinks.supplierId, schema.suppliers.id))
        .where(eq(schema.productSupplierLinks.variantId, variantId))
        .orderBy(asc(schema.suppliers.name)),
    );
  }

  async createSupplierLink(
    variantId: string,
    dto: CreateProductSupplierLinkDto,
  ): Promise<unknown> {
    const tenantId = RequestContext.requireTenantId();

    return this.db.run(async (tx) => {
      const variant = await tx.query.productVariants.findFirst({
        where: (t, { eq: e }) => e(t.id, variantId),
        columns: { id: true },
      });
      if (!variant) {
        throw new AppError(ERROR_CODES.PRODUCT_NOT_FOUND, `Variant ${variantId} not found`);
      }

      const [row] = await tx
        .insert(schema.productSupplierLinks)
        .values({
          tenantId,
          variantId,
          supplierId: dto.supplierId,
          ...(dto.supplierSku ? { supplierSku: dto.supplierSku } : {}),
          ...(dto.supplierBarcode ? { supplierBarcode: dto.supplierBarcode } : {}),
          ...(dto.leadTimeDays !== undefined ? { leadTimeDays: dto.leadTimeDays } : {}),
          ...(dto.lastCost !== undefined ? { lastCost: String(dto.lastCost) } : {}),
          ...(dto.notes ? { notes: dto.notes } : {}),
        })
        .returning();

      return row;
    });
    // A duplicate (supplierId, variantId) raises 23505 on
    // uq_product_supplier_links_supplier_variant -> 409. No pre-flight
    // SELECT — that is a race, the unique index is not.
  }

  async updateSupplierLink(id: string, dto: UpdateProductSupplierLinkDto): Promise<unknown> {
    return this.db.run(async (tx) => {
      const [row] = await tx
        .update(schema.productSupplierLinks)
        .set({
          ...(dto.supplierSku !== undefined ? { supplierSku: dto.supplierSku } : {}),
          ...(dto.supplierBarcode !== undefined ? { supplierBarcode: dto.supplierBarcode } : {}),
          ...(dto.leadTimeDays !== undefined ? { leadTimeDays: dto.leadTimeDays } : {}),
          ...(dto.lastCost !== undefined ? { lastCost: String(dto.lastCost) } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        })
        .where(eq(schema.productSupplierLinks.id, id))
        .returning();

      if (!row) throw new AppError(ERROR_CODES.NOT_FOUND, `Supplier link ${id} not found`);
      return row;
    });
  }

  async deleteSupplierLink(id: string): Promise<void> {
    await this.db.run(async (tx) => {
      await tx.delete(schema.productSupplierLinks).where(eq(schema.productSupplierLinks.id, id));
    });
  }

  /**
   * Product images (Stage 5.6). Deduplicated by SHA-256 of the bytes — the
   * same photo cannot be stored twice under this tenant; a collision is
   * refused with the product it already belongs to, rather than silently
   * reusing or re-uploading it, since which product actually owns a shared
   * photo is a judgement call this service should not make for someone.
   */
  async listImages(productId: string): Promise<unknown[]> {
    return this.db.run((tx) =>
      tx
        .select()
        .from(schema.productImages)
        .where(eq(schema.productImages.productId, productId))
        .orderBy(asc(schema.productImages.sortOrder)),
    );
  }

  async addImage(
    productId: string,
    file: Express.Multer.File,
    dto: UploadProductImageDto,
  ): Promise<unknown> {
    const tenantId = RequestContext.requireTenantId();

    const extension = ALLOWED_IMAGE_MIME_TYPES[file.mimetype];
    if (!extension) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        `Unsupported image type "${file.mimetype}". Use JPEG, PNG or WebP.`,
      );
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, "Image is larger than 5MB.");
    }

    const checksum = createHash("sha256").update(file.buffer).digest("hex");

    return this.db.run(async (tx) => {
      const product = await tx.query.products.findFirst({
        where: (t, { eq: e }) => e(t.id, productId),
        columns: { id: true },
      });
      if (!product) throw new AppError(ERROR_CODES.PRODUCT_NOT_FOUND, `Product ${productId} not found`);

      const duplicate = await tx.query.productImages.findFirst({
        where: (t, { eq: e }) => e(t.checksum, checksum),
        columns: { id: true, productId: true },
      });
      if (duplicate) {
        throw new AppError(
          ERROR_CODES.DUPLICATE_IMAGE,
          duplicate.productId === productId
            ? "This exact image is already attached to this product."
            : "This exact image is already attached to a different product.",
        );
      }

      const [existingCount] = await tx
        .select({ value: count() })
        .from(schema.productImages)
        .where(eq(schema.productImages.productId, productId));
      // The first photo a product gets is primary whether or not the caller
      // asked — a lone image with nothing marked primary is a product with
      // no thumbnail anywhere that reads one.
      const isPrimary = dto.isPrimary || (existingCount?.value ?? 0) === 0;

      const key = `${tenantId}/products/${productId}/${checksum}.${extension}`;
      const url = await this.storage.upload(key, file.buffer, file.mimetype);

      if (isPrimary) {
        await tx
          .update(schema.productImages)
          .set({ isPrimary: false })
          .where(eq(schema.productImages.productId, productId));
      }

      const [image] = await tx
        .insert(schema.productImages)
        .values({
          tenantId,
          productId,
          ...(dto.variantId ? { variantId: dto.variantId } : {}),
          url,
          checksum,
          sizeBytes: file.size,
          mimeType: file.mimetype,
          ...(dto.altText ? { altText: dto.altText } : {}),
          isPrimary,
        })
        .returning();

      if (isPrimary) {
        await tx.update(schema.products).set({ imageUrl: url }).where(eq(schema.products.id, productId));
      }

      return image;
    });
  }

  async updateImage(id: string, dto: UpdateProductImageDto): Promise<unknown> {
    return this.db.run(async (tx) => {
      const image = await tx.query.productImages.findFirst({
        where: (t, { eq: e }) => e(t.id, id),
        columns: { productId: true },
      });
      if (!image) throw new AppError(ERROR_CODES.NOT_FOUND, `Image ${id} not found`);

      if (dto.isPrimary) {
        await tx
          .update(schema.productImages)
          .set({ isPrimary: false })
          .where(eq(schema.productImages.productId, image.productId));
      }

      const [updated] = await tx
        .update(schema.productImages)
        .set({
          ...(dto.isPrimary !== undefined ? { isPrimary: dto.isPrimary } : {}),
          ...(dto.altText !== undefined ? { altText: dto.altText } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        })
        .where(eq(schema.productImages.id, id))
        .returning();
      if (!updated) throw new AppError(ERROR_CODES.NOT_FOUND, `Image ${id} not found`);

      if (dto.isPrimary) {
        await tx.update(schema.products).set({ imageUrl: updated.url }).where(eq(schema.products.id, image.productId));
      }
      return updated;
    });
  }

  /**
   * A real delete — this is a reference to a stored object, not a document
   * anything snapshots from. The object itself is left in storage rather
   * than deleted alongside the row: another product's own row can still
   * point at the same bytes if this ever moves toward shared photography,
   * and an orphaned blob costs storage, not correctness.
   */
  async deleteImage(id: string): Promise<void> {
    await this.db.run(async (tx) => {
      const image = await tx.query.productImages.findFirst({
        where: (t, { eq: e }) => e(t.id, id),
      });
      if (!image) throw new AppError(ERROR_CODES.NOT_FOUND, `Image ${id} not found`);

      await tx.delete(schema.productImages).where(eq(schema.productImages.id, id));

      if (image.isPrimary) {
        const next = await tx.query.productImages.findFirst({
          where: (t, { eq: e }) => e(t.productId, image.productId),
          orderBy: (t, { asc: a }) => a(t.sortOrder),
        });
        await tx
          .update(schema.products)
          .set({ imageUrl: next?.url ?? null })
          .where(eq(schema.products.id, image.productId));
        if (next) {
          await tx.update(schema.productImages).set({ isPrimary: true }).where(eq(schema.productImages.id, next.id));
        }
      }
    });
  }

  /**
   * POS search. Returns sellable variants with resolved price and stock.
   *
   * Trigram similarity on `search_key` rather than full-text, because a cashier
   * types fragments and misspellings under time pressure — "elbo", "3/4 elbow",
   * "PVC ELB" all have to land on the right row.
   */
  async searchVariants(query: SearchVariantsDto): Promise<unknown[]> {
    const canViewCost = RequestContext.get()?.user?.abac.canViewCost ?? false;
    const needle = searchKey(query.q);

    return this.db.run(async (tx) => {
      const exact = query.q.trim()
        ? await tx.query.productVariants.findFirst({
            where: (t, { and: a, eq: e, isNull: n }) =>
              a(e(t.barcode, normalizeBarcode(query.q)), n(t.deletedAt)),
            columns: { id: true },
          })
        : null;

      const rows = await tx
        .select({
          id: schema.productVariants.id,
          sku: schema.productVariants.sku,
          barcode: schema.productVariants.barcode,
          variantName: schema.productVariants.variantName,
          productId: schema.products.id,
          productName: schema.products.name,
          taxRate: schema.products.taxRate,
          unitAbbr: schema.units.abbreviation,
          categoryName: schema.categories.name,
          imageUrl: schema.productVariants.imageUrl,
          minStock: schema.productVariants.minStock,
          stock: query.branchId
            ? sql<string>`coalesce((
                SELECT i.quantity FROM inventory i
                WHERE i.variant_id = product_variants.id
                  AND i.branch_id = ${query.branchId}
              ), '0')`
            : sql<string>`'0'`,
        })
        .from(schema.productVariants)
        .innerJoin(schema.products, eq(schema.productVariants.productId, schema.products.id))
        .innerJoin(schema.units, eq(schema.products.unitId, schema.units.id))
        .leftJoin(schema.categories, eq(schema.products.categoryId, schema.categories.id))
        .where(
          and(
            isNull(schema.productVariants.deletedAt),
            eq(schema.productVariants.isActive, true),
            eq(schema.products.isActive, true),
            exact
              ? eq(schema.productVariants.id, exact.id)
              : needle
                ? or(
                    ilike(schema.productVariants.searchKey, `%${needle}%`),
                    ilike(schema.productVariants.sku, `%${query.q}%`),
                  )
                : undefined,
          ),
        )
        .limit(query.limit);

      const priced = await this.prices.resolveMany(tx, {
        variantIds: rows.map((r) => r.id),
        customerId: query.customerId ?? null,
        includeCost: canViewCost,
      });
      const priceBy = new Map(priced.map((p) => [p.variantId, p]));

      // A variant nobody has priced is not sellable, so it is not offered.
      return rows
        .filter((r) => priceBy.has(r.id))
        .map((r) => {
          const price = priceBy.get(r.id)!;
          return {
            ...r,
            sellingPrice: price.unitPrice,
            minSellingPrice: price.minSellingPrice,
            priceSource: price.source,
            ...(canViewCost ? { purchasePrice: price.purchasePrice } : {}),
          };
        });
    });
  }

  /**
   * Cross-references this variant's free-form `attributes` against whatever
   * this category has DEFINED (Stage 5.3), writing a `variant_attribute_values`
   * row for each key that matches a definition. A key with no matching
   * definition is left exactly where it already was — in the JSONB bag,
   * present but unindexed — so a category that hasn't formalised an
   * attribute yet loses nothing by not having done so.
   */
  private async writeAttributeValues(
    tx: Parameters<Parameters<TenantDatabase["run"]>[0]>[0],
    tenantId: string,
    variantId: string,
    attributes: Record<string, string | number | boolean>,
    definitionsByName: Map<string, AttributeDefinition>,
  ): Promise<void> {
    for (const [name, rawValue] of Object.entries(attributes)) {
      const definition = definitionsByName.get(name);
      if (!definition) continue;

      if (definition.type === "select" && !(definition.allowedValues ?? []).includes(String(rawValue))) {
        throw new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          `"${rawValue}" is not an allowed value for ${definition.label}. Allowed: ${(definition.allowedValues ?? []).join(", ")}`,
        );
      }
      if (definition.type === "number" && Number.isNaN(Number(rawValue))) {
        throw new AppError(ERROR_CODES.VALIDATION_FAILED, `${definition.label} must be a number`);
      }
      if (definition.type === "boolean" && typeof rawValue !== "boolean") {
        throw new AppError(ERROR_CODES.VALIDATION_FAILED, `${definition.label} must be true or false`);
      }

      await tx.insert(schema.variantAttributeValues).values({
        tenantId,
        variantId,
        attributeDefinitionId: definition.id,
        value: String(rawValue),
      });
    }
  }

  /**
   * Next SKU for a category: `{prefix}-{000123}`.
   *
   * Uses the shared document sequence so two people creating products at once
   * cannot land on the same number.
   */
  private async nextSku(
    tx: Parameters<Parameters<TenantDatabase["run"]>[0]>[0],
    categoryId: string | null,
  ): Promise<string> {
    const tenantId = RequestContext.requireTenantId();

    const category = categoryId
      ? await tx.query.categories.findFirst({
          where: (t, { eq: e }) => e(t.id, categoryId),
          columns: { skuPrefix: true },
        })
      : null;

    const prefix = category?.skuPrefix ?? "SKU";
    const [row] = await tx.execute<{ next_document_number: number }>(
      sql`SELECT next_document_number(${tenantId}::uuid, ${`sku:${prefix}`})`,
    );

    const sequence = Number((row as { next_document_number?: number })?.next_document_number ?? 1);
    return `${prefix}-${String(sequence).padStart(6, "0")}`;
  }
}
