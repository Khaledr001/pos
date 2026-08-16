import { and, asc, count, desc, eq, ilike, isNull, or, schema, sql } from "@devsfleet/db";
import type { Paginated } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES, searchKey, normalizeBarcode } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { RequestContext } from "../../common/context/request-context.js";
import { PlanLimitService } from "../../common/guards/plan-limit.service.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import { StockService } from "../inventory/stock.service.js";
import { PriceResolverService } from "../pricing/price-resolver.service.js";
import type {
  CreateProductDto,
  ListProductsDto,
  SearchVariantsDto,
  UpdateProductDto,
} from "./dto.js";

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
  ) {}

  async list(query: ListProductsDto): Promise<Paginated<unknown>> {
    const { page, limit, q, categoryId, brandId, includeInactive, sortBy, sortOrder } = query;
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
